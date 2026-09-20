create table public.portfolio_task_evidence (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    task_id uuid not null,
    task_history_id uuid not null,
    title text not null check (char_length(trim(title)) between 1 and 500),
    source_url text not null check (source_url ~ '^https?://'),
    summary text not null check (char_length(trim(summary)) between 1 and 4000),
    checked_at timestamptz not null,
    created_at timestamptz not null default now(),
    foreign key (user_id, task_id, task_history_id)
        references public.portfolio_task_history (user_id, task_id, id) on delete cascade
);

create index portfolio_task_evidence_history_idx
    on public.portfolio_task_evidence (user_id, task_id, task_history_id, created_at);

alter table public.portfolio_task_evidence enable row level security;
create policy portfolio_task_evidence_select_own on public.portfolio_task_evidence
    for select to authenticated using (user_id = auth.uid());

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
                'id', history.id,
                'version', history.version,
                'control_state', history.control_state,
                'research_state', history.research_state,
                'content_snapshot', history.content_snapshot,
                'answer', history.answer,
                'change_reason', history.change_reason,
                'authored_via', history.authored_via,
                'created_at', history.created_at,
                'evidence', coalesce((
                    select jsonb_agg(jsonb_build_object(
                        'id', evidence.id,
                        'title', evidence.title,
                        'source_url', evidence.source_url,
                        'summary', evidence.summary,
                        'checked_at', evidence.checked_at
                    ) order by evidence.created_at, evidence.id)
                    from public.portfolio_task_evidence evidence
                    where evidence.user_id = auth.uid()
                      and evidence.task_id = task.id
                      and evidence.task_history_id = history.id
                ), '[]'::jsonb)
            ) order by history.version)
            from public.portfolio_task_history history
            where history.user_id = auth.uid() and history.task_id = task.id
        ), '[]'::jsonb)
    )
    from public.portfolio_tasks task
    where task.id = input_task_id and task.user_id = auth.uid();
$$;

