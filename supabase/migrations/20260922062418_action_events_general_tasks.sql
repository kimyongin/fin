alter table public.portfolio_tasks drop constraint portfolio_tasks_kind_check;
alter table public.portfolio_tasks add constraint portfolio_tasks_kind_check
    check (kind in ('general', 'research', 'execution'));
alter table public.portfolio_tasks drop constraint portfolio_tasks_kind_state_check;
alter table public.portfolio_tasks add constraint portfolio_tasks_kind_state_check check (
    (kind = 'research' and research_state is not null)
    or (kind in ('general', 'execution') and research_state is null)
);

alter table public.activity_events add column task_id uuid;
alter table public.activity_events add column occurred_at timestamptz;
alter table public.activity_events add column occurrence_on date;
update public.activity_events set occurred_at = created_at where occurred_at is null;
alter table public.activity_events alter column occurred_at set default clock_timestamp();
alter table public.activity_events alter column occurred_at set not null;
alter table public.activity_events add constraint activity_events_task_fk
    foreign key (user_id, task_id) references public.portfolio_tasks(user_id, id) on delete restrict;
create index activity_events_user_occurred_idx
    on public.activity_events(user_id, occurred_at desc, id desc);
create index activity_events_task_occurred_idx
    on public.activity_events(user_id, task_id, occurred_at desc, id desc)
    where task_id is not null;

create table public.general_task_mutation_receipts (
    user_id uuid not null references auth.users(id) on delete cascade,
    operation text not null,
    idempotency_key uuid not null,
    request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
    response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
    created_at timestamptz not null default clock_timestamp(),
    primary key (user_id, operation, idempotency_key)
);
alter table public.general_task_mutation_receipts enable row level security;
create policy general_task_mutation_receipts_select_own
    on public.general_task_mutation_receipts for select to authenticated
    using ((select auth.uid()) = user_id);
revoke all on public.general_task_mutation_receipts from public, anon, authenticated;
grant select on public.general_task_mutation_receipts to authenticated;

create or replace function public.app_general_task_status(input_task_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select case
        when task.control_state = 'cancelled' then 'cancelled'
        when task.control_state = 'paused' then 'paused'
        when latest.action_type = 'complete_general_task' then 'done'
        else 'open'
    end
    from public.portfolio_tasks task
    left join lateral (
        select event.action_type
        from public.activity_events event
        where event.user_id = task.user_id
          and event.task_id = task.id
          and event.action_type in ('complete_general_task', 'reopen_general_task')
        order by event.occurred_at desc, event.id desc
        limit 1
    ) latest on true
    where task.id = input_task_id
      and task.user_id = auth.uid()
      and task.kind = 'general';
$$;

create or replace function public.app_get_general_task(input_task_id uuid)
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
        'status', public.app_general_task_status(task.id),
        'created_at', task.created_at,
        'updated_at', task.updated_at,
        'history', coalesce((
            select jsonb_agg(jsonb_build_object(
                'version', history.version,
                'control_state', history.control_state,
                'content_snapshot', history.content_snapshot,
                'change_reason', history.change_reason,
                'authored_via', history.authored_via,
                'created_at', history.created_at
            ) order by history.version)
            from public.portfolio_task_history history
            where history.user_id = auth.uid() and history.task_id = task.id
        ), '[]'::jsonb),
        'events', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', event.id,
                'action_type', event.action_type,
                'source', event.source,
                'after_data', event.after_data,
                'occurred_at', event.occurred_at,
                'occurrence_on', event.occurrence_on,
                'created_at', event.created_at
            ) order by event.occurred_at, event.id)
            from public.activity_events event
            where event.user_id = auth.uid() and event.task_id = task.id
        ), '[]'::jsonb)
    )
    from public.portfolio_tasks task
    where task.id = input_task_id and task.user_id = auth.uid() and task.kind = 'general';
$$;

