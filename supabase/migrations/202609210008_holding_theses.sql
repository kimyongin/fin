create table public.holding_theses (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    instrument_id bigint not null references public.instruments(id) on delete cascade,
    account_id bigint references public.accounts(id) on delete cascade,
    version integer not null default 1 check (version > 0),
    reason_text text not null check (char_length(trim(reason_text)) between 1 and 10000),
    horizon_text text check (horizon_text is null or char_length(horizon_text) <= 4000),
    review_condition_text text check (review_condition_text is null or char_length(review_condition_text) <= 4000),
    next_review_date date,
    related_decision_id uuid,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, id)
);

create unique index holding_theses_instrument_base_unique
    on public.holding_theses (user_id, instrument_id) where account_id is null;
create unique index holding_theses_account_override_unique
    on public.holding_theses (user_id, instrument_id, account_id) where account_id is not null;

alter table public.holding_theses add constraint holding_theses_related_decision_owner_fk
    foreign key (user_id, related_decision_id)
    references public.investment_decisions(user_id, id);

create table public.holding_thesis_history (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    thesis_id uuid not null,
    version integer not null check (version > 0),
    snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
    change_reason text not null check (char_length(trim(change_reason)) between 1 and 1000),
    authored_via text not null check (authored_via in ('app', 'agent')),
    created_at timestamptz not null default now(),
    unique (user_id, thesis_id, version),
    foreign key (user_id, thesis_id) references public.holding_theses(user_id, id) on delete cascade
);

create table public.holding_thesis_mutation_receipts (
    user_id uuid not null references auth.users(id) on delete cascade,
    idempotency_key uuid not null,
    request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
    response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
    created_at timestamptz not null default now(),
    primary key (user_id, idempotency_key)
);

alter table public.holding_theses enable row level security;
alter table public.holding_thesis_history enable row level security;
alter table public.holding_thesis_mutation_receipts enable row level security;

create policy holding_theses_select_own on public.holding_theses
    for select to authenticated using (user_id = auth.uid());
create policy holding_thesis_history_select_own on public.holding_thesis_history
    for select to authenticated using (user_id = auth.uid());
create policy holding_thesis_receipts_select_own on public.holding_thesis_mutation_receipts
    for select to authenticated using (user_id = auth.uid());

create or replace function public.app_list_holding_theses()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(
        jsonb_build_object(
            'id', thesis.id,
            'instrument_id', thesis.instrument_id,
            'ticker', instrument.ticker,
            'instrument_name', instrument.display_name,
            'account_id', thesis.account_id,
            'account_name', account.name,
            'scope', case when thesis.account_id is null then 'instrument' else 'account' end,
            'version', thesis.version,
            'reason_text', thesis.reason_text,
            'horizon_text', thesis.horizon_text,
            'review_condition_text', thesis.review_condition_text,
            'next_review_date', thesis.next_review_date,
            'related_decision_id', thesis.related_decision_id,
            'is_active', thesis.is_active,
            'created_at', thesis.created_at,
            'updated_at', thesis.updated_at
        ) order by instrument.display_name, account.name nulls first
    ), '[]'::jsonb)
    from public.holding_theses thesis
    join public.instruments instrument
      on instrument.id = thesis.instrument_id and instrument.user_id = thesis.user_id
    left join public.accounts account
      on account.id = thesis.account_id and account.user_id = thesis.user_id
    where thesis.user_id = auth.uid();
$$;

