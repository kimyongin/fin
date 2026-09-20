create table public.investment_policy_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    version integer not null default 1 check (version > 0),
    raw_text text,
    goal_text text,
    horizon_text text,
    liquidity_need_text text,
    risk_tolerance_text text,
    trading_preference_text text,
    restrictions jsonb not null default '[]'::jsonb check (jsonb_typeof(restrictions) = 'array'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.investment_policy_history (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    version integer not null check (version > 0),
    snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
    change_reason text not null check (char_length(trim(change_reason)) between 1 and 1000),
    authored_via text not null check (authored_via in ('app', 'agent')),
    created_at timestamptz not null default now(),
    unique (user_id, version)
);

create table public.investment_policy_mutation_receipts (
    user_id uuid not null references auth.users(id) on delete cascade,
    idempotency_key uuid not null,
    request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
    response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
    created_at timestamptz not null default now(),
    primary key (user_id, idempotency_key)
);

alter table public.investment_policy_profiles enable row level security;
alter table public.investment_policy_history enable row level security;
alter table public.investment_policy_mutation_receipts enable row level security;

create policy investment_policy_profiles_select_own on public.investment_policy_profiles
    for select to authenticated using (user_id = auth.uid());
create policy investment_policy_history_select_own on public.investment_policy_history
    for select to authenticated using (user_id = auth.uid());
create policy investment_policy_mutation_receipts_select_own on public.investment_policy_mutation_receipts
    for select to authenticated using (user_id = auth.uid());

create or replace function public.app_get_investment_policy()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'profile', (
            select jsonb_build_object(
                'version', profile.version,
                'raw_text', profile.raw_text,
                'goal_text', profile.goal_text,
                'horizon_text', profile.horizon_text,
                'liquidity_need_text', profile.liquidity_need_text,
                'risk_tolerance_text', profile.risk_tolerance_text,
                'trading_preference_text', profile.trading_preference_text,
                'restrictions', profile.restrictions,
                'created_at', profile.created_at,
                'updated_at', profile.updated_at
            )
            from public.investment_policy_profiles profile
            where profile.user_id = auth.uid()
        ),
        'strategy', public.app_get_strategy_state(null)
    );
$$;