create or replace function public.app_list_general_task_page(
    input_filter text default 'active',
    input_limit integer default 20,
    input_cursor jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    normalized_filter text := lower(trim(coalesce(input_filter, 'active')));
    page_limit integer := greatest(1, least(coalesce(input_limit, 20), 100));
    cursor_updated_at timestamptz;
    cursor_id uuid;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    if normalized_filter not in ('active', 'completed', 'paused', 'cancelled', 'all') then
        raise exception 'Invalid general task filter';
    end if;
    if input_cursor is not null then
        if jsonb_typeof(input_cursor) <> 'object' or not (input_cursor ? 'updated_at') or not (input_cursor ? 'id') then
            raise exception 'Invalid general task cursor';
        end if;
        cursor_updated_at := (input_cursor ->> 'updated_at')::timestamptz;
        cursor_id := (input_cursor ->> 'id')::uuid;
    end if;
    return (
        with candidates as (
            select task.*, public.app_general_task_status(task.id) status
            from public.portfolio_tasks task
            where task.user_id = auth.uid() and task.kind = 'general'
        ), filtered as (
            select task.*
            from candidates task
            where (normalized_filter = 'all'
                or (normalized_filter = 'active' and task.status = 'open')
                or (normalized_filter = 'completed' and task.status = 'done')
                or task.status = normalized_filter)
              and (cursor_updated_at is null or (task.updated_at, task.id) < (cursor_updated_at, cursor_id))
            order by task.updated_at desc, task.id desc
            limit page_limit + 1
        ), page as (
            select * from filtered order by updated_at desc, id desc limit page_limit
        )
        select jsonb_build_object(
            'items', coalesce((select jsonb_agg(jsonb_build_object(
                'id', task.id, 'kind', task.kind, 'version', task.version,
                'title', task.title, 'subject', task.subject, 'due_date', task.due_date,
                'timezone', task.timezone, 'trigger_text', task.trigger_text,
                'control_state', task.control_state, 'status', task.status,
                'created_at', task.created_at, 'updated_at', task.updated_at
            ) order by task.updated_at desc, task.id desc) from page task), '[]'::jsonb),
            'next_cursor', case when (select count(*) from filtered) > page_limit then (
                select jsonb_build_object('updated_at', task.updated_at, 'id', task.id)
                from page task order by task.updated_at, task.id limit 1
            ) else null end
        )
    );
end;
$$;

create or replace function public.app_save_general_task(
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
    stored_receipt public.general_task_mutation_receipts%rowtype;
    task_id uuid := coalesce(input_task_id, gen_random_uuid());
    history_id uuid;
    next_version integer;
    normalized_title text;
    normalized_timezone text;
    normalized_subject jsonb;
    normalized_due_date date;
    normalized_trigger text;
    authored_channel text;
    change_reason text;
    request_payload jsonb;
    response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if coalesce(jsonb_typeof(input_payload), 'null') <> 'object' then raise exception 'General task payload must be an object'; end if;
    normalized_title := trim(coalesce(input_payload ->> 'title', ''));
    normalized_timezone := trim(coalesce(input_payload ->> 'timezone', 'Asia/Seoul'));
    normalized_subject := coalesce(input_payload -> 'subject', jsonb_build_object('kind', 'portfolio'));
    normalized_trigger := nullif(trim(coalesce(input_payload ->> 'trigger_text', '')), '');
    authored_channel := trim(coalesce(input_payload ->> 'authored_via', 'agent'));
    change_reason := nullif(trim(coalesce(input_payload ->> 'change_reason', '')), '');
    if char_length(normalized_title) not between 1 and 500 then raise exception 'General task title is required and must be at most 500 characters'; end if;
    if not exists (select 1 from pg_timezone_names where name = normalized_timezone) then raise exception 'Invalid timezone'; end if;
    if jsonb_typeof(normalized_subject) <> 'object' or trim(coalesce(normalized_subject ->> 'kind', '')) not in ('portfolio', 'instrument', 'position') then raise exception 'General task subject must have a supported kind'; end if;
    if authored_channel not in ('app', 'agent') then raise exception 'Invalid authored_via'; end if;
    if nullif(trim(coalesce(input_payload ->> 'due_date', '')), '') is not null then
        begin normalized_due_date := (input_payload ->> 'due_date')::date;
        exception when invalid_datetime_format then raise exception 'Invalid due date'; end;
    end if;
    request_payload := jsonb_build_object('task_id', input_task_id, 'expected_version', input_expected_version, 'payload', input_payload);
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':save_general_task:' || input_idempotency_key::text, 0));
    select * into stored_receipt from public.general_task_mutation_receipts
    where user_id = current_user_id and operation = 'save_general_task' and idempotency_key = input_idempotency_key;
    if found then
        if stored_receipt.request_payload <> request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
        return stored_receipt.response_payload;
    end if;
    if input_task_id is null then
        if input_expected_version is not null then raise exception 'New general task cannot have expected version'; end if;
        next_version := 1;
        insert into public.portfolio_tasks(id,user_id,kind,version,title,subject,due_date,timezone,trigger_text,control_state,research_state)
        values(task_id,current_user_id,'general',1,normalized_title,normalized_subject,normalized_due_date,normalized_timezone,normalized_trigger,'active',null);
    else
        select * into current_task from public.portfolio_tasks task
        where task.id = input_task_id and task.user_id = current_user_id for update;
        if not found or current_task.kind <> 'general' then raise exception 'General task was not found'; end if;
        if input_expected_version is null or current_task.version <> input_expected_version then raise exception 'General task version conflict'; end if;
        next_version := current_task.version + 1;
        update public.portfolio_tasks set version=next_version,title=normalized_title,subject=normalized_subject,
            due_date=normalized_due_date,timezone=normalized_timezone,trigger_text=normalized_trigger,updated_at=clock_timestamp()
        where id=task_id and user_id=current_user_id;
    end if;
    insert into public.portfolio_task_history(user_id,task_id,version,control_state,research_state,content_snapshot,change_reason,authored_via)
    values(current_user_id,task_id,next_version,coalesce(current_task.control_state,'active'),null,
        jsonb_build_object('title',normalized_title,'subject',normalized_subject,'due_date',normalized_due_date,'trigger_text',normalized_trigger),
        change_reason,authored_channel) returning id into history_id;
    update public.portfolio_tasks set current_history_id=history_id where id=task_id and user_id=current_user_id;
    insert into public.activity_events(user_id,source,action_type,target_table,target_id,task_id,before_data,after_data,status,occurred_at,occurrence_on)
    values(current_user_id,case when authored_channel='app' then 'user' else 'agent' end,
        case when input_task_id is null then 'create_general_task' else 'update_general_task' end,
        'portfolio_tasks',task_id::text,task_id,
        case when input_task_id is null then null else jsonb_build_object('version',current_task.version,'title',current_task.title,'due_date',current_task.due_date) end,
        jsonb_build_object('version',next_version,'title',normalized_title,'due_date',normalized_due_date),
        'succeeded',clock_timestamp(),(clock_timestamp() at time zone normalized_timezone)::date);
    response_payload := public.app_get_general_task(task_id);
    insert into public.general_task_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(current_user_id,'save_general_task',input_idempotency_key,request_payload,response_payload);
    return response_payload;