create or replace function public.app_get_holding_thesis(
    input_instrument_id bigint,
    input_account_id bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    base_thesis jsonb;
    account_thesis jsonb;
begin
    if not exists (
        select 1 from public.instruments
        where id = input_instrument_id and user_id = current_user_id
    ) then raise exception 'Instrument was not found or is not accessible'; end if;
    if input_account_id is not null and not exists (
        select 1 from public.accounts where id = input_account_id and user_id = current_user_id
    ) then raise exception 'Account was not found or is not accessible'; end if;

    select to_jsonb(thesis) - 'user_id' into base_thesis
    from public.holding_theses thesis
    where thesis.user_id = current_user_id
      and thesis.instrument_id = input_instrument_id
      and thesis.account_id is null;

    if input_account_id is not null then
        select to_jsonb(thesis) - 'user_id' into account_thesis
        from public.holding_theses thesis
        where thesis.user_id = current_user_id
          and thesis.instrument_id = input_instrument_id
          and thesis.account_id = input_account_id;
    end if;

    return jsonb_build_object(
        'instrument_base', base_thesis,
        'account_override', account_thesis,
        'applied', coalesce(account_thesis, base_thesis),
        'applied_scope', case
            when account_thesis is not null then 'account'
            when base_thesis is not null then 'instrument'
            else null
        end
    );
end;
$$;

create or replace function public.app_save_holding_thesis(
    input_instrument_id bigint,
    input_account_id bigint,
    input_expected_version integer,
    input_idempotency_key uuid,
    input_patch jsonb,
    input_change_reason text,
    input_authored_via text default 'app'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    current_thesis public.holding_theses%rowtype;
    saved_thesis public.holding_theses%rowtype;
    stored_receipt public.holding_thesis_mutation_receipts%rowtype;
    request_payload jsonb;
    allowed_fields text[] := array['reason_text', 'horizon_text', 'review_condition_text', 'next_review_date', 'related_decision_id', 'is_active'];
    next_version integer;
    next_reason text;
    next_horizon text;
    next_condition text;
    next_review_on date;
    next_decision_id uuid;
    next_active boolean;
    response_payload jsonb;
    instrument_ticker text;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if coalesce(jsonb_typeof(input_patch), 'null') <> 'object' or input_patch = '{}'::jsonb then
        raise exception 'Holding thesis patch must be a non-empty object';
    end if;
    if exists (select 1 from jsonb_object_keys(input_patch) key where not (key = any(allowed_fields))) then
        raise exception 'Holding thesis patch contains an unknown field';
    end if;
    if char_length(trim(coalesce(input_change_reason, ''))) not between 1 and 1000 then
        raise exception 'Holding thesis change reason is required and must be at most 1000 characters';
    end if;
    if input_authored_via not in ('app', 'agent') then raise exception 'Invalid authored_via'; end if;

    select ticker into instrument_ticker from public.instruments
    where id = input_instrument_id and user_id = current_user_id;
    if not found then raise exception 'Instrument was not found or is not accessible'; end if;
    if input_account_id is not null and not exists (
        select 1 from public.holdings holding
        join public.accounts account on account.id = holding.account_id and account.user_id = holding.user_id
        where holding.user_id = current_user_id and holding.account_id = input_account_id
          and holding.ticker = instrument_ticker
    ) then raise exception 'Account does not hold this instrument'; end if;

    request_payload := jsonb_build_object(
        'instrument_id', input_instrument_id, 'account_id', input_account_id,
        'expected_version', input_expected_version, 'patch', input_patch,
        'change_reason', trim(input_change_reason), 'authored_via', input_authored_via
    );
    perform pg_advisory_xact_lock(hashtextextended(
        current_user_id::text || ':save_holding_thesis:' || input_idempotency_key::text, 0
    ));
    select * into stored_receipt from public.holding_thesis_mutation_receipts receipt
    where receipt.user_id = current_user_id and receipt.idempotency_key = input_idempotency_key;
    if found then
        if stored_receipt.request_payload <> request_payload then
            raise exception 'Idempotency key was already used with a different request';
        end if;
        return stored_receipt.response_payload;
    end if;

    select * into current_thesis from public.holding_theses thesis
    where thesis.user_id = current_user_id and thesis.instrument_id = input_instrument_id
      and thesis.account_id is not distinct from input_account_id
    for update;
    if found then
        if input_expected_version is null or input_expected_version <> current_thesis.version then
            raise exception 'Holding thesis version conflict';
        end if;
        next_version := current_thesis.version + 1;
    else
        if input_expected_version is not null then raise exception 'Holding thesis version conflict'; end if;
        next_version := 1;
    end if;

    next_reason := case when input_patch ? 'reason_text' then nullif(trim(input_patch ->> 'reason_text'), '') else current_thesis.reason_text end;
    next_horizon := case when input_patch ? 'horizon_text' then nullif(trim(input_patch ->> 'horizon_text'), '') else current_thesis.horizon_text end;
    next_condition := case when input_patch ? 'review_condition_text' then nullif(trim(input_patch ->> 'review_condition_text'), '') else current_thesis.review_condition_text end;
    next_review_on := case when input_patch ? 'next_review_date' then nullif(input_patch ->> 'next_review_date', '')::date else current_thesis.next_review_date end;
    next_decision_id := case when input_patch ? 'related_decision_id' then nullif(input_patch ->> 'related_decision_id', '')::uuid else current_thesis.related_decision_id end;
    next_active := case when input_patch ? 'is_active' then (input_patch ->> 'is_active')::boolean else coalesce(current_thesis.is_active, true) end;
    if next_reason is null then raise exception 'Holding thesis reason is required'; end if;
    if char_length(next_reason) > 10000 or char_length(coalesce(next_horizon, '')) > 4000
       or char_length(coalesce(next_condition, '')) > 4000 then raise exception 'Holding thesis text is too long'; end if;
    if next_decision_id is not null and not exists (
        select 1 from public.investment_decisions where user_id = current_user_id and id = next_decision_id
    ) then raise exception 'Related decision was not found or is not accessible'; end if;

    if current_thesis.id is null then
        insert into public.holding_theses (
            user_id, instrument_id, account_id, version, reason_text, horizon_text,
            review_condition_text, next_review_date, related_decision_id, is_active
        ) values (
            current_user_id, input_instrument_id, input_account_id, next_version, next_reason,
            next_horizon, next_condition, next_review_on, next_decision_id, next_active
        ) returning * into saved_thesis;
    else
        update public.holding_theses set
            version = next_version, reason_text = next_reason, horizon_text = next_horizon,
            review_condition_text = next_condition, next_review_date = next_review_on,
            related_decision_id = next_decision_id, is_active = next_active, updated_at = clock_timestamp()
        where id = current_thesis.id and user_id = current_user_id
        returning * into saved_thesis;
    end if;

    insert into public.holding_thesis_history (
        user_id, thesis_id, version, snapshot, change_reason, authored_via
    ) values (
        current_user_id, saved_thesis.id, saved_thesis.version,
        jsonb_build_object(
            'instrument_id', saved_thesis.instrument_id, 'account_id', saved_thesis.account_id,
            'reason_text', saved_thesis.reason_text, 'horizon_text', saved_thesis.horizon_text,
            'review_condition_text', saved_thesis.review_condition_text,
            'next_review_date', saved_thesis.next_review_date,
            'related_decision_id', saved_thesis.related_decision_id, 'is_active', saved_thesis.is_active
        ), trim(input_change_reason), input_authored_via
    );

    insert into public.activity_events (
        user_id, source, action_type, target_table, target_id, after_data, status
    ) values (
        current_user_id, case when input_authored_via = 'app' then 'user' else 'agent' end,
        'save_holding_thesis', 'holding_theses', saved_thesis.id::text,
        jsonb_build_object('version', saved_thesis.version, 'instrument_id', input_instrument_id,
            'account_id', input_account_id, 'changed_fields',
            (select jsonb_agg(key order by key) from jsonb_object_keys(input_patch) key)),
        'succeeded'
    );

    response_payload := jsonb_build_object('thesis', to_jsonb(saved_thesis) - 'user_id');
    insert into public.holding_thesis_mutation_receipts (
        user_id, idempotency_key, request_payload, response_payload
    ) values (current_user_id, input_idempotency_key, request_payload, response_payload);
    return response_payload;
end;
$$;

grant select on public.holding_theses, public.holding_thesis_history,
    public.holding_thesis_mutation_receipts to authenticated;
grant execute on function public.app_list_holding_theses() to authenticated;
grant execute on function public.app_get_holding_thesis(bigint, bigint) to authenticated;
grant execute on function public.app_save_holding_thesis(bigint, bigint, integer, uuid, jsonb, text, text) to authenticated;
