create table public.operating_rules (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null check (char_length(trim(title)) between 1 and 200),
    workflow_key text not null check (workflow_key ~ '^[a-z][a-z0-9_]{0,99}$'),
    applicability text not null check (char_length(trim(applicability)) between 1 and 2000),
    body text not null check (char_length(trim(body)) between 1 and 10000),
    status text not null default 'active' check (status in ('active', 'archived')),
    version integer not null default 1 check (version > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    archived_at timestamptz
);

create index operating_rules_user_workflow_status_idx
    on public.operating_rules (user_id, workflow_key, status, updated_at desc, id);

create table public.operating_rule_history (
    id uuid primary key default gen_random_uuid(),
    rule_id uuid not null references public.operating_rules(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    version integer not null check (version > 0),
    snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
    change_reason text not null check (char_length(trim(change_reason)) between 1 and 1000),
    authored_via text not null check (authored_via in ('app', 'agent')),
    created_at timestamptz not null default now(),
    unique (rule_id, version)
);

create table public.operating_rule_mutation_receipts (
    user_id uuid not null references auth.users(id) on delete cascade,
    idempotency_key uuid not null,
    request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
    response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
    created_at timestamptz not null default now(),
    primary key (user_id, idempotency_key)
);

alter table public.operating_rules enable row level security;
alter table public.operating_rule_history enable row level security;
alter table public.operating_rule_mutation_receipts enable row level security;

create policy operating_rules_select_own on public.operating_rules
    for select to authenticated using (user_id = auth.uid());
create policy operating_rule_history_select_own on public.operating_rule_history
    for select to authenticated using (user_id = auth.uid());
create policy operating_rule_mutation_receipts_select_own on public.operating_rule_mutation_receipts
    for select to authenticated using (user_id = auth.uid());

create or replace function public.app_operating_rule_json(input_rule public.operating_rules)
returns jsonb
language sql
stable
set search_path = public
as $$
    select jsonb_build_object(
        'id', input_rule.id,
        'title', input_rule.title,
        'workflow_key', input_rule.workflow_key,
        'applicability', input_rule.applicability,
        'body', input_rule.body,
        'status', input_rule.status,
        'version', input_rule.version,
        'created_at', input_rule.created_at,
        'updated_at', input_rule.updated_at,
        'archived_at', input_rule.archived_at
    );
$$;

create or replace function public.app_list_operating_rules(
    input_workflow_key text default null,
    input_include_archived boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'rules', coalesce(jsonb_agg(public.app_operating_rule_json(rule)
            order by rule.updated_at desc, rule.id), '[]'::jsonb)
    )
    from public.operating_rules rule
    where rule.user_id = auth.uid()
      and (input_workflow_key is null or rule.workflow_key = trim(input_workflow_key))
      and (coalesce(input_include_archived, false) or rule.status = 'active');
$$;

create or replace function public.app_save_operating_rule(
    input_rule_id uuid,
    input_expected_version integer,
    input_idempotency_key uuid,
    input_title text,
    input_workflow_key text,
    input_applicability text,
    input_body text,
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
    current_rule public.operating_rules%rowtype;
    stored_receipt public.operating_rule_mutation_receipts%rowtype;
    saved_rule public.operating_rules%rowtype;
    next_id uuid := coalesce(input_rule_id, gen_random_uuid());
    next_version integer;
    request_payload jsonb;
    response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if char_length(trim(coalesce(input_title, ''))) not between 1 and 200 then raise exception 'Operating rule title is required and must be at most 200 characters'; end if;
    if trim(coalesce(input_workflow_key, '')) !~ '^[a-z][a-z0-9_]{0,99}$' then raise exception 'Invalid operating rule workflow key'; end if;
    if char_length(trim(coalesce(input_applicability, ''))) not between 1 and 2000 then raise exception 'Operating rule applicability is required and must be at most 2000 characters'; end if;
    if char_length(trim(coalesce(input_body, ''))) not between 1 and 10000 then raise exception 'Operating rule body is required and must be at most 10000 characters'; end if;
    if char_length(trim(coalesce(input_change_reason, ''))) not between 1 and 1000 then raise exception 'Operating rule change reason is required and must be at most 1000 characters'; end if;
    if input_authored_via not in ('app', 'agent') then raise exception 'Invalid authored_via'; end if;

    request_payload := jsonb_build_object(
        'operation', 'save', 'rule_id', input_rule_id, 'expected_version', input_expected_version,
        'title', trim(input_title), 'workflow_key', trim(input_workflow_key),
        'applicability', trim(input_applicability), 'body', trim(input_body),
        'change_reason', trim(input_change_reason), 'authored_via', input_authored_via
    );
    perform pg_advisory_xact_lock(hashtextextended(
        current_user_id::text || ':operating_rule:' || input_idempotency_key::text, 0
    ));
    select * into stored_receipt from public.operating_rule_mutation_receipts receipt
    where receipt.user_id = current_user_id and receipt.idempotency_key = input_idempotency_key;
    if found then
        if stored_receipt.request_payload <> request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
        return stored_receipt.response_payload;
    end if;

    if input_rule_id is not null then
        select * into current_rule from public.operating_rules rule
        where rule.id = input_rule_id and rule.user_id = current_user_id for update;
        if found then
            if input_expected_version is null or input_expected_version <> current_rule.version then raise exception 'Operating rule version conflict'; end if;
            next_version := current_rule.version + 1;
        elsif input_expected_version is not null then
            raise exception 'Operating rule not found';
        else
            next_version := 1;
        end if;
    else
        if input_expected_version is not null then raise exception 'Operating rule version conflict'; end if;
        next_version := 1;
    end if;

    insert into public.operating_rules (
        id, user_id, title, workflow_key, applicability, body, status, version, updated_at, archived_at
    ) values (
        next_id, current_user_id, trim(input_title), trim(input_workflow_key), trim(input_applicability),
        trim(input_body), 'active', next_version, clock_timestamp(), null
    )
    on conflict (id) do update set
        title = excluded.title, workflow_key = excluded.workflow_key,
        applicability = excluded.applicability, body = excluded.body,
        status = 'active', version = excluded.version, updated_at = excluded.updated_at, archived_at = null
    returning * into saved_rule;

    insert into public.operating_rule_history (rule_id, user_id, version, snapshot, change_reason, authored_via)
    values (saved_rule.id, current_user_id, saved_rule.version, public.app_operating_rule_json(saved_rule), trim(input_change_reason), input_authored_via);
    insert into public.activity_events (user_id, source, action_type, target_table, target_id, after_data, status)
    values (current_user_id, case when input_authored_via = 'app' then 'user' else 'agent' end,
        'save_operating_rule', 'operating_rules', saved_rule.id::text,
        jsonb_build_object('version', saved_rule.version, 'workflow_key', saved_rule.workflow_key), 'succeeded');

    response_payload := jsonb_build_object('rule', public.app_operating_rule_json(saved_rule));
    insert into public.operating_rule_mutation_receipts (user_id, idempotency_key, request_payload, response_payload)
    values (current_user_id, input_idempotency_key, request_payload, response_payload);
    return response_payload;
end;
$$;

create or replace function public.app_archive_operating_rule(
    input_rule_id uuid,
    input_expected_version integer,
    input_idempotency_key uuid,
    input_reason text,
    input_authored_via text default 'app'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    current_rule public.operating_rules%rowtype;
    stored_receipt public.operating_rule_mutation_receipts%rowtype;
    saved_rule public.operating_rules%rowtype;
    request_payload jsonb;
    response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_rule_id is null or input_idempotency_key is null then raise exception 'Rule and idempotency key are required'; end if;
    if char_length(trim(coalesce(input_reason, ''))) not between 1 and 1000 then raise exception 'Archive reason is required and must be at most 1000 characters'; end if;
    if input_authored_via not in ('app', 'agent') then raise exception 'Invalid authored_via'; end if;
    request_payload := jsonb_build_object('operation', 'archive', 'rule_id', input_rule_id,
        'expected_version', input_expected_version, 'reason', trim(input_reason), 'authored_via', input_authored_via);
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':operating_rule:' || input_idempotency_key::text, 0));
    select * into stored_receipt from public.operating_rule_mutation_receipts receipt
    where receipt.user_id = current_user_id and receipt.idempotency_key = input_idempotency_key;
    if found then
        if stored_receipt.request_payload <> request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
        return stored_receipt.response_payload;
    end if;
    select * into current_rule from public.operating_rules rule
    where rule.id = input_rule_id and rule.user_id = current_user_id for update;
    if not found then raise exception 'Operating rule not found'; end if;
    if input_expected_version is null or input_expected_version <> current_rule.version then raise exception 'Operating rule version conflict'; end if;
    if current_rule.status = 'archived' then raise exception 'Operating rule is already archived'; end if;
    update public.operating_rules set status = 'archived', version = version + 1,
        updated_at = clock_timestamp(), archived_at = clock_timestamp()
    where id = current_rule.id returning * into saved_rule;
    insert into public.operating_rule_history (rule_id, user_id, version, snapshot, change_reason, authored_via)
    values (saved_rule.id, current_user_id, saved_rule.version, public.app_operating_rule_json(saved_rule), trim(input_reason), input_authored_via);
    insert into public.activity_events (user_id, source, action_type, target_table, target_id, after_data, status)
    values (current_user_id, case when input_authored_via = 'app' then 'user' else 'agent' end,
        'archive_operating_rule', 'operating_rules', saved_rule.id::text,
        jsonb_build_object('version', saved_rule.version, 'workflow_key', saved_rule.workflow_key), 'succeeded');
    response_payload := jsonb_build_object('rule', public.app_operating_rule_json(saved_rule));
    insert into public.operating_rule_mutation_receipts (user_id, idempotency_key, request_payload, response_payload)
    values (current_user_id, input_idempotency_key, request_payload, response_payload);
    return response_payload;
end;
$$;

grant select on public.operating_rules, public.operating_rule_history,
    public.operating_rule_mutation_receipts to authenticated;
revoke all on function public.app_operating_rule_json(public.operating_rules) from public, anon, authenticated;
grant execute on function public.app_list_operating_rules(text, boolean) to authenticated;
grant execute on function public.app_save_operating_rule(uuid, integer, uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.app_archive_operating_rule(uuid, integer, uuid, text, text) to authenticated;
