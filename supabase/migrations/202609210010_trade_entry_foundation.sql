alter table public.holdings
    add column ledger_quantity numeric(38, 16),
    add column ledger_cost_pool numeric(38, 16),
    add column state_version bigint not null default 1,
    add column ledger_checkpoint_at timestamptz;

update public.holdings holding
set ledger_quantity = coalesce(holding.quantity::numeric, 0),
    ledger_cost_pool = case
        when holding.quantity is null or holding.avg_price is null then 0
        else holding.quantity::numeric * holding.avg_price::numeric
    end,
    ledger_checkpoint_at = coalesce(holding.updated_at, now());

alter table public.holdings
    alter column ledger_quantity set not null,
    alter column ledger_cost_pool set not null,
    add constraint holdings_ledger_quantity_nonnegative check (ledger_quantity >= 0),
    add constraint holdings_ledger_cost_pool_nonnegative check (ledger_cost_pool >= 0),
    add constraint holdings_state_version_positive check (state_version > 0);

create or replace function public.sync_holding_ledger_projection()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        new.ledger_quantity := coalesce(new.ledger_quantity, coalesce(new.quantity::numeric, 0));
        new.ledger_cost_pool := coalesce(
            new.ledger_cost_pool,
            case when new.quantity is null or new.avg_price is null then 0
                 else new.quantity::numeric * new.avg_price::numeric end
        );
        new.state_version := coalesce(new.state_version, 1);
        new.ledger_checkpoint_at := coalesce(new.ledger_checkpoint_at, now());
    elsif new.ledger_quantity is not distinct from old.ledger_quantity
       and new.ledger_cost_pool is not distinct from old.ledger_cost_pool
       and (new.quantity is distinct from old.quantity or new.avg_price is distinct from old.avg_price) then
        new.ledger_quantity := coalesce(new.quantity::numeric, 0);
        new.ledger_cost_pool := case when new.quantity is null or new.avg_price is null then 0
            else new.quantity::numeric * new.avg_price::numeric end;
        new.ledger_checkpoint_at := clock_timestamp();
        new.state_version := old.state_version + 1;
    elsif new.ledger_quantity is distinct from old.ledger_quantity
       or new.ledger_cost_pool is distinct from old.ledger_cost_pool then
        new.quantity := new.ledger_quantity::real;
        new.avg_price := case when new.ledger_quantity = 0 then null
            else (new.ledger_cost_pool / new.ledger_quantity)::real end;
        new.state_version := old.state_version + 1;
    end if;
    return new;
end;
$$;

create trigger sync_holding_ledger_projection_trigger
before insert or update on public.holdings
for each row execute function public.sync_holding_ledger_projection();

create table public.trade_previews (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    account_id bigint not null references public.accounts(id) on delete cascade,
    instrument_id bigint not null references public.instruments(id) on delete cascade,
    holding_id bigint references public.holdings(id) on delete cascade,
    holding_state_version bigint not null,
    side text not null check (side in ('buy', 'sell')),
    quantity numeric(38, 16) not null check (quantity > 0),
    unit_price numeric(38, 16) not null check (unit_price > 0),
    executed_on date not null,
    before_quantity numeric(38, 16) not null check (before_quantity >= 0),
    before_cost_pool numeric(38, 16) not null check (before_cost_pool >= 0),
    after_quantity numeric(38, 16) not null check (after_quantity >= 0),
    after_cost_pool numeric(38, 16) not null check (after_cost_pool >= 0),
    expires_at timestamptz not null,
    consumed_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id)
);

create table public.trade_entries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    account_id bigint not null references public.accounts(id) on delete restrict,
    instrument_id bigint not null references public.instruments(id) on delete restrict,
    holding_id bigint not null references public.holdings(id) on delete restrict,
    preview_id uuid not null,
    side text not null check (side in ('buy', 'sell')),
    quantity numeric(38, 16) not null check (quantity > 0),
    unit_price numeric(38, 16) not null check (unit_price > 0),
    executed_on date not null,
    sequence_no bigint generated always as identity,
    before_quantity numeric(38, 16) not null,
    before_cost_pool numeric(38, 16) not null,
    after_quantity numeric(38, 16) not null,
    after_cost_pool numeric(38, 16) not null,
    authored_via text not null check (authored_via in ('app', 'agent')),
    created_at timestamptz not null default now(),
    unique (user_id, id),
    unique (user_id, preview_id),
    foreign key (user_id, preview_id) references public.trade_previews(user_id, id)
);