end;
$$;

create or replace function public.app_transition_general_task(
    input_task_id uuid,
    input_expected_version integer,
    input_action text,
    input_result text,
    input_reason text,
    input_occurrence_on date,
    input_idempotency_key uuid,
    input_authored_via text default 'agent'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    current_task public.portfolio_tasks%rowtype;
    stored_receipt public.general_task_mutation_receipts%rowtype;
    normalized_action text := lower(trim(coalesce(input_action, '')));
    normalized_result text := nullif(trim(coalesce(input_result, '')), '');
    normalized_reason text := nullif(trim(coalesce(input_reason, '')), '');
    current_status text;
    next_control_state text;
    next_version integer;
    effective_on date;
    history_id uuid;
    request_payload jsonb;
    response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_expected_version is null or input_expected_version < 1 then raise exception 'Expected version is required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if input_authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
    if normalized_action not in ('complete','reopen','pause','resume','cancel') then raise exception 'Invalid general task transition'; end if;
    request_payload := jsonb_build_object('task_id',input_task_id,'expected_version',input_expected_version,'action',normalized_action,
        'result',normalized_result,'reason',normalized_reason,'occurrence_on',input_occurrence_on,'authored_via',input_authored_via);
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':transition_general_task:' || input_idempotency_key::text, 0));
    select * into stored_receipt from public.general_task_mutation_receipts
    where user_id=current_user_id and operation='transition_general_task' and idempotency_key=input_idempotency_key;
    if found then
        if stored_receipt.request_payload <> request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
        return stored_receipt.response_payload;
    end if;
    select * into current_task from public.portfolio_tasks task
    where task.id=input_task_id and task.user_id=current_user_id for update;
    if not found or current_task.kind<>'general' then raise exception 'General task was not found'; end if;
    if current_task.version<>input_expected_version then raise exception 'General task version conflict'; end if;
    current_status := public.app_general_task_status(current_task.id);
    next_control_state := current_task.control_state;
    if normalized_action='complete' then
        if current_status<>'open' then raise exception 'Only an open general task can be completed'; end if;
        effective_on := coalesce(input_occurrence_on,(clock_timestamp() at time zone current_task.timezone)::date);
    elsif normalized_action='reopen' then
        if current_status<>'done' then raise exception 'Only a completed general task can be reopened'; end if;
        if normalized_reason is null then raise exception 'Reopening a general task needs a reason'; end if;
        effective_on := coalesce(input_occurrence_on,(clock_timestamp() at time zone current_task.timezone)::date);
    elsif normalized_action='pause' then
        if current_status<>'open' then raise exception 'Only an open general task can be paused'; end if;
        next_control_state := 'paused';
    elsif normalized_action='resume' then
        if current_task.control_state<>'paused' then raise exception 'Only a paused general task can resume'; end if;
        next_control_state := 'active';
    elsif normalized_action='cancel' then
        if current_task.control_state='cancelled' then raise exception 'General task is already cancelled'; end if;
        if normalized_reason is null then raise exception 'Cancelling a general task needs a reason'; end if;
        next_control_state := 'cancelled';
    end if;
    next_version := current_task.version + 1;
    update public.portfolio_tasks set version=next_version,control_state=next_control_state,updated_at=clock_timestamp()
    where id=current_task.id and user_id=current_user_id;
    insert into public.portfolio_task_history(user_id,task_id,version,control_state,research_state,content_snapshot,answer,change_reason,authored_via)
    values(current_user_id,current_task.id,next_version,next_control_state,null,
        jsonb_build_object('title',current_task.title,'subject',current_task.subject,'due_date',current_task.due_date,'trigger_text',current_task.trigger_text),
        normalized_result,normalized_reason,input_authored_via) returning id into history_id;
    update public.portfolio_tasks set current_history_id=history_id where id=current_task.id and user_id=current_user_id;
    insert into public.activity_events(user_id,source,action_type,target_table,target_id,task_id,before_data,after_data,status,occurred_at,occurrence_on)
    values(current_user_id,case when input_authored_via='app' then 'user' else 'agent' end,
        normalized_action || '_general_task','portfolio_tasks',current_task.id::text,current_task.id,
        jsonb_build_object('version',current_task.version,'status',current_status,'control_state',current_task.control_state),
        jsonb_build_object('version',next_version,'status',case when normalized_action='complete' then 'done' when normalized_action='reopen' then 'open' else next_control_state end,
            'control_state',next_control_state,'title',current_task.title,'result',normalized_result,'reason',normalized_reason),
        'succeeded',clock_timestamp(),effective_on);
    response_payload := public.app_get_general_task(current_task.id);
    insert into public.general_task_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(current_user_id,'transition_general_task',input_idempotency_key,request_payload,response_payload);
    return response_payload;
