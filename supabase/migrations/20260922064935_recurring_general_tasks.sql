alter table public.portfolio_tasks
    add column recurrence_kind text not null default 'none'
        check (recurrence_kind in ('none', 'daily')),
    add column recurrence_start_on date;
alter table public.portfolio_tasks add constraint portfolio_tasks_recurrence_check check (
    (recurrence_kind = 'none' and recurrence_start_on is null)
    or (kind = 'general' and recurrence_kind = 'daily' and recurrence_start_on is not null)
);

create table public.general_task_occurrence_states (
    user_id uuid not null references auth.users(id) on delete cascade,
    task_id uuid not null,
    occurrence_key date not null,
    occurrence_on date,
    status text not null check (status in ('open','done')),
    updated_at timestamptz not null default clock_timestamp(),
    primary key (user_id,task_id,occurrence_key),
    foreign key (user_id,task_id) references public.portfolio_tasks(user_id,id) on delete cascade,
    check ((occurrence_key=date '0001-01-01' and occurrence_on is null) or occurrence_key=occurrence_on)
);
alter table public.general_task_occurrence_states enable row level security;
create policy general_task_occurrence_states_select_own on public.general_task_occurrence_states
  for select to authenticated using(user_id=auth.uid());
revoke all on public.general_task_occurrence_states from public,anon,authenticated;
grant select on public.general_task_occurrence_states to authenticated;

insert into public.general_task_occurrence_states(user_id,task_id,occurrence_key,occurrence_on,status,updated_at)
select ranked.user_id,ranked.task_id,ranked.occurrence_key,ranked.occurrence_on,
  case when ranked.action_type='complete_general_task' then 'done' else 'open' end,ranked.occurred_at
from (
  select distinct on(event.user_id,event.task_id,case when task.recurrence_kind='daily' then event.occurrence_on else date '0001-01-01' end)
    event.user_id,event.task_id,
    case when task.recurrence_kind='daily' then event.occurrence_on else date '0001-01-01' end occurrence_key,
    case when task.recurrence_kind='daily' then event.occurrence_on else null end occurrence_on,
    event.action_type,event.occurred_at,event.id
  from public.activity_events event join public.portfolio_tasks task on task.user_id=event.user_id and task.id=event.task_id
  where task.kind='general' and event.action_type in ('complete_general_task','reopen_general_task')
  order by event.user_id,event.task_id,case when task.recurrence_kind='daily' then event.occurrence_on else date '0001-01-01' end,event.id desc
) ranked;

create or replace function public.app_get_general_task(input_task_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'id', task.id, 'kind', task.kind, 'version', task.version, 'title', task.title,
        'subject', task.subject, 'due_date', task.due_date, 'timezone', task.timezone,
        'trigger_text', task.trigger_text, 'control_state', task.control_state,
        'recurrence_kind', task.recurrence_kind, 'recurrence_start_on', task.recurrence_start_on,
        'occurrence_on', case when task.recurrence_kind='daily' then (clock_timestamp() at time zone task.timezone)::date else null end,
        'status', case
          when task.control_state='cancelled' then 'cancelled'
          when task.control_state='paused' then 'paused'
          when task.recurrence_kind='daily' and (clock_timestamp() at time zone task.timezone)::date<task.recurrence_start_on then 'not_scheduled'
          else coalesce((select state.status from public.general_task_occurrence_states state
            where state.user_id=task.user_id and state.task_id=task.id
              and state.occurrence_key=case when task.recurrence_kind='daily' then (clock_timestamp() at time zone task.timezone)::date else date '0001-01-01' end),'open')
        end,
        'created_at', task.created_at, 'updated_at', task.updated_at,
        'history', coalesce((select jsonb_agg(jsonb_build_object(
            'version', history.version, 'control_state', history.control_state,
            'content_snapshot', history.content_snapshot, 'change_reason', history.change_reason,
            'authored_via', history.authored_via, 'created_at', history.created_at
        ) order by history.version) from public.portfolio_task_history history
          where history.user_id=auth.uid() and history.task_id=task.id), '[]'::jsonb),
        'events', coalesce((select jsonb_agg(jsonb_build_object(
            'id', event.id, 'action_type', event.action_type, 'source', event.source,
            'after_data', event.after_data, 'occurred_at', event.occurred_at,
            'occurrence_on', event.occurrence_on, 'created_at', event.created_at
        ) order by event.occurred_at,event.id) from public.activity_events event
          where event.user_id=auth.uid() and event.task_id=task.id), '[]'::jsonb)
    )
    from public.portfolio_tasks task
    where task.id=input_task_id and task.user_id=auth.uid() and task.kind='general';