create index trade_entries_stream_order
    on public.trade_entries (user_id, account_id, instrument_id, executed_on desc, sequence_no desc);

create table public.trade_entry_mutation_receipts (
    user_id uuid not null references auth.users(id) on delete cascade,
    idempotency_key uuid not null,
    request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
    response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
    created_at timestamptz not null default now(),
    primary key (user_id, idempotency_key)
);

alter table public.trade_previews enable row level security;
alter table public.trade_entries enable row level security;
alter table public.trade_entry_mutation_receipts enable row level security;
create policy trade_previews_select_own on public.trade_previews for select to authenticated using (user_id = auth.uid());
create policy trade_entries_select_own on public.trade_entries for select to authenticated using (user_id = auth.uid());
create policy trade_entry_receipts_select_own on public.trade_entry_mutation_receipts for select to authenticated using (user_id = auth.uid());

create or replace function public.app_preview_trade_entry(
    input_account_id bigint,
    input_instrument_id bigint,
    input_side text,
    input_quantity numeric,
    input_unit_price numeric,
    input_executed_on date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_side text := lower(trim(coalesce(input_side, '')));
    current_holding public.holdings%rowtype;
    selected_instrument public.instruments%rowtype;
    before_quantity numeric(38,16) := 0;
    before_cost numeric(38,16) := 0;
    after_quantity numeric(38,16);
    after_cost numeric(38,16);
    saved_preview public.trade_previews%rowtype;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if normalized_side not in ('buy', 'sell') then raise exception 'Trade side must be buy or sell'; end if;
    if input_quantity is null or input_quantity <= 0 or scale(input_quantity) > 16 then raise exception 'Trade quantity must be positive with at most 16 decimal places'; end if;
    if input_unit_price is null or input_unit_price <= 0 or scale(input_unit_price) > 16 then raise exception 'Trade unit price must be positive with at most 16 decimal places'; end if;
    if input_executed_on is null or input_executed_on > current_date then raise exception 'Trade date is required and cannot be in the future'; end if;
    if not exists (select 1 from public.accounts where id = input_account_id and user_id = current_user_id) then
        raise exception 'Account was not found or is not accessible';
    end if;
    select * into selected_instrument from public.instruments
    where id = input_instrument_id and user_id = current_user_id;
    if not found then raise exception 'Instrument was not found or is not accessible'; end if;
    if selected_instrument.instrument_type <> 'market' then raise exception 'Only market instruments support trade entries'; end if;

    select * into current_holding from public.holdings holding
    where holding.user_id = current_user_id and holding.account_id = input_account_id
      and holding.ticker = selected_instrument.ticker;
    if found then
        before_quantity := current_holding.ledger_quantity;
        before_cost := current_holding.ledger_cost_pool;
    elsif normalized_side = 'sell' then
        raise exception 'Cannot sell an instrument that is not held in this account';
    end if;

    if normalized_side = 'buy' then
        after_quantity := before_quantity + input_quantity;
        after_cost := before_cost + (input_quantity * input_unit_price);
    else
        if input_quantity > before_quantity then raise exception 'Trade would sell more than the current holding'; end if;
        after_quantity := before_quantity - input_quantity;
        after_cost := case when after_quantity = 0 then 0
            else before_cost * after_quantity / before_quantity end;
    end if;

    delete from public.trade_previews
    where user_id = current_user_id and expires_at < clock_timestamp() - interval '1 day';
    insert into public.trade_previews (
        user_id, account_id, instrument_id, holding_id, holding_state_version,
        side, quantity, unit_price, executed_on, before_quantity, before_cost_pool,
        after_quantity, after_cost_pool, expires_at
    ) values (
        current_user_id, input_account_id, input_instrument_id, current_holding.id,
        coalesce(current_holding.state_version, 0), normalized_side, input_quantity,
        input_unit_price, input_executed_on, before_quantity, before_cost,
        after_quantity, after_cost, clock_timestamp() + interval '15 minutes'
    ) returning * into saved_preview;

    return jsonb_build_object(
        'preview_id', saved_preview.id,
        'expires_at', saved_preview.expires_at,
        'account_id', saved_preview.account_id,
        'instrument_id', saved_preview.instrument_id,
        'ticker', selected_instrument.ticker,
        'instrument_name', selected_instrument.display_name,
        'side', saved_preview.side,
        'quantity', saved_preview.quantity::text,
        'unit_price', saved_preview.unit_price::text,
        'executed_on', saved_preview.executed_on,
        'before', jsonb_build_object(
            'quantity', saved_preview.before_quantity::text,
            'avg_price', case when saved_preview.before_quantity = 0 then null else (saved_preview.before_cost_pool / saved_preview.before_quantity)::text end
        ),
        'after', jsonb_build_object(
            'quantity', saved_preview.after_quantity::text,
            'avg_price', case when saved_preview.after_quantity = 0 then null else (saved_preview.after_cost_pool / saved_preview.after_quantity)::text end
        )
    );
end;
$$;

create or replace function public.app_log_completed_trade(
    input_preview_id uuid,
    input_idempotency_key uuid,
    input_authored_via text default 'app'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    selected_preview public.trade_previews%rowtype;
    current_holding public.holdings%rowtype;
    saved_holding public.holdings%rowtype;
    saved_trade public.trade_entries%rowtype;
    stored_receipt public.trade_entry_mutation_receipts%rowtype;
    selected_instrument public.instruments%rowtype;
    request_payload jsonb;
    response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_preview_id is null or input_idempotency_key is null then raise exception 'Preview and idempotency keys are required'; end if;
    if input_authored_via not in ('app', 'agent') then raise exception 'Invalid authored_via'; end if;
    request_payload := jsonb_build_object('preview_id', input_preview_id, 'authored_via', input_authored_via);
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':log_trade:' || input_idempotency_key::text, 0));
    select * into stored_receipt from public.trade_entry_mutation_receipts receipt
    where receipt.user_id = current_user_id and receipt.idempotency_key = input_idempotency_key;
    if found then
        if stored_receipt.request_payload <> request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
        return stored_receipt.response_payload;
    end if;

    select * into selected_preview from public.trade_previews preview
    where preview.id = input_preview_id and preview.user_id = current_user_id for update;
    if not found then raise exception 'Trade preview was not found or is not accessible'; end if;
    if selected_preview.consumed_at is not null then raise exception 'Trade preview was already consumed'; end if;
    if selected_preview.expires_at <= clock_timestamp() then raise exception 'Trade preview expired'; end if;
    select * into selected_instrument from public.instruments
    where id = selected_preview.instrument_id and user_id = current_user_id;

    if selected_preview.holding_id is not null then
        if not exists (
            select 1 from public.holdings holding
            where holding.id = selected_preview.holding_id
              and holding.user_id = current_user_id
              and holding.state_version = selected_preview.holding_state_version
              and holding.ledger_quantity = selected_preview.before_quantity
              and holding.ledger_cost_pool = selected_preview.before_cost_pool
        ) then raise exception 'Trade preview is stale; create a new preview'; end if;
        select * into current_holding from public.holdings holding
        where holding.id = selected_preview.holding_id and holding.user_id = current_user_id for update;
        update public.holdings set
            ledger_quantity = selected_preview.after_quantity,
            ledger_cost_pool = selected_preview.after_cost_pool,
            updated_at = clock_timestamp()
        where id = current_holding.id and user_id = current_user_id
        returning * into saved_holding;
    else
        if exists (
            select 1 from public.holdings where user_id = current_user_id
              and account_id = selected_preview.account_id and ticker = selected_instrument.ticker
        ) then raise exception 'Trade preview is stale; create a new preview'; end if;
        insert into public.holdings (
            user_id, account_id, ticker, quantity, avg_price, ledger_quantity, ledger_cost_pool
        ) values (
            current_user_id, selected_preview.account_id, selected_instrument.ticker,
            selected_preview.after_quantity::real,
            (selected_preview.after_cost_pool / selected_preview.after_quantity)::real,
            selected_preview.after_quantity, selected_preview.after_cost_pool
        ) returning * into saved_holding;
    end if;

    insert into public.trade_entries (
        user_id, account_id, instrument_id, holding_id, preview_id, side, quantity,
        unit_price, executed_on, before_quantity, before_cost_pool,
        after_quantity, after_cost_pool, authored_via
    ) values (
        current_user_id, selected_preview.account_id, selected_preview.instrument_id,
        saved_holding.id, selected_preview.id, selected_preview.side, selected_preview.quantity,
        selected_preview.unit_price, selected_preview.executed_on,
        selected_preview.before_quantity, selected_preview.before_cost_pool,
        selected_preview.after_quantity, selected_preview.after_cost_pool, input_authored_via
    ) returning * into saved_trade;
    update public.trade_previews set consumed_at = clock_timestamp()
    where id = selected_preview.id and user_id = current_user_id;

    insert into public.activity_events (
        user_id, source, action_type, target_table, target_id, before_data, after_data, status
    ) values (
        current_user_id, case when input_authored_via = 'app' then 'user' else 'agent' end,
        'log_completed_trade', 'trade_entries', saved_trade.id::text,
        jsonb_build_object('quantity', selected_preview.before_quantity, 'avg_price',
            case when selected_preview.before_quantity = 0 then null else selected_preview.before_cost_pool / selected_preview.before_quantity end),
        jsonb_build_object('quantity', selected_preview.after_quantity, 'avg_price',
            case when selected_preview.after_quantity = 0 then null else selected_preview.after_cost_pool / selected_preview.after_quantity end),
        'succeeded'
    );

    response_payload := jsonb_build_object(
        'trade_id', saved_trade.id,
        'holding_id', saved_holding.id,
        'side', saved_trade.side,
        'quantity', saved_trade.quantity::text,
        'unit_price', saved_trade.unit_price::text,
        'executed_on', saved_trade.executed_on,
        'holding', jsonb_build_object(
            'state_version', saved_holding.state_version,
            'quantity', saved_holding.ledger_quantity::text,
            'avg_price', case when saved_holding.ledger_quantity = 0 then null else (saved_holding.ledger_cost_pool / saved_holding.ledger_quantity)::text end
        )
    );
    insert into public.trade_entry_mutation_receipts (user_id, idempotency_key, request_payload, response_payload)
    values (current_user_id, input_idempotency_key, request_payload, response_payload);
    return response_payload;