end;
$$;

create or replace function public.app_record_manual_activity(
    input_title text,
    input_result text,
    input_occurred_at timestamptz,
    input_timezone text,
    input_idempotency_key uuid,
    input_authored_via text default 'agent'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_title text := trim(coalesce(input_title,''));
    normalized_result text := nullif(trim(coalesce(input_result,'')),'');
    normalized_timezone text := trim(coalesce(input_timezone,'Asia/Seoul'));
    effective_at timestamptz := coalesce(input_occurred_at,clock_timestamp());
    stored_receipt public.general_task_mutation_receipts%rowtype;
    request_payload jsonb;
    response_payload jsonb;
    event_id bigint;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if char_length(normalized_title) not between 1 and 500 then raise exception 'Manual activity title is required and must be at most 500 characters'; end if;
    if normalized_result is not null and char_length(normalized_result)>4000 then raise exception 'Manual activity result is too long'; end if;
    if input_authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
    if not exists(select 1 from pg_timezone_names where name=normalized_timezone) then raise exception 'Invalid timezone'; end if;
    if effective_at>clock_timestamp()+interval '5 minutes' then raise exception 'Manual activity cannot be in the future'; end if;
    request_payload:=jsonb_build_object('title',normalized_title,'result',normalized_result,'occurred_at',effective_at,'timezone',normalized_timezone,'authored_via',input_authored_via);
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':record_manual_activity:' || input_idempotency_key::text,0));
    select * into stored_receipt from public.general_task_mutation_receipts
    where user_id=current_user_id and operation='record_manual_activity' and idempotency_key=input_idempotency_key;
    if found then
        if stored_receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
        return stored_receipt.response_payload;
    end if;
    insert into public.activity_events(user_id,source,action_type,target_table,after_data,status,occurred_at,occurrence_on)
    values(current_user_id,case when input_authored_via='app' then 'user' else 'agent' end,'record_manual_activity','manual_activities',
        jsonb_build_object('title',normalized_title,'result',normalized_result,'reported',true),'succeeded',effective_at,(effective_at at time zone normalized_timezone)::date)
    returning id into event_id;
    response_payload:=jsonb_build_object('id',event_id,'action_type','record_manual_activity','title',normalized_title,'result',normalized_result,
        'occurred_at',effective_at,'occurrence_on',(effective_at at time zone normalized_timezone)::date,'source',input_authored_via);
    insert into public.general_task_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(current_user_id,'record_manual_activity',input_idempotency_key,request_payload,response_payload);
    return response_payload;