create or replace function public.app_transition_investment_decision(
    input_decision_id uuid,
    input_expected_version integer,
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
    current_decision public.investment_decisions%rowtype;
    stored_receipt public.decision_task_mutation_receipts%rowtype;
    request_payload jsonb;
    action_name text;
    authored_channel text;
    next_status text;
    next_reason text;
    next_selected_option text;
    response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_decision_id is null then raise exception 'Decision id is required'; end if;
    if input_expected_version is null or input_expected_version < 1 then raise exception 'Expected version is required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if coalesce(jsonb_typeof(input_payload), 'null') <> 'object' then raise exception 'Transition payload must be an object'; end if;

    request_payload := jsonb_build_object(
        'decision_id', input_decision_id,
        'expected_version', input_expected_version,
        'payload', input_payload
    );
    perform pg_advisory_xact_lock(hashtextextended(
        current_user_id::text || ':transition_investment_decision:' || input_idempotency_key::text, 0
    ));
    select * into stored_receipt
    from public.decision_task_mutation_receipts receipt
    where receipt.user_id = current_user_id
      and receipt.operation = 'transition_investment_decision'
      and receipt.idempotency_key = input_idempotency_key;
    if found then
        if stored_receipt.request_payload <> request_payload then
            raise exception 'Idempotency key was already used with a different request';
        end if;
        return stored_receipt.response_payload;
    end if;

    select * into current_decision
    from public.investment_decisions decision
    where decision.id = input_decision_id and decision.user_id = current_user_id
    for update;
    if not found then raise exception 'Decision was not found'; end if;
    if current_decision.version <> input_expected_version then raise exception 'Decision version conflict'; end if;
    if current_decision.status <> 'proposed' then raise exception 'Only a proposed decision can be adopted or dismissed'; end if;

    action_name := trim(coalesce(input_payload ->> 'action', ''));
    authored_channel := trim(coalesce(input_payload ->> 'authored_via', 'agent'));
    next_reason := nullif(trim(coalesce(input_payload ->> 'reason', '')), '');
    if authored_channel not in ('app', 'agent') then raise exception 'Invalid authored_via'; end if;
    if action_name = 'adopt' then
        next_status := 'adopted';
        next_selected_option := nullif(trim(coalesce(input_payload ->> 'selected_option', '')), '');
        if next_selected_option is null or next_reason is null then
            raise exception 'Adopting a decision needs selected_option and reason';
        end if;
        if not (current_decision.options @> jsonb_build_array(next_selected_option)) then
            raise exception 'Selected option must be one of the decision options';
        end if;
    elsif action_name = 'dismiss' then
        next_status := 'dismissed';
        next_selected_option := null;
        if next_reason is null then raise exception 'Dismissing a decision needs a reason'; end if;
    else
        raise exception 'Invalid decision transition action';
    end if;

    update public.investment_decisions
    set version = version + 1,
        status = next_status,
        selected_option = next_selected_option,
        reason = next_reason,
        updated_at = clock_timestamp()
    where id = current_decision.id and user_id = current_user_id;

    insert into public.investment_decision_state_history (
        user_id, decision_id, version, status, reason, authored_via
    ) values (
        current_user_id, current_decision.id, current_decision.version + 1,
        next_status, next_reason, authored_channel
    );

    insert into public.activity_events (
        user_id, source, action_type, target_table, target_id, before_data, after_data, status
    ) values (
        current_user_id, case when authored_channel = 'app' then 'user' else 'agent' end,
        'transition_investment_decision', 'investment_decisions', current_decision.id::text,
        jsonb_build_object('version', current_decision.version, 'status', current_decision.status),
        jsonb_build_object('version', current_decision.version + 1, 'status', next_status),
        'succeeded'
    );

    response_payload := public.app_get_investment_decision(current_decision.id);
    insert into public.decision_task_mutation_receipts (
        user_id, operation, idempotency_key, request_payload, response_payload
    ) values (
        current_user_id, 'transition_investment_decision', input_idempotency_key,
        request_payload, response_payload
    );
    return response_payload;
end;
$$;

create or replace function public.app_transition_portfolio_task(
    input_task_id uuid,
    input_expected_version integer,
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
    current_task public.portfolio_tasks%rowtype;
    stored_receipt public.decision_task_mutation_receipts%rowtype;
    request_payload jsonb;
    action_name text;
    authored_channel text;
    transition_reason text;
    transition_answer text;
    evidence_input jsonb;
    new_history_id uuid;
    next_control_state text;
    next_research_state text;
    response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_task_id is null then raise exception 'Task id is required'; end if;
    if input_expected_version is null or input_expected_version < 1 then raise exception 'Expected version is required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if coalesce(jsonb_typeof(input_payload), 'null') <> 'object' then raise exception 'Transition payload must be an object'; end if;
    if coalesce(jsonb_typeof(input_payload -> 'evidence'), 'null') <> 'array'
       or jsonb_array_length(input_payload -> 'evidence') > 20 then
        raise exception 'Task evidence must be an array with at most 20 items';
    end if;

    request_payload := jsonb_build_object(
        'task_id', input_task_id,
        'expected_version', input_expected_version,
        'payload', input_payload
    );
    perform pg_advisory_xact_lock(hashtextextended(
        current_user_id::text || ':transition_portfolio_task:' || input_idempotency_key::text, 0
    ));
    select * into stored_receipt
    from public.decision_task_mutation_receipts receipt
    where receipt.user_id = current_user_id
      and receipt.operation = 'transition_portfolio_task'
      and receipt.idempotency_key = input_idempotency_key;
    if found then
        if stored_receipt.request_payload <> request_payload then
            raise exception 'Idempotency key was already used with a different request';
        end if;
        return stored_receipt.response_payload;
    end if;

    select * into current_task
    from public.portfolio_tasks task
    where task.id = input_task_id and task.user_id = current_user_id
    for update;
    if not found then raise exception 'Task was not found'; end if;
    if current_task.version <> input_expected_version then raise exception 'Task version conflict'; end if;
    if current_task.kind <> 'research' then raise exception 'Only research tasks are supported in this transition'; end if;

    action_name := trim(coalesce(input_payload ->> 'action', ''));
    authored_channel := trim(coalesce(input_payload ->> 'authored_via', 'agent'));
    transition_reason := nullif(trim(coalesce(input_payload ->> 'reason', '')), '');
    transition_answer := nullif(trim(coalesce(input_payload ->> 'answer', '')), '');
    next_control_state := current_task.control_state;
    next_research_state := current_task.research_state;
    if authored_channel not in ('app', 'agent') then raise exception 'Invalid authored_via'; end if;

    if action_name = 'wait' then
        if current_task.control_state <> 'active' or current_task.research_state <> 'open' then
            raise exception 'Only an active open task can wait for material';
        end if;
        next_research_state := 'waiting';
    elsif action_name = 'resolve' then
        if current_task.control_state <> 'active' or current_task.research_state not in ('open', 'waiting') then
            raise exception 'Only an active open or waiting task can be resolved';
        end if;
        if transition_answer is null then raise exception 'Resolving a task needs an answer'; end if;
        if jsonb_array_length(input_payload -> 'evidence') = 0 then raise exception 'Resolving a task needs evidence'; end if;
        next_research_state := 'resolved';
    elsif action_name = 'reopen' then
        if current_task.control_state <> 'active' or current_task.research_state <> 'resolved' then
            raise exception 'Only an active resolved task can be reopened';
        end if;
        if transition_reason is null or jsonb_array_length(input_payload -> 'evidence') = 0 then
            raise exception 'Reopening a task needs a reason and new evidence';
        end if;
        next_research_state := 'open';
    elsif action_name = 'pause' then
        if current_task.control_state <> 'active' or current_task.research_state = 'closed' then
            raise exception 'Only an active non-closed task can be paused';
        end if;
        next_control_state := 'paused';
    elsif action_name = 'resume' then
        if current_task.control_state <> 'paused' or current_task.research_state = 'closed' then
            raise exception 'Only a paused non-closed task can be resumed';
        end if;
        next_control_state := 'active';
    elsif action_name = 'close' then
        if current_task.research_state = 'closed' then raise exception 'Task is already closed'; end if;
        if transition_reason is null then raise exception 'Closing a task needs a reason'; end if;
        next_research_state := 'closed';
    else
        raise exception 'Invalid task transition action';
    end if;

    for evidence_input in select value from jsonb_array_elements(input_payload -> 'evidence') loop
        if coalesce(jsonb_typeof(evidence_input), 'null') <> 'object'
           or char_length(trim(coalesce(evidence_input ->> 'title', ''))) not between 1 and 500
           or trim(coalesce(evidence_input ->> 'source_url', '')) !~ '^https?://'
           or char_length(trim(coalesce(evidence_input ->> 'summary', ''))) not between 1 and 4000
           or nullif(trim(coalesce(evidence_input ->> 'checked_at', '')), '') is null then
            raise exception 'Each task evidence needs title, source_url, summary, and checked_at';
        end if;
    end loop;

    update public.portfolio_tasks
    set version = version + 1,
        control_state = next_control_state,
        research_state = next_research_state,
        updated_at = clock_timestamp()
    where id = current_task.id and user_id = current_user_id;

    insert into public.portfolio_task_history (
        user_id, task_id, version, control_state, research_state,
        content_snapshot, answer, change_reason, authored_via
    ) values (
        current_user_id, current_task.id, current_task.version + 1,
        next_control_state, next_research_state,
        jsonb_build_object(
            'title', current_task.title,
            'subject', current_task.subject,
            'due_date', current_task.due_date,
            'trigger_text', current_task.trigger_text
        ), transition_answer, transition_reason, authored_channel
    ) returning id into new_history_id;

    update public.portfolio_tasks
    set current_history_id = new_history_id
    where id = current_task.id and user_id = current_user_id;

    for evidence_input in select value from jsonb_array_elements(input_payload -> 'evidence') loop
        insert into public.portfolio_task_evidence (
            user_id, task_id, task_history_id, title, source_url, summary, checked_at
        ) values (
            current_user_id, current_task.id, new_history_id,
            trim(evidence_input ->> 'title'), trim(evidence_input ->> 'source_url'),
            trim(evidence_input ->> 'summary'), (evidence_input ->> 'checked_at')::timestamptz
        );
    end loop;

    insert into public.activity_events (
        user_id, source, action_type, target_table, target_id, before_data, after_data, status
    ) values (
        current_user_id, case when authored_channel = 'app' then 'user' else 'agent' end,
        'transition_portfolio_task', 'portfolio_tasks', current_task.id::text,
        jsonb_build_object(
            'version', current_task.version,
            'control_state', current_task.control_state,
            'research_state', current_task.research_state
        ),
        jsonb_build_object(
            'version', current_task.version + 1,
            'control_state', next_control_state,
            'research_state', next_research_state
        ), 'succeeded'
    );

    response_payload := public.app_get_portfolio_task(current_task.id);
    insert into public.decision_task_mutation_receipts (
        user_id, operation, idempotency_key, request_payload, response_payload
    ) values (
        current_user_id, 'transition_portfolio_task', input_idempotency_key,
        request_payload, response_payload
    );
    return response_payload;
end;
$$;

grant select on public.portfolio_task_evidence to authenticated;
grant execute on function public.app_transition_investment_decision(uuid, integer, uuid, jsonb) to authenticated;
grant execute on function public.app_transition_portfolio_task(uuid, integer, uuid, jsonb) to authenticated;
