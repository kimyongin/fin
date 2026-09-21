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
    if not found then raise exception 'Instrument was not found or is not accessible'; end if;

    -- Serialize every mutation for one account/instrument stream. This also covers
    -- two previews that both observed an absent holding before either inserts it.
    perform pg_advisory_xact_lock(hashtextextended(
        current_user_id::text || ':holding_stream:' || selected_preview.account_id::text || ':' || selected_preview.instrument_id::text,
        0
    ));

    if selected_preview.holding_id is not null then
        select * into current_holding from public.holdings holding
        where holding.id = selected_preview.holding_id and holding.user_id = current_user_id
        for update;
        if not found
           or current_holding.state_version <> selected_preview.holding_state_version
           or current_holding.ledger_quantity <> selected_preview.before_quantity
           or current_holding.ledger_cost_pool <> selected_preview.before_cost_pool then
            raise exception 'Trade preview is stale; create a new preview';
        end if;

        update public.holdings set
            ledger_quantity = selected_preview.after_quantity,
            ledger_cost_pool = selected_preview.after_cost_pool,
            updated_at = clock_timestamp()
        where id = current_holding.id and user_id = current_user_id
        returning * into saved_holding;
    else
        if exists (
            select 1 from public.holdings
            where user_id = current_user_id
              and account_id = selected_preview.account_id
              and ticker = selected_instrument.ticker
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

grant execute on function public.app_log_completed_trade(uuid, uuid, text) to authenticated;