end;
$$;

create or replace function public.app_update_entity_note(
    input_entity_type text,
    input_entity_id bigint,
    input_expected_note text,
    input_note text,
    input_idempotency_key uuid,
    input_source text default 'app'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_expected text := nullif(trim(coalesce(input_expected_note, '')), '');
    normalized_note text := nullif(trim(coalesce(input_note, '')), '');
    current_note text;
    request jsonb;
    response jsonb;
    receipt public.entity_note_mutation_receipts%rowtype;
    target_table text;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_source not in ('app', 'agent') then raise exception 'Invalid note source'; end if;
    if input_entity_type not in ('account', 'instrument', 'holding') then raise exception 'Invalid note entity type'; end if;
    if input_entity_id is null or input_entity_id <= 0 then raise exception 'Entity id must be positive'; end if;
    if normalized_note is not null and char_length(normalized_note) > 4000 then raise exception 'Entity note is too long'; end if;
    request := jsonb_build_object('entity_type',input_entity_type,'entity_id',input_entity_id,
        'expected_note',normalized_expected,'note',normalized_note,'source',input_source);
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':entity-note:' || input_idempotency_key::text, 0));
    select * into receipt from public.entity_note_mutation_receipts
    where user_id=current_user_id and idempotency_key=input_idempotency_key;
    if found then
        if receipt.request_payload<>request then raise exception 'Idempotency key was already used with a different request'; end if;
        return receipt.response_payload;
    end if;
    if input_entity_type='account' then
        select note into current_note from public.accounts where id=input_entity_id and user_id=current_user_id for update;
        target_table:='accounts';
    elsif input_entity_type='instrument' then
        select note into current_note from public.instruments where id=input_entity_id and user_id=current_user_id for update;
        target_table:='instruments';
    else
        select note into current_note from public.holdings where id=input_entity_id and user_id=current_user_id for update;
        target_table:='holdings';
    end if;
    if not found then raise exception 'Entity was not found or is not accessible'; end if;
    current_note:=nullif(trim(coalesce(current_note,'')),'');
    if current_note is distinct from normalized_expected then raise exception 'Entity note conflict'; end if;
    response:=jsonb_build_object('entity_type',input_entity_type,'entity_id',input_entity_id,'note',normalized_note);
    if current_note is distinct from normalized_note then
        if input_entity_type='account' then update public.accounts set note=normalized_note where id=input_entity_id and user_id=current_user_id;
        elsif input_entity_type='instrument' then update public.instruments set note=normalized_note where id=input_entity_id and user_id=current_user_id;
        else update public.holdings set note=normalized_note where id=input_entity_id and user_id=current_user_id;
        end if;
        insert into public.activity_events(user_id,source,action_type,target_table,target_id,before_data,after_data,status)
        values(current_user_id,case when input_source='app' then 'user' else 'agent' end,'update_entity_note',target_table,input_entity_id::text,
            jsonb_build_object('note',current_note),jsonb_build_object('note',normalized_note),'succeeded');
    end if;
    insert into public.entity_note_mutation_receipts(user_id,idempotency_key,request_payload,response_payload)
    values(current_user_id,input_idempotency_key,request,response);
    return response;
