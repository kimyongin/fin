create table public.investment_decisions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    version integer not null default 1 check (version > 0),
    status text not null check (status in ('proposed', 'adopted', 'dismissed', 'superseded')),
    subject jsonb not null check (jsonb_typeof(subject) = 'object'),
    question text not null check (char_length(trim(question)) between 1 and 1000),
    options jsonb not null check (jsonb_typeof(options) = 'array'),
    selected_option text,
    reason text,
    uncertainty text,
    review_condition text,
    policy_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(policy_snapshot) = 'object'),
    source_briefing_id uuid,
    replaces_id uuid,
    authored_via text not null check (authored_via in ('app', 'agent')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, id),
    foreign key (user_id, source_briefing_id)
        references public.daily_briefings (user_id, id),
    foreign key (user_id, replaces_id)
        references public.investment_decisions (user_id, id),
    constraint investment_decisions_adopted_check check (
        status <> 'adopted'
        or (
            nullif(trim(coalesce(selected_option, '')), '') is not null
            and nullif(trim(coalesce(reason, '')), '') is not null
        )
    )
);

create index investment_decisions_user_updated_idx
    on public.investment_decisions (user_id, updated_at desc, id desc);

create table public.investment_decision_state_history (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    decision_id uuid not null,
    version integer not null check (version > 0),
    status text not null check (status in ('proposed', 'adopted', 'dismissed', 'superseded')),
    reason text,
    authored_via text not null check (authored_via in ('app', 'agent')),
    created_at timestamptz not null default now(),
    unique (user_id, decision_id, version),
    foreign key (user_id, decision_id)
        references public.investment_decisions (user_id, id) on delete cascade
);

create table public.portfolio_tasks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    kind text not null check (kind in ('research', 'execution')),
    version integer not null default 1 check (version > 0),
    title text not null check (char_length(trim(title)) between 1 and 500),
    subject jsonb not null check (jsonb_typeof(subject) = 'object'),
    due_date date,
    timezone text not null,
    trigger_text text,
    control_state text not null default 'active' check (control_state in ('active', 'paused', 'cancelled')),
    research_state text check (research_state in ('open', 'waiting', 'resolved', 'closed')),
    current_history_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, id),
    constraint portfolio_tasks_kind_state_check check (
        (kind = 'research' and research_state is not null)
        or (kind = 'execution' and research_state is null)
    )
);

create index portfolio_tasks_user_state_updated_idx
    on public.portfolio_tasks (user_id, control_state, research_state, updated_at desc, id desc);

create table public.portfolio_task_history (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    task_id uuid not null,
    version integer not null check (version > 0),
    control_state text not null check (control_state in ('active', 'paused', 'cancelled')),
    research_state text check (research_state in ('open', 'waiting', 'resolved', 'closed')),
    content_snapshot jsonb not null check (jsonb_typeof(content_snapshot) = 'object'),
    answer text,
    change_reason text,
    authored_via text not null check (authored_via in ('app', 'agent')),
    created_at timestamptz not null default now(),
    unique (user_id, task_id, version),
    unique (user_id, task_id, id),
    foreign key (user_id, task_id)
        references public.portfolio_tasks (user_id, id) on delete cascade
);

alter table public.portfolio_tasks
    add constraint portfolio_tasks_current_history_fk
    foreign key (user_id, id, current_history_id)
    references public.portfolio_task_history (user_id, task_id, id);

create table public.investment_decision_tasks (
    user_id uuid not null,
    decision_id uuid not null,
    task_id uuid not null,
    decision_snapshot jsonb not null check (jsonb_typeof(decision_snapshot) = 'object'),
    task_snapshot jsonb not null check (jsonb_typeof(task_snapshot) = 'object'),
    created_at timestamptz not null default now(),
    primary key (decision_id, task_id),
    foreign key (user_id, decision_id)
        references public.investment_decisions (user_id, id) on delete cascade,
    foreign key (user_id, task_id)
        references public.portfolio_tasks (user_id, id) on delete cascade
);