$$;

create or replace function public.app_save_general_task(
    input_task_id uuid, input_expected_version integer, input_idempotency_key uuid, input_payload jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
    current_user_id uuid:=auth.uid(); current_task public.portfolio_tasks%rowtype;
    stored_receipt public.general_task_mutation_receipts%rowtype;
    task_id uuid:=coalesce(input_task_id,gen_random_uuid()); history_id uuid; next_version integer;
    normalized_title text; normalized_timezone text; normalized_subject jsonb; normalized_due_date date;
    normalized_trigger text; authored_channel text; change_reason text;
    normalized_recurrence text; normalized_start_on date; request_payload jsonb; response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if coalesce(jsonb_typeof(input_payload),'null')<>'object' then raise exception 'General task payload must be an object'; end if;
    normalized_title:=trim(coalesce(input_payload->>'title',''));
    normalized_timezone:=trim(coalesce(input_payload->>'timezone','Asia/Seoul'));
    normalized_subject:=coalesce(input_payload->'subject',jsonb_build_object('kind','portfolio'));
    normalized_trigger:=nullif(trim(coalesce(input_payload->>'trigger_text','')),'');
    authored_channel:=trim(coalesce(input_payload->>'authored_via','agent'));
    change_reason:=nullif(trim(coalesce(input_payload->>'change_reason','')),'');
    normalized_recurrence:=lower(trim(coalesce(input_payload->>'recurrence_kind','none')));
    if char_length(normalized_title) not between 1 and 500 then raise exception 'General task title is required and must be at most 500 characters'; end if;
    if not exists(select 1 from pg_timezone_names where name=normalized_timezone) then raise exception 'Invalid timezone'; end if;
    if jsonb_typeof(normalized_subject)<>'object' or trim(coalesce(normalized_subject->>'kind','')) not in ('portfolio','instrument','position') then raise exception 'General task subject must have a supported kind'; end if;
    if authored_channel not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
    if normalized_recurrence not in ('none','daily') then raise exception 'Invalid recurrence kind'; end if;
    if nullif(trim(coalesce(input_payload->>'due_date','')),'') is not null then
      begin normalized_due_date:=(input_payload->>'due_date')::date; exception when invalid_datetime_format then raise exception 'Invalid due date'; end;
    end if;
    if nullif(trim(coalesce(input_payload->>'recurrence_start_on','')),'') is not null then
      begin normalized_start_on:=(input_payload->>'recurrence_start_on')::date; exception when invalid_datetime_format then raise exception 'Invalid recurrence start date'; end;
    end if;
    if normalized_recurrence='daily' and normalized_start_on is null then raise exception 'Daily recurrence needs a start date'; end if;
    if normalized_recurrence='none' then normalized_start_on:=null; end if;
    request_payload:=jsonb_build_object('task_id',input_task_id,'expected_version',input_expected_version,'payload',input_payload);
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':save_general_task:'||input_idempotency_key::text,0));
    select * into stored_receipt from public.general_task_mutation_receipts
      where user_id=current_user_id and operation='save_general_task' and idempotency_key=input_idempotency_key;
    if found then
      if stored_receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
      return stored_receipt.response_payload;
    end if;
    if input_task_id is null then
      if input_expected_version is not null then raise exception 'New general task cannot have expected version'; end if;
      next_version:=1;
      insert into public.portfolio_tasks(id,user_id,kind,version,title,subject,due_date,timezone,trigger_text,control_state,research_state,recurrence_kind,recurrence_start_on)
      values(task_id,current_user_id,'general',1,normalized_title,normalized_subject,normalized_due_date,normalized_timezone,normalized_trigger,'active',null,normalized_recurrence,normalized_start_on);
    else
      select * into current_task from public.portfolio_tasks task where task.id=input_task_id and task.user_id=current_user_id for update;
      if not found or current_task.kind<>'general' then raise exception 'General task was not found'; end if;
      if input_expected_version is null or current_task.version<>input_expected_version then raise exception 'General task version conflict'; end if;
      next_version:=current_task.version+1;
      update public.portfolio_tasks set version=next_version,title=normalized_title,subject=normalized_subject,due_date=normalized_due_date,
        timezone=normalized_timezone,trigger_text=normalized_trigger,recurrence_kind=normalized_recurrence,
        recurrence_start_on=normalized_start_on,updated_at=clock_timestamp()
      where id=task_id and user_id=current_user_id;
    end if;
    insert into public.portfolio_task_history(user_id,task_id,version,control_state,research_state,content_snapshot,change_reason,authored_via)
    values(current_user_id,task_id,next_version,coalesce(current_task.control_state,'active'),null,
      jsonb_build_object('title',normalized_title,'subject',normalized_subject,'due_date',normalized_due_date,'trigger_text',normalized_trigger,
        'timezone',normalized_timezone,'recurrence_kind',normalized_recurrence,'recurrence_start_on',normalized_start_on),change_reason,authored_channel)
    returning id into history_id;
    update public.portfolio_tasks set current_history_id=history_id where id=task_id and user_id=current_user_id;
    insert into public.activity_events(user_id,source,action_type,target_table,target_id,task_id,before_data,after_data,status,occurred_at,occurrence_on)
    values(current_user_id,case when authored_channel='app' then 'user' else 'agent' end,
      case when input_task_id is null then 'create_general_task' else 'update_general_task' end,'portfolio_tasks',task_id::text,task_id,
      case when input_task_id is null then null else jsonb_build_object('version',current_task.version,'title',current_task.title,'recurrence_kind',current_task.recurrence_kind,'recurrence_start_on',current_task.recurrence_start_on) end,
      jsonb_build_object('version',next_version,'title',normalized_title,'due_date',normalized_due_date,'recurrence_kind',normalized_recurrence,'recurrence_start_on',normalized_start_on),
      'succeeded',clock_timestamp(),(clock_timestamp() at time zone normalized_timezone)::date);
    response_payload:=public.app_get_general_task(task_id);
    insert into public.general_task_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
      values(current_user_id,'save_general_task',input_idempotency_key,request_payload,response_payload);
    return response_payload;