end;
$$;

create or replace function public.log_holding_verification_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.activity_events(user_id,source,action_type,target_table,target_id,after_data,status,occurred_at,occurrence_on)
    values(new.user_id,case when new.source='app' then 'user' else 'agent' end,'verify_holding','holding_verifications',new.id::text,
        jsonb_build_object('holding_id',new.holding_id,'instrument_id',new.instrument_id,'verified_fields',new.verified_fields,
            'verified_on',new.verified_on,'note',new.note,'source',new.source),
        'succeeded',clock_timestamp(),new.verified_on);
    return new;
end;
$$;
create trigger log_holding_verification_activity_trigger
after insert on public.holding_verifications
for each row execute function public.log_holding_verification_activity();

create or replace function public.log_task_fill_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare task_timezone text;
begin
    select timezone into task_timezone from public.portfolio_tasks where id=new.task_id and user_id=new.user_id;
    insert into public.activity_events(user_id,source,action_type,target_table,target_id,task_id,after_data,status,occurred_at,occurrence_on)
    values(new.user_id,'agent','link_trade_to_task','task_fill_links',new.trade_entry_id::text,new.task_id,
        jsonb_build_object('trade_entry_id',new.trade_entry_id,'task_id',new.task_id),'succeeded',clock_timestamp(),
        (clock_timestamp() at time zone coalesce(task_timezone,'Asia/Seoul'))::date);
    return new;
end;
$$;
create trigger log_task_fill_activity_trigger
after insert on public.task_fill_links
for each row execute function public.log_task_fill_activity();

create or replace function public.log_execution_task_transition_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare previous_control text; task_row public.portfolio_tasks%rowtype;
begin
    select * into task_row from public.portfolio_tasks where id=new.task_id and user_id=new.user_id;
    if not found or task_row.kind<>'execution' or new.version<=1 then return new; end if;
    select history.control_state into previous_control
    from public.portfolio_task_history history
    where history.user_id=new.user_id and history.task_id=new.task_id and history.version<new.version
    order by history.version desc limit 1;
    if previous_control is distinct from new.control_state then
        insert into public.activity_events(user_id,source,action_type,target_table,target_id,task_id,before_data,after_data,status,occurred_at,occurrence_on)
        values(new.user_id,case when new.authored_via='app' then 'user' else 'agent' end,'transition_execution_task','portfolio_tasks',new.task_id::text,new.task_id,
            jsonb_build_object('control_state',previous_control),jsonb_build_object('control_state',new.control_state,'reason',new.change_reason,'title',task_row.title),
            'succeeded',clock_timestamp(),(clock_timestamp() at time zone task_row.timezone)::date);
    end if;
    return new;
end;
$$;
create trigger log_execution_task_transition_activity_trigger
after insert on public.portfolio_task_history
for each row execute function public.log_execution_task_transition_activity();

revoke all on function public.app_general_task_status(uuid) from public, anon, authenticated;
revoke all on function public.app_get_general_task(uuid) from public, anon;
revoke all on function public.app_list_general_task_page(text,integer,jsonb) from public, anon;
revoke all on function public.app_save_general_task(uuid,integer,uuid,jsonb) from public, anon;
revoke all on function public.app_transition_general_task(uuid,integer,text,text,text,date,uuid,text) from public, anon;
revoke all on function public.app_record_manual_activity(text,text,timestamptz,text,uuid,text) from public, anon;
revoke all on function public.log_holding_verification_activity() from public, anon, authenticated;
revoke all on function public.log_task_fill_activity() from public, anon, authenticated;
revoke all on function public.log_execution_task_transition_activity() from public, anon, authenticated;
grant execute on function public.app_get_general_task(uuid) to authenticated;
grant execute on function public.app_list_general_task_page(text,integer,jsonb) to authenticated;
grant execute on function public.app_save_general_task(uuid,integer,uuid,jsonb) to authenticated;
grant execute on function public.app_transition_general_task(uuid,integer,text,text,text,date,uuid,text) to authenticated;
grant execute on function public.app_record_manual_activity(text,text,timestamptz,text,uuid,text) to authenticated;