create table public.decision_task_mutation_receipts (
    user_id uuid not null references auth.users(id) on delete cascade,
    operation text not null,
    idempotency_key uuid not null,
    request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
    response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
    created_at timestamptz not null default now(),
    primary key (user_id, operation, idempotency_key)
);

alter table public.investment_decisions enable row level security;
alter table public.investment_decision_state_history enable row level security;
alter table public.portfolio_tasks enable row level security;
alter table public.portfolio_task_history enable row level security;
alter table public.investment_decision_tasks enable row level security;
alter table public.decision_task_mutation_receipts enable row level security;

create policy investment_decisions_select_own on public.investment_decisions
    for select to authenticated using (user_id = auth.uid());
create policy investment_decision_state_history_select_own on public.investment_decision_state_history
    for select to authenticated using (user_id = auth.uid());
create policy portfolio_tasks_select_own on public.portfolio_tasks
    for select to authenticated using (user_id = auth.uid());
create policy portfolio_task_history_select_own on public.portfolio_task_history
    for select to authenticated using (user_id = auth.uid());
create policy investment_decision_tasks_select_own on public.investment_decision_tasks
    for select to authenticated using (user_id = auth.uid());
create policy decision_task_mutation_receipts_select_own on public.decision_task_mutation_receipts
    for select to authenticated using (user_id = auth.uid());

create or replace function public.app_get_investment_decision(input_decision_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'id', decision.id,
        'version', decision.version,
        'status', decision.status,
        'subject', decision.subject,
        'question', decision.question,
        'options', decision.options,
        'selected_option', decision.selected_option,
        'reason', decision.reason,
        'uncertainty', decision.uncertainty,
        'review_condition', decision.review_condition,
        'policy_snapshot', decision.policy_snapshot,
        'source_briefing_id', decision.source_briefing_id,
        'replaces_id', decision.replaces_id,
        'authored_via', decision.authored_via,
        'created_at', decision.created_at,
        'updated_at', decision.updated_at,
        'tasks', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', task.id,
                'kind', task.kind,
                'version', task.version,
                'title', task.title,
                'subject', task.subject,
                'due_date', task.due_date,
                'timezone', task.timezone,
                'trigger_text', task.trigger_text,
                'control_state', task.control_state,
                'research_state', task.research_state,
                'created_at', task.created_at,
                'updated_at', task.updated_at
            ) order by task.created_at, task.id)
            from public.investment_decision_tasks link
            join public.portfolio_tasks task on task.id = link.task_id and task.user_id = link.user_id
            where link.user_id = auth.uid() and link.decision_id = decision.id
        ), '[]'::jsonb),
        'history', coalesce((
            select jsonb_agg(jsonb_build_object(
                'version', history.version,
                'status', history.status,
                'reason', history.reason,
                'authored_via', history.authored_via,
                'created_at', history.created_at
            ) order by history.version)
            from public.investment_decision_state_history history
            where history.user_id = auth.uid() and history.decision_id = decision.id
        ), '[]'::jsonb)
    )
    from public.investment_decisions decision
    where decision.id = input_decision_id and decision.user_id = auth.uid();
$$;

create or replace function public.app_list_investment_decisions(
    input_limit integer default 20,
    input_before timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(to_jsonb(item) order by item.updated_at desc, item.id desc), '[]'::jsonb)
    from (
        select decision.id, decision.version, decision.status, decision.subject,
               decision.question, decision.selected_option, decision.reason,
               decision.uncertainty, decision.review_condition,
               decision.source_briefing_id, decision.created_at, decision.updated_at,
               (select count(*)::integer from public.investment_decision_tasks link
                where link.user_id = auth.uid() and link.decision_id = decision.id) task_count
        from public.investment_decisions decision
        where decision.user_id = auth.uid()
          and (input_before is null or decision.updated_at < input_before)
        order by decision.updated_at desc, decision.id desc
        limit greatest(1, least(coalesce(input_limit, 20), 50))
    ) item;
$$;