end;
$$;

create or replace function public.app_transition_general_task(
    input_task_id uuid, input_expected_version integer, input_action text, input_result text,
    input_reason text, input_occurrence_on date, input_idempotency_key uuid, input_authored_via text default 'agent'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
    current_user_id uuid:=auth.uid(); current_task public.portfolio_tasks%rowtype;
    stored_receipt public.general_task_mutation_receipts%rowtype; normalized_action text:=lower(trim(coalesce(input_action,'')));
    normalized_result text:=nullif(trim(coalesce(input_result,'')),''); normalized_reason text:=nullif(trim(coalesce(input_reason,'')),'');
    current_status text; next_control_state text; next_version integer; effective_on date; local_today date;
    history_id uuid; request_payload jsonb; response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_expected_version is null or input_expected_version<1 then raise exception 'Expected version is required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if input_authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
    if normalized_action not in ('complete','reopen','pause','resume','cancel') then raise exception 'Invalid general task transition'; end if;
    request_payload:=jsonb_build_object('task_id',input_task_id,'expected_version',input_expected_version,'action',normalized_action,
      'result',normalized_result,'reason',normalized_reason,'occurrence_on',input_occurrence_on,'authored_via',input_authored_via);
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':transition_general_task:'||input_idempotency_key::text,0));
    select * into stored_receipt from public.general_task_mutation_receipts
      where user_id=current_user_id and operation='transition_general_task' and idempotency_key=input_idempotency_key;
    if found then
      if stored_receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
      return stored_receipt.response_payload;
    end if;
    select * into current_task from public.portfolio_tasks task where task.id=input_task_id and task.user_id=current_user_id for update;
    if not found or current_task.kind<>'general' then raise exception 'General task was not found'; end if;
    if current_task.version<>input_expected_version then raise exception 'General task version conflict'; end if;
    local_today:=(clock_timestamp() at time zone current_task.timezone)::date;
    effective_on:=coalesce(input_occurrence_on,local_today);
    if effective_on>local_today then raise exception 'A general task occurrence cannot be completed in the future'; end if;
    if current_task.recurrence_kind='daily' and effective_on<current_task.recurrence_start_on then raise exception 'General task occurrence is before its recurrence start'; end if;
    current_status:=case
      when current_task.control_state='cancelled' then 'cancelled'
      when current_task.control_state='paused' then 'paused'
      when current_task.recurrence_kind='daily' and effective_on<current_task.recurrence_start_on then 'not_scheduled'
      else coalesce((select state.status from public.general_task_occurrence_states state
        where state.user_id=current_user_id and state.task_id=current_task.id
          and state.occurrence_key=case when current_task.recurrence_kind='daily' then effective_on else date '0001-01-01' end),'open')
    end;
    next_control_state:=current_task.control_state;
    if normalized_action='complete' then
      if current_status<>'open' then raise exception 'Only an open general task occurrence can be completed'; end if;
    elsif normalized_action='reopen' then
      if current_status<>'done' then raise exception 'Only a completed general task occurrence can be reopened'; end if;
      if normalized_reason is null then raise exception 'Reopening a general task needs a reason'; end if;
    elsif normalized_action='pause' then
      if current_task.control_state<>'active' then raise exception 'Only an active general task can be paused'; end if;
      next_control_state:='paused'; effective_on:=null;
    elsif normalized_action='resume' then
      if current_task.control_state<>'paused' then raise exception 'Only a paused general task can resume'; end if;
      next_control_state:='active'; effective_on:=null;
    elsif normalized_action='cancel' then
      if current_task.control_state='cancelled' then raise exception 'General task is already cancelled'; end if;
      if normalized_reason is null then raise exception 'Cancelling a general task needs a reason'; end if;
      next_control_state:='cancelled'; effective_on:=null;
    end if;
    next_version:=current_task.version+1;
    update public.portfolio_tasks set version=next_version,control_state=next_control_state,updated_at=clock_timestamp()
      where id=current_task.id and user_id=current_user_id;
    insert into public.portfolio_task_history(user_id,task_id,version,control_state,research_state,content_snapshot,answer,change_reason,authored_via)
    values(current_user_id,current_task.id,next_version,next_control_state,null,
      jsonb_build_object('title',current_task.title,'subject',current_task.subject,'due_date',current_task.due_date,'trigger_text',current_task.trigger_text,
        'timezone',current_task.timezone,'recurrence_kind',current_task.recurrence_kind,'recurrence_start_on',current_task.recurrence_start_on),
      normalized_result,normalized_reason,input_authored_via) returning id into history_id;
    update public.portfolio_tasks set current_history_id=history_id where id=current_task.id and user_id=current_user_id;
    if normalized_action in ('complete','reopen') then
      insert into public.general_task_occurrence_states(user_id,task_id,occurrence_key,occurrence_on,status)
      values(current_user_id,current_task.id,
        case when current_task.recurrence_kind='daily' then effective_on else date '0001-01-01' end,
        case when current_task.recurrence_kind='daily' then effective_on else null end,
        case when normalized_action='complete' then 'done' else 'open' end)
      on conflict(user_id,task_id,occurrence_key) do update
        set status=excluded.status,occurrence_on=excluded.occurrence_on,updated_at=clock_timestamp();
    end if;
    insert into public.activity_events(user_id,source,action_type,target_table,target_id,task_id,before_data,after_data,status,occurred_at,occurrence_on)
    values(current_user_id,case when input_authored_via='app' then 'user' else 'agent' end,normalized_action||'_general_task',
      'portfolio_tasks',current_task.id::text,current_task.id,
      jsonb_build_object('version',current_task.version,'status',current_status,'control_state',current_task.control_state),
      jsonb_build_object('version',next_version,'status',case when normalized_action='complete' then 'done' when normalized_action='reopen' then 'open' else next_control_state end,
        'control_state',next_control_state,'title',current_task.title,'result',normalized_result,'reason',normalized_reason,
        'recurrence_kind',current_task.recurrence_kind),
      'succeeded',clock_timestamp(),effective_on);
    response_payload:=public.app_get_general_task(current_task.id);
    insert into public.general_task_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
      values(current_user_id,'transition_general_task',input_idempotency_key,request_payload,response_payload);
    return response_payload;