end;
$$;

create or replace function public.app_list_transactions(
    input_limit integer default 50,
    input_before timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(listed.item order by listed.created_at desc), '[]'::jsonb)
    from (
        select trade.created_at, jsonb_build_object(
            'id', trade.id,
            'account_id', trade.account_id,
            'account_name', account.name,
            'instrument_id', trade.instrument_id,
            'ticker', instrument.ticker,
            'instrument_name', instrument.display_name,
            'side', trade.side,
            'quantity', trade.quantity::text,
            'unit_price', trade.unit_price::text,
            'executed_on', trade.executed_on,
            'sequence_no', trade.sequence_no,
            'before_quantity', trade.before_quantity::text,
            'after_quantity', trade.after_quantity::text,
            'after_avg_price', case when trade.after_quantity = 0 then null else (trade.after_cost_pool / trade.after_quantity)::text end,
            'authored_via', trade.authored_via,
            'created_at', trade.created_at
        ) as item
        from public.trade_entries trade
        join public.accounts account on account.id = trade.account_id and account.user_id = trade.user_id
        join public.instruments instrument on instrument.id = trade.instrument_id and instrument.user_id = trade.user_id
        where trade.user_id = auth.uid()
          and (input_before is null or trade.created_at < input_before)
        order by trade.created_at desc
        limit least(greatest(coalesce(input_limit, 50), 1), 100)
    ) listed;
$$;

grant select on public.trade_previews, public.trade_entries, public.trade_entry_mutation_receipts to authenticated;
grant execute on function public.app_preview_trade_entry(bigint, bigint, text, numeric, numeric, date) to authenticated;
grant execute on function public.app_log_completed_trade(uuid, uuid, text) to authenticated;
grant execute on function public.app_list_transactions(integer, timestamptz) to authenticated;