create or replace function public.app_get_portfolio_task(input_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'id', task.id,
        'kind', task.kind,
        'version', task.version,
        'title', task.title,
        'subject', task.subject,
        'due_date', task.due_date,
        'timezone', task.timezone,
        'trigger_text', task.trigger_text,
        'control_state', task.control_state,
        'research_state', task.research_state,
        'created_at', task.created_at,
        'updated_at', task.updated_at,
        'decision_ids', coalesce((
            select jsonb_agg(link.decision_id order by link.created_at, link.decision_id)
            from public.investment_decision_tasks link
            where link.user_id = auth.uid() and link.task_id = task.id
        ), '[]'::jsonb),
        'history', coalesce((
            select jsonb_agg(jsonb_build_object(
                'version', history.version,
                'control_state', history.control_state,
                'research_state', history.research_state,
                'content_snapshot', history.content_snapshot,
                'answer', history.answer,
                'change_reason', history.change_reason,
                'authored_via', history.authored_via,
                'created_at', history.created_at
            ) order by history.version)
            from public.portfolio_task_history history
            where history.user_id = auth.uid() and history.task_id = task.id
        ), '[]'::jsonb)
    )
    from public.portfolio_tasks task
    where task.id = input_task_id and task.user_id = auth.uid();
$$;