end;
$$;

create or replace function public.app_list_general_task_page(
    input_filter text default 'active', input_limit integer default 20, input_cursor jsonb default null
)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare
    normalized_filter text:=lower(trim(coalesce(input_filter,'active')));
    page_limit integer:=greatest(1,least(coalesce(input_limit,20),100));
    cursor_updated_at timestamptz; cursor_id uuid;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    if normalized_filter not in ('active','completed','paused','cancelled','all') then raise exception 'Invalid general task filter'; end if;
    if input_cursor is not null then
      if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'updated_at') or not(input_cursor?'id') then raise exception 'Invalid general task cursor'; end if;
      cursor_updated_at:=(input_cursor->>'updated_at')::timestamptz; cursor_id:=(input_cursor->>'id')::uuid;
    end if;
    return (with candidates as (
      select task.*,case
          when task.control_state='cancelled' then 'cancelled'
          when task.control_state='paused' then 'paused'
          when task.recurrence_kind='daily' and (clock_timestamp() at time zone task.timezone)::date<task.recurrence_start_on then 'not_scheduled'
          else coalesce(state.status,'open')
        end status,
        case when task.recurrence_kind='daily' then (clock_timestamp() at time zone task.timezone)::date else null end occurrence_on
      from public.portfolio_tasks task
      left join public.general_task_occurrence_states state on state.user_id=task.user_id and state.task_id=task.id
        and state.occurrence_key=case when task.recurrence_kind='daily' then (clock_timestamp() at time zone task.timezone)::date else date '0001-01-01' end
      where task.user_id=auth.uid() and task.kind='general'
    ), filtered as (
      select task.* from candidates task
      where (normalized_filter='all' or (normalized_filter='active' and task.status='open')
        or (normalized_filter='completed' and task.status='done') or task.status=normalized_filter)
        and (cursor_updated_at is null or (task.updated_at,task.id)<(cursor_updated_at,cursor_id))
      order by task.updated_at desc,task.id desc limit page_limit+1
    ), page as (select * from filtered order by updated_at desc,id desc limit page_limit)
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',task.id,'kind',task.kind,'version',task.version,'title',task.title,'subject',task.subject,
        'due_date',task.due_date,'timezone',task.timezone,'trigger_text',task.trigger_text,
        'control_state',task.control_state,'status',task.status,'recurrence_kind',task.recurrence_kind,
        'recurrence_start_on',task.recurrence_start_on,'occurrence_on',task.occurrence_on,
        'created_at',task.created_at,'updated_at',task.updated_at
      ) order by task.updated_at desc,task.id desc) from page task),'[]'::jsonb),
      'next_cursor',case when (select count(*) from filtered)>page_limit then (
        select jsonb_build_object('updated_at',task.updated_at,'id',task.id) from page task order by task.updated_at,task.id limit 1
      ) else null end));
end;
$$;

drop function public.app_general_task_status(uuid);