create or replace function public.app_save_investment_policy(
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
    current_profile public.investment_policy_profiles%rowtype;
    stored_receipt public.investment_policy_mutation_receipts%rowtype;
    request_payload jsonb;
    allowed_fields text[] := array[
        'raw_text', 'goal_text', 'horizon_text', 'liquidity_need_text',
        'risk_tolerance_text', 'trading_preference_text', 'restrictions'
    ];
    next_version integer;
    next_raw_text text;
    next_goal_text text;
    next_horizon_text text;
    next_liquidity_need_text text;
    next_risk_tolerance_text text;
    next_trading_preference_text text;
    next_restrictions jsonb;
    restriction_input jsonb;
    response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if coalesce(jsonb_typeof(input_patch), 'null') <> 'object' or input_patch = '{}'::jsonb then
        raise exception 'Policy patch must be a non-empty object';
    end if;
    if exists (
        select 1 from jsonb_object_keys(input_patch) patch_key
        where not (patch_key = any(allowed_fields))
    ) then raise exception 'Policy patch contains an unknown field'; end if;
    if char_length(trim(coalesce(input_change_reason, ''))) not between 1 and 1000 then
        raise exception 'Policy change reason is required and must be at most 1000 characters';
    end if;
    if input_authored_via not in ('app', 'agent') then raise exception 'Invalid authored_via'; end if;

    request_payload := jsonb_build_object(
        'expected_version', input_expected_version,
        'patch', input_patch,
        'change_reason', trim(input_change_reason),
        'authored_via', input_authored_via
    );
    perform pg_advisory_xact_lock(hashtextextended(
        current_user_id::text || ':save_investment_policy:' || input_idempotency_key::text, 0
    ));
    select * into stored_receipt
    from public.investment_policy_mutation_receipts receipt
    where receipt.user_id = current_user_id and receipt.idempotency_key = input_idempotency_key;
    if found then
        if stored_receipt.request_payload <> request_payload then
            raise exception 'Idempotency key was already used with a different request';
        end if;
        return stored_receipt.response_payload;
    end if;

    select * into current_profile
    from public.investment_policy_profiles profile
    where profile.user_id = current_user_id
    for update;
    if found then
        if input_expected_version is null or input_expected_version <> current_profile.version then
            raise exception 'Investment policy version conflict';
        end if;
        next_version := current_profile.version + 1;
    else
        if input_expected_version is not null then raise exception 'Investment policy version conflict'; end if;
        next_version := 1;
    end if;

    next_raw_text := case when input_patch ? 'raw_text' then nullif(trim(input_patch ->> 'raw_text'), '') else current_profile.raw_text end;
    next_goal_text := case when input_patch ? 'goal_text' then nullif(trim(input_patch ->> 'goal_text'), '') else current_profile.goal_text end;
    next_horizon_text := case when input_patch ? 'horizon_text' then nullif(trim(input_patch ->> 'horizon_text'), '') else current_profile.horizon_text end;
    next_liquidity_need_text := case when input_patch ? 'liquidity_need_text' then nullif(trim(input_patch ->> 'liquidity_need_text'), '') else current_profile.liquidity_need_text end;
    next_risk_tolerance_text := case when input_patch ? 'risk_tolerance_text' then nullif(trim(input_patch ->> 'risk_tolerance_text'), '') else current_profile.risk_tolerance_text end;
    next_trading_preference_text := case when input_patch ? 'trading_preference_text' then nullif(trim(input_patch ->> 'trading_preference_text'), '') else current_profile.trading_preference_text end;
    next_restrictions := case when input_patch ? 'restrictions' then input_patch -> 'restrictions' else coalesce(current_profile.restrictions, '[]'::jsonb) end;

    if char_length(coalesce(next_raw_text, '')) > 10000
       or char_length(coalesce(next_goal_text, '')) > 4000
       or char_length(coalesce(next_horizon_text, '')) > 4000
       or char_length(coalesce(next_liquidity_need_text, '')) > 4000
       or char_length(coalesce(next_risk_tolerance_text, '')) > 4000
       or char_length(coalesce(next_trading_preference_text, '')) > 4000 then
        raise exception 'Investment policy text is too long';
    end if;
    if coalesce(jsonb_typeof(next_restrictions), 'null') <> 'array'
       or jsonb_array_length(next_restrictions) > 20 then
        raise exception 'Policy restrictions must be an array with at most 20 items';
    end if;
    for restriction_input in select value from jsonb_array_elements(next_restrictions) loop
        if coalesce(jsonb_typeof(restriction_input), 'null') <> 'object'
           or trim(coalesce(restriction_input ->> 'kind', '')) not in ('preference', 'prohibition')
           or char_length(trim(coalesce(restriction_input ->> 'text', ''))) not between 1 and 1000 then
            raise exception 'Each policy restriction needs kind and text';
        end if;
    end loop;

    insert into public.investment_policy_profiles (
        user_id, version, raw_text, goal_text, horizon_text, liquidity_need_text,
        risk_tolerance_text, trading_preference_text, restrictions, updated_at
    ) values (
        current_user_id, next_version, next_raw_text, next_goal_text, next_horizon_text,
        next_liquidity_need_text, next_risk_tolerance_text, next_trading_preference_text,
        next_restrictions, clock_timestamp()
    )
    on conflict (user_id) do update set
        version = excluded.version,
        raw_text = excluded.raw_text,
        goal_text = excluded.goal_text,
        horizon_text = excluded.horizon_text,
        liquidity_need_text = excluded.liquidity_need_text,
        risk_tolerance_text = excluded.risk_tolerance_text,
        trading_preference_text = excluded.trading_preference_text,
        restrictions = excluded.restrictions,
        updated_at = excluded.updated_at;

    insert into public.investment_policy_history (
        user_id, version, snapshot, change_reason, authored_via
    ) values (
        current_user_id, next_version,
        jsonb_build_object(
            'raw_text', next_raw_text,
            'goal_text', next_goal_text,
            'horizon_text', next_horizon_text,
            'liquidity_need_text', next_liquidity_need_text,
            'risk_tolerance_text', next_risk_tolerance_text,
            'trading_preference_text', next_trading_preference_text,
            'restrictions', next_restrictions
        ), trim(input_change_reason), input_authored_via
    );

    insert into public.activity_events (
        user_id, source, action_type, target_table, target_id, after_data, status
    ) values (
        current_user_id, case when input_authored_via = 'app' then 'user' else 'agent' end,
        'save_investment_policy', 'investment_policy_profiles', current_user_id::text,
        jsonb_build_object('version', next_version, 'changed_fields',
            (select jsonb_agg(key order by key) from jsonb_object_keys(input_patch) key)),
        'succeeded'
    );

    response_payload := public.app_get_investment_policy();
    insert into public.investment_policy_mutation_receipts (
        user_id, idempotency_key, request_payload, response_payload
    ) values (current_user_id, input_idempotency_key, request_payload, response_payload);
    return response_payload;
end;
$$;

grant select on public.investment_policy_profiles, public.investment_policy_history,
    public.investment_policy_mutation_receipts to authenticated;
grant execute on function public.app_get_investment_policy() to authenticated;
grant execute on function public.app_save_investment_policy(integer, uuid, jsonb, text, text) to authenticated;