create or replace function public.app_list_portfolio_tasks(
    input_state text default null,
    input_limit integer default 20,
    input_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if input_state is not null and input_state not in ('open', 'waiting', 'resolved', 'closed') then
        raise exception 'Invalid task state';
    end if;
    return (
        select coalesce(jsonb_agg(to_jsonb(item) order by item.updated_at desc, item.id desc), '[]'::jsonb)
        from (
            select task.id, task.kind, task.version, task.title, task.subject,
                   task.due_date, task.timezone, task.trigger_text,
                   task.control_state, task.research_state, task.created_at, task.updated_at,
                   (select count(*)::integer from public.investment_decision_tasks link
                    where link.user_id = auth.uid() and link.task_id = task.id) decision_count
            from public.portfolio_tasks task
            where task.user_id = auth.uid()
              and (input_state is null or task.research_state = input_state)
              and (input_before is null or task.updated_at < input_before)
            order by task.updated_at desc, task.id desc
            limit greatest(1, least(coalesce(input_limit, 20), 50))
        ) item
    );
end;
$$;

create or replace function public.app_record_investment_decision(
    input_idempotency_key uuid,
    input_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    stored_receipt public.decision_task_mutation_receipts%rowtype;
    normalized_payload jsonb;
    normalized_status text;
    normalized_authored_via text;
    normalized_timezone text;
    decision_id uuid;
    task_id uuid;
    history_id uuid;
    task_input jsonb;
    source_briefing_id uuid;
    response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if coalesce(jsonb_typeof(input_payload), 'null') <> 'object' then
        raise exception 'Decision payload must be an object';
    end if;

    normalized_payload := input_payload;
    normalized_status := trim(coalesce(input_payload ->> 'status', ''));
    normalized_authored_via := trim(coalesce(input_payload ->> 'authored_via', 'agent'));
    normalized_timezone := trim(coalesce(input_payload ->> 'timezone', 'Asia/Seoul'));

    perform pg_advisory_xact_lock(hashtextextended(
        current_user_id::text || ':record_investment_decision:' || input_idempotency_key::text, 0
    ));
    select * into stored_receipt
    from public.decision_task_mutation_receipts receipt
    where receipt.user_id = current_user_id
      and receipt.operation = 'record_investment_decision'
      and receipt.idempotency_key = input_idempotency_key;
    if found then
        if stored_receipt.request_payload <> normalized_payload then
            raise exception 'Idempotency key was already used with a different request';
        end if;
        return stored_receipt.response_payload;
    end if;

    if normalized_status not in ('proposed', 'adopted') then raise exception 'Invalid initial decision status'; end if;
    if normalized_authored_via not in ('app', 'agent') then raise exception 'Invalid authored_via'; end if;
    if not exists (select 1 from pg_timezone_names where name = normalized_timezone) then raise exception 'Invalid timezone'; end if;
    if coalesce(jsonb_typeof(input_payload -> 'subject'), 'null') <> 'object'
       or trim(coalesce(input_payload #>> '{subject,kind}', '')) not in ('portfolio', 'instrument', 'position') then
        raise exception 'Decision subject must have a supported kind';
    end if;
    if trim(input_payload #>> '{subject,kind}') <> 'portfolio'
       and nullif(trim(coalesce(input_payload #>> '{subject,instrument_id}', '')), '') is null then
        raise exception 'Instrument or position subject needs instrument_id';
    end if;
    if trim(input_payload #>> '{subject,kind}') = 'position'
       and nullif(trim(coalesce(input_payload #>> '{subject,account_id}', '')), '') is null then
        raise exception 'Position subject needs account_id';
    end if;
    if char_length(trim(coalesce(input_payload ->> 'question', ''))) not between 1 and 1000 then
        raise exception 'Decision question is required and must be at most 1000 characters';
    end if;
    if coalesce(jsonb_typeof(input_payload -> 'options'), 'null') <> 'array'
       or jsonb_array_length(input_payload -> 'options') not between 1 and 10 then
        raise exception 'Decision options must contain between 1 and 10 items';
    end if;
    if exists (
        select 1 from jsonb_array_elements(input_payload -> 'options') option_value
        where jsonb_typeof(option_value) <> 'string'
           or nullif(trim(option_value #>> '{}'), '') is null
    ) then raise exception 'Each decision option must be a non-empty string'; end if;
    if normalized_status = 'adopted' and (
        nullif(trim(coalesce(input_payload ->> 'selected_option', '')), '') is null
        or nullif(trim(coalesce(input_payload ->> 'reason', '')), '') is null
    ) then raise exception 'Adopted decision needs selected_option and reason'; end if;
    if nullif(trim(coalesce(input_payload ->> 'selected_option', '')), '') is not null
       and not (input_payload -> 'options' @> jsonb_build_array(trim(input_payload ->> 'selected_option'))) then
        raise exception 'Selected option must be one of the decision options';
    end if;
    if coalesce(jsonb_typeof(input_payload -> 'policy_snapshot'), 'object') <> 'object' then
        raise exception 'Policy snapshot must be an object';
    end if;
    if coalesce(jsonb_typeof(input_payload -> 'follow_up_tasks'), 'null') <> 'array'
       or jsonb_array_length(input_payload -> 'follow_up_tasks') > 3 then
        raise exception 'Follow-up tasks must be an array with at most 3 items';
    end if;
    if pg_column_size(input_payload) > 262144 then raise exception 'Decision payload is too large'; end if;

    if nullif(trim(coalesce(input_payload ->> 'source_briefing_id', '')), '') is not null then
        begin source_briefing_id := (input_payload ->> 'source_briefing_id')::uuid;
        exception when invalid_text_representation then raise exception 'Invalid source briefing id'; end;
        if not exists (select 1 from public.daily_briefings where id = source_briefing_id and user_id = current_user_id) then
            raise exception 'Source briefing was not found';
        end if;
    end if;

    insert into public.investment_decisions (
        user_id, status, subject, question, options, selected_option, reason,
        uncertainty, review_condition, policy_snapshot, source_briefing_id, authored_via
    ) values (
        current_user_id, normalized_status, input_payload -> 'subject', trim(input_payload ->> 'question'),
        input_payload -> 'options', nullif(trim(input_payload ->> 'selected_option'), ''),
        nullif(trim(input_payload ->> 'reason'), ''), nullif(trim(input_payload ->> 'uncertainty'), ''),
        nullif(trim(input_payload ->> 'review_condition'), ''),
        coalesce(input_payload -> 'policy_snapshot', '{}'::jsonb), source_briefing_id, normalized_authored_via
    ) returning id into decision_id;

    insert into public.investment_decision_state_history (
        user_id, decision_id, version, status, reason, authored_via
    ) values (
        current_user_id, decision_id, 1, normalized_status,
        nullif(trim(input_payload ->> 'reason'), ''), normalized_authored_via
    );

    for task_input in select value from jsonb_array_elements(input_payload -> 'follow_up_tasks') loop
        if coalesce(jsonb_typeof(task_input), 'null') <> 'object' then raise exception 'Each follow-up task must be an object'; end if;
        if char_length(trim(coalesce(task_input ->> 'title', ''))) not between 1 and 500 then
            raise exception 'Each follow-up task needs a title of at most 500 characters';
        end if;
        if coalesce(jsonb_typeof(task_input -> 'subject'), 'null') <> 'object' then
            raise exception 'Each follow-up task needs a subject';
        end if;
        if trim(coalesce(task_input #>> '{subject,kind}', '')) not in ('portfolio', 'instrument', 'position') then
            raise exception 'Each follow-up task needs a supported subject kind';
        end if;
        if trim(task_input #>> '{subject,kind}') <> 'portfolio'
           and nullif(trim(coalesce(task_input #>> '{subject,instrument_id}', '')), '') is null then
            raise exception 'Instrument or position follow-up needs instrument_id';
        end if;
        if trim(task_input #>> '{subject,kind}') = 'position'
           and nullif(trim(coalesce(task_input #>> '{subject,account_id}', '')), '') is null then
            raise exception 'Position follow-up needs account_id';
        end if;
        insert into public.portfolio_tasks (
            user_id, kind, title, subject, due_date, timezone, trigger_text,
            control_state, research_state
        ) values (
            current_user_id, 'research', trim(task_input ->> 'title'), task_input -> 'subject',
            nullif(task_input ->> 'due_date', '')::date, normalized_timezone,
            nullif(trim(task_input ->> 'trigger_text'), ''), 'active', 'open'
        ) returning id into task_id;

        insert into public.portfolio_task_history (
            user_id, task_id, version, control_state, research_state,
            content_snapshot, change_reason, authored_via
        ) values (
            current_user_id, task_id, 1, 'active', 'open',
            jsonb_build_object(
                'title', trim(task_input ->> 'title'),
                'subject', task_input -> 'subject',
                'due_date', nullif(task_input ->> 'due_date', ''),
                'trigger_text', nullif(trim(task_input ->> 'trigger_text'), '')
            ), 'Created with investment decision', normalized_authored_via
        ) returning id into history_id;

        update public.portfolio_tasks set current_history_id = history_id where id = task_id;
        insert into public.investment_decision_tasks (
            user_id, decision_id, task_id, decision_snapshot, task_snapshot
        ) values (
            current_user_id, decision_id, task_id,
            jsonb_build_object('version', 1, 'status', normalized_status, 'question', trim(input_payload ->> 'question')),
            jsonb_build_object('version', 1, 'state', 'open', 'title', trim(task_input ->> 'title'))
        );
    end loop;

    insert into public.activity_events (
        user_id, source, action_type, target_table, target_id, after_data, status
    ) values (
        current_user_id, case when normalized_authored_via = 'app' then 'user' else 'agent' end,
        'record_investment_decision',
        'investment_decisions', decision_id::text,
        jsonb_build_object('status', normalized_status, 'task_count', jsonb_array_length(input_payload -> 'follow_up_tasks')),
        'succeeded'
    );

    response_payload := public.app_get_investment_decision(decision_id);
    insert into public.decision_task_mutation_receipts (
        user_id, operation, idempotency_key, request_payload, response_payload
    ) values (
        current_user_id, 'record_investment_decision', input_idempotency_key,
        normalized_payload, response_payload
    );
    return response_payload;
end;
$$;

grant select on public.investment_decisions, public.investment_decision_state_history,
    public.portfolio_tasks, public.portfolio_task_history,
    public.investment_decision_tasks, public.decision_task_mutation_receipts to authenticated;

grant execute on function public.app_get_investment_decision(uuid) to authenticated;
grant execute on function public.app_list_investment_decisions(integer, timestamptz) to authenticated;
grant execute on function public.app_get_portfolio_task(uuid) to authenticated;
grant execute on function public.app_list_portfolio_tasks(text, integer, timestamptz) to authenticated;
grant execute on function public.app_record_investment_decision(uuid, jsonb) to authenticated;
