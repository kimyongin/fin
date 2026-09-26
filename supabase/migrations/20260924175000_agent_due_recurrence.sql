-- One task definition, one status per performed date. No scheduled job or
-- pre-created occurrence rows are required.
alter table public.portfolio_tasks drop constraint portfolio_tasks_recurrence_check;
alter table public.portfolio_tasks drop constraint portfolio_tasks_recurrence_kind_check;
alter table public.portfolio_tasks add column recurrence_weekdays integer[] not null default '{}';
alter table public.portfolio_tasks add column recurrence_time time;
alter table public.portfolio_tasks add constraint portfolio_tasks_recurrence_kind_check
  check (recurrence_kind in ('none','daily','weekly'));
alter table public.portfolio_tasks add constraint portfolio_tasks_recurrence_check check (
  (recurrence_kind='none' and recurrence_start_on is null and cardinality(recurrence_weekdays)=0)
  or (kind='general' and recurrence_kind='daily' and recurrence_start_on is not null and cardinality(recurrence_weekdays)=0)
  or (kind='general' and recurrence_kind='weekly' and recurrence_start_on is not null
    and cardinality(recurrence_weekdays) between 1 and 7
    and recurrence_weekdays <@ array[1,2,3,4,5,6,7])
);

create function public.app_task_due_occurrence(
  input_kind text,input_start date,input_weekdays integer[],input_due date,
  input_time time,input_timezone text,input_at timestamptz default clock_timestamp()
) returns date language plpgsql stable security invoker set search_path=public as $$
declare local_now timestamp; candidate date; offset_days integer;
begin
  local_now:=input_at at time zone input_timezone;
  if input_kind='none' then
    if input_due is null or local_now >= input_due::timestamp+coalesce(input_time,time '00:00')
      then return date '0001-01-01'; end if;
    return null;
  end if;
  if input_start is null then return null; end if;
  for offset_days in 0..6 loop
    candidate:=local_now::date-offset_days;
    if candidate<input_start then return null; end if;
    if input_kind='daily' or (input_kind='weekly' and extract(isodow from candidate)::integer=any(input_weekdays)) then
      if candidate::timestamp+coalesce(input_time,time '00:00')<=local_now then return candidate; end if;
    end if;
  end loop;
  return null;
end;
$$;

-- Read-only owner-specific due queue. The occurrence key must be sent back
-- unchanged when completing so a newer occurrence cannot be silently claimed.
create function public.app_list_due_general_tasks(input_limit integer default 100,input_offset integer default 0)
returns jsonb language sql volatile security definer set search_path=public as $$
  with candidates as (
    select task.*,
      public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,
        task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) due_on
    from public.portfolio_tasks task
    where task.user_id=auth.uid() and task.kind='general' and task.control_state='active'
  ), due as (
    select candidate.* from candidates candidate
    where candidate.due_on is not null and not exists (
      select 1 from public.general_task_occurrence_states state
      where state.user_id=candidate.user_id and state.task_id=candidate.id
        and state.occurrence_key=candidate.due_on and state.status='done')
  ), page as (
    select * from due order by updated_at,id
    limit greatest(1,least(coalesce(input_limit,100),100))
    offset greatest(0,coalesce(input_offset,0))
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',item.id,'version',item.version,'title',item.title,'trigger_text',item.trigger_text,
      'subject',item.subject,'due_date',item.due_date,'timezone',item.timezone,
      'recurrence_kind',item.recurrence_kind,'recurrence_start_on',item.recurrence_start_on,
      'recurrence_weekdays',item.recurrence_weekdays,'recurrence_time',item.recurrence_time,
      'occurrence_on',case when item.recurrence_kind='none' then null else item.due_on end)
      order by item.updated_at,item.id) from page item),'[]'::jsonb),
    'next_offset',case when (select count(*) from due)>greatest(0,coalesce(input_offset,0))+
      greatest(1,least(coalesce(input_limit,100),100))
      then greatest(0,coalesce(input_offset,0))+greatest(1,least(coalesce(input_limit,100),100)) end);
$$;
revoke all on function public.app_list_due_general_tasks(integer,integer) from public,anon;
grant execute on function public.app_list_due_general_tasks(integer,integer) to authenticated;


create or replace function public.app_get_general_task(input_task_id uuid)
returns jsonb language sql volatile security definer set search_path = public as $$
  select jsonb_build_object(
    'id', task.id, 'kind', task.kind, 'version', task.version, 'title', task.title,
    'subject', task.subject, 'due_date', task.due_date, 'timezone', task.timezone,
    'trigger_text', task.trigger_text, 'control_state', task.control_state,
    'recurrence_kind', task.recurrence_kind, 'recurrence_start_on', task.recurrence_start_on,
    'recurrence_weekdays',task.recurrence_weekdays,'recurrence_time',task.recurrence_time,
    'occurrence_on', case when task.recurrence_kind='none' then null else public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) end,
    'status', case
      when task.control_state='cancelled' then 'cancelled'
      when public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) is null then 'not_scheduled'
      else coalesce((select state.status from public.general_task_occurrence_states state
        where state.user_id=task.user_id and state.task_id=task.id
          and state.occurrence_key=public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone)),'open')
    end,
    'created_at', task.created_at, 'updated_at', task.updated_at,
    'tags', coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
      from public.portfolio_task_activity_tags relation
      join public.activity_tags tag on tag.user_id=relation.user_id and tag.id=relation.tag_id
      where relation.user_id=task.user_id and relation.task_id=task.id),'[]'::jsonb),
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

create or replace function public.app_get_general_task_for_owner(input_owner_user_id uuid,input_task_id uuid)
returns jsonb language sql volatile security definer set search_path=public as $$
  select case
    when auth.uid() is null then null
    when input_owner_user_id=auth.uid() then public.app_get_general_task(input_task_id)
    when public.can_view_feature(input_owner_user_id,'tasks') then (
      select jsonb_build_object(
        'id',task.id,'kind',task.kind,'version',task.version,'title',task.title,
        'subject',task.subject,'due_date',task.due_date,'timezone',task.timezone,
        'trigger_text',task.trigger_text,'control_state',task.control_state,
        'recurrence_kind',task.recurrence_kind,'recurrence_start_on',task.recurrence_start_on,
        'recurrence_weekdays',task.recurrence_weekdays,'recurrence_time',task.recurrence_time,
        'occurrence_on',case when task.recurrence_kind='none' then null else
          public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,
            task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) end,
        'status',case
          when task.control_state='cancelled' then 'cancelled'
          when public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,
            task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) is null then 'not_scheduled'
          else coalesce((select occurrence.status from public.general_task_occurrence_states occurrence
            where occurrence.user_id=task.user_id and occurrence.task_id=task.id
              and occurrence.occurrence_key=public.app_task_due_occurrence(task.recurrence_kind,
                task.recurrence_start_on,task.recurrence_weekdays,task.due_date,
                task.recurrence_time,task.timezone)),'open') end,
        'created_at',task.created_at,'updated_at',task.updated_at,
        'history','[]'::jsonb,'events','[]'::jsonb)
      from public.portfolio_tasks task
      where task.user_id=input_owner_user_id and task.id=input_task_id and task.kind='general')
    else null end;
$$;

create or replace function public.app_save_general_task(
  input_task_id uuid, input_expected_version integer, input_idempotency_key uuid, input_payload jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  current_user_id uuid:=auth.uid(); current_task public.portfolio_tasks%rowtype;
  stored_receipt public.general_task_mutation_receipts%rowtype;
  task_id uuid:=coalesce(input_task_id,gen_random_uuid()); next_version integer;
  normalized_title text; normalized_timezone text; normalized_subject jsonb; normalized_due_date date;
  normalized_trigger text; authored_channel text;
  normalized_recurrence text; normalized_start_on date; normalized_days integer[]; normalized_time time; request_payload jsonb; response_payload jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if coalesce(jsonb_typeof(input_payload),'null')<>'object' then raise exception 'General task payload must be an object'; end if;
  normalized_title:=trim(coalesce(input_payload->>'title',''));
  normalized_timezone:=trim(coalesce(input_payload->>'timezone','Asia/Seoul'));
  normalized_subject:=coalesce(input_payload->'subject',jsonb_build_object('kind','portfolio'));
  normalized_trigger:=nullif(trim(coalesce(input_payload->>'trigger_text','')),'');
  authored_channel:=trim(coalesce(input_payload->>'authored_via','agent'));
  normalized_recurrence:=lower(trim(coalesce(input_payload->>'recurrence_kind','none')));
  if char_length(normalized_title) not between 1 and 500 then raise exception 'General task title is required and must be at most 500 characters'; end if;
  if not exists(select 1 from pg_timezone_names where name=normalized_timezone) then raise exception 'Invalid timezone'; end if;
  if jsonb_typeof(normalized_subject)<>'object' or trim(coalesce(normalized_subject->>'kind','')) not in ('portfolio','instrument','position') then raise exception 'General task subject must have a supported kind'; end if;
  if authored_channel not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
  if normalized_recurrence not in ('none','daily','weekly') then raise exception 'Invalid recurrence kind'; end if;
  if coalesce(jsonb_typeof(input_payload->'recurrence_weekdays'),'array')<>'array' then raise exception 'Weekdays must be an array'; end if;
  begin
    select coalesce(array_agg(value::integer order by value::integer),array[]::integer[]) into normalized_days
      from jsonb_array_elements_text(coalesce(input_payload->'recurrence_weekdays','[]'::jsonb)) value;
  exception when others then raise exception 'Invalid weekdays'; end;
  if exists(select 1 from unnest(normalized_days) day where day<1 or day>7) or
    (select count(distinct day) from unnest(normalized_days) day)<>cardinality(normalized_days) then raise exception 'Invalid weekdays'; end if;
  if nullif(input_payload->>'recurrence_time','') is not null then
    begin normalized_time:=(input_payload->>'recurrence_time')::time; exception when others then raise exception 'Invalid recurrence time'; end;
  end if;
  if nullif(trim(coalesce(input_payload->>'due_date','')),'') is not null then
    begin normalized_due_date:=(input_payload->>'due_date')::date; exception when invalid_datetime_format then raise exception 'Invalid due date'; end;
  end if;
  if nullif(trim(coalesce(input_payload->>'recurrence_start_on','')),'') is not null then
    begin normalized_start_on:=(input_payload->>'recurrence_start_on')::date; exception when invalid_datetime_format then raise exception 'Invalid recurrence start date'; end;
  end if;
  if normalized_recurrence in ('daily','weekly') and normalized_start_on is null then raise exception 'Recurrence needs a start date'; end if;
  if normalized_recurrence='weekly' and cardinality(normalized_days)=0 then raise exception 'Weekly recurrence needs a weekday'; end if;
  if normalized_recurrence<>'weekly' and cardinality(normalized_days)>0 then raise exception 'Weekdays require weekly recurrence'; end if;
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
    insert into public.portfolio_tasks(id,user_id,kind,version,title,subject,due_date,timezone,trigger_text,control_state,recurrence_kind,recurrence_start_on,recurrence_weekdays,recurrence_time)
    values(task_id,current_user_id,'general',1,normalized_title,normalized_subject,normalized_due_date,normalized_timezone,normalized_trigger,'active',normalized_recurrence,normalized_start_on,normalized_days,normalized_time);
  else
    select * into current_task from public.portfolio_tasks task where task.id=input_task_id and task.user_id=current_user_id for update;
    if not found or current_task.kind<>'general' then raise exception 'General task was not found'; end if;
    if input_expected_version is null or current_task.version<>input_expected_version then raise exception 'General task version conflict'; end if;
    next_version:=current_task.version+1;
    update public.portfolio_tasks set version=next_version,title=normalized_title,subject=normalized_subject,due_date=normalized_due_date,
      timezone=normalized_timezone,trigger_text=normalized_trigger,recurrence_kind=normalized_recurrence,
      recurrence_start_on=normalized_start_on,recurrence_weekdays=normalized_days,recurrence_time=normalized_time,updated_at=clock_timestamp()
    where id=task_id and user_id=current_user_id;
  end if;
  insert into public.activity_events(user_id,source,action_type,target_table,target_id,task_id,before_data,after_data,status,occurred_at,occurrence_on)
  values(current_user_id,case when authored_channel='app' then 'user' else 'agent' end,
    case when input_task_id is null then 'create_general_task' else 'update_general_task' end,'portfolio_tasks',task_id::text,task_id,
    case when input_task_id is null then null else jsonb_build_object('version',current_task.version,'title',current_task.title,'recurrence_kind',current_task.recurrence_kind,'recurrence_start_on',current_task.recurrence_start_on) end,
    jsonb_build_object('version',next_version,'title',normalized_title,'due_date',normalized_due_date,'recurrence_kind',normalized_recurrence,'recurrence_start_on',normalized_start_on,'recurrence_weekdays',normalized_days,'recurrence_time',normalized_time),
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
  current_status text; next_control_state text; next_version integer; effective_on date; due_on date; local_today date;
  request_payload jsonb; response_payload jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if input_expected_version is null or input_expected_version<1 then raise exception 'Expected version is required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if input_authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
  if normalized_action not in ('complete','reopen','cancel') then raise exception 'Invalid general task transition'; end if;
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
  due_on:=public.app_task_due_occurrence(current_task.recurrence_kind,current_task.recurrence_start_on,current_task.recurrence_weekdays,current_task.due_date,current_task.recurrence_time,current_task.timezone);
  effective_on:=coalesce(input_occurrence_on,due_on);
  if current_task.recurrence_kind='none' and input_occurrence_on is not null then
    if input_occurrence_on>local_today then raise exception 'A general task occurrence cannot be completed in the future'; end if;
    effective_on:=due_on;
  end if;
  if effective_on>local_today then raise exception 'A general task occurrence cannot be completed in the future'; end if;
  if normalized_action='complete' and (due_on is null or effective_on is null or effective_on>due_on
    or (input_authored_via='agent' and effective_on is distinct from due_on)) then
    raise exception 'Requested occurrence is not the latest due occurrence';
  end if;
  if current_task.recurrence_kind<>'none' and effective_on<current_task.recurrence_start_on then raise exception 'General task occurrence is before its recurrence start'; end if;
  current_status:=case
    when current_task.control_state='cancelled' then 'cancelled'
    when effective_on is null then 'not_scheduled'
    else coalesce((select state.status from public.general_task_occurrence_states state
      where state.user_id=current_user_id and state.task_id=current_task.id
        and state.occurrence_key=case when current_task.recurrence_kind<>'none' then effective_on else date '0001-01-01' end),'open')
  end;
  next_control_state:=current_task.control_state;
  if normalized_action='complete' then
    if current_status<>'open' then raise exception 'Only an open general task occurrence can be completed'; end if;
  elsif normalized_action='reopen' then
    if current_status<>'done' then raise exception 'Only a completed general task occurrence can be reopened'; end if;
    if normalized_reason is null then raise exception 'Reopening a general task needs a reason'; end if;
  elsif normalized_action='cancel' then
    if current_task.control_state='cancelled' then raise exception 'General task is already cancelled'; end if;
    if normalized_reason is null then raise exception 'Cancelling a general task needs a reason'; end if;
    next_control_state:='cancelled'; effective_on:=null;
  end if;
  next_version:=current_task.version+1;
  update public.portfolio_tasks set version=next_version,control_state=next_control_state,updated_at=clock_timestamp()
    where id=current_task.id and user_id=current_user_id;
  if normalized_action in ('complete','reopen') then
    insert into public.general_task_occurrence_states(user_id,task_id,occurrence_key,occurrence_on,status)
    values(current_user_id,current_task.id,
      case when current_task.recurrence_kind<>'none' then effective_on else date '0001-01-01' end,
      case when current_task.recurrence_kind<>'none' then effective_on else null end,
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
    'succeeded',clock_timestamp(),case when current_task.recurrence_kind='none' and normalized_action<>'cancel' then local_today else effective_on end);
  response_payload:=public.app_get_general_task(current_task.id);
  insert into public.general_task_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(current_user_id,'transition_general_task',input_idempotency_key,request_payload,response_payload);
  return response_payload;
end;
$$;


create or replace function public.app_list_action_timeline(
  input_owner_user_id uuid default null,input_filter text default 'all',
  input_from date default null,input_to date default null,input_limit integer default 30,
  input_cursor jsonb default null,input_timezone text default 'Asia/Seoul'
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
  normalized_filter text:=lower(trim(coalesce(input_filter,'all')));
  page_limit integer:=greatest(1,least(coalesce(input_limit,30),100));
  cursor_at timestamptz;
  cursor_id bigint;
  tasks_allowed boolean;
  activity_allowed boolean;
  assets_allowed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if selected_owner is null then raise exception 'Owner is required'; end if;
  if normalized_filter not in ('all','pending','done') then raise exception 'Invalid action timeline filter'; end if;
  if input_from is not null and input_to is not null and input_from>input_to then raise exception 'Invalid action timeline date range'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'occurred_at') or not(input_cursor?'id') then
      raise exception 'Invalid action timeline cursor'; end if;
    begin cursor_at:=(input_cursor->>'occurred_at')::timestamptz;
      cursor_id:=(input_cursor->>'id')::bigint;
    exception when others then raise exception 'Invalid action timeline cursor'; end;
  end if;
  tasks_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks');
  activity_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity');
  assets_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'assets');
  return (with pending_rows as (
    select task.id,task.kind,task.version,task.title,
      case when assets_allowed then task.subject else task.subject-'holding_id'-'account_id'-'instrument_id' end subject,
      task.due_date,task.timezone,task.trigger_text,task.control_state,task.recurrence_kind,task.recurrence_start_on,
      task.recurrence_weekdays,task.recurrence_time,
      case when task.recurrence_kind='none' then null else public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) end occurrence_on,
      coalesce(occurrence.status,'open') status,task.created_at,task.updated_at
    from public.portfolio_tasks task
    left join public.general_task_occurrence_states occurrence
      on occurrence.user_id=task.user_id and occurrence.task_id=task.id
      and occurrence.occurrence_key=public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone)
    where tasks_allowed and normalized_filter in ('all','pending') and task.user_id=selected_owner
      and task.kind='general' and task.control_state='active'
      and coalesce(occurrence.status,'open')='open'
  ), eligible_events as (
    select event.id,event.title,event.body,event.source,event.occurred_at,event.created_at,
      event.status,case when tasks_allowed then event.task_id end task_id,
      case when assets_allowed then event.instrument_id end instrument_id,
      coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date) display_date,
      coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
        from public.activity_event_tags relation join public.activity_tags tag
          on tag.user_id=relation.user_id and tag.id=relation.tag_id
        where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb) tags
    from public.activity_events event
    where activity_allowed and normalized_filter in ('all','done') and event.user_id=selected_owner
      and event.status='succeeded'
      and event.action_type not in ('create_general_task','update_general_task')
      and (input_from is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)>=input_from)
      and (input_to is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)<=input_to)
      and (cursor_at is null or (event.occurred_at,event.id)<(cursor_at,cursor_id))
  ), bounded as (select * from eligible_events order by occurred_at desc,id desc limit page_limit+1),
  page as (select * from bounded order by occurred_at desc,id desc limit page_limit),
  days as (select display_date,count(*)::integer item_count,
    jsonb_agg(to_jsonb(item)-'display_date' order by occurred_at desc,id desc) items
    from page item group by display_date)
  select jsonb_build_object(
    'pending',coalesce((select jsonb_agg(to_jsonb(item) order by item.due_date nulls last,item.updated_at desc,item.id desc)
      from pending_rows item),'[]'::jsonb),
    'days',coalesce((select jsonb_agg(jsonb_build_object('date',day.display_date,'item_count',day.item_count,
      'items',day.items) order by day.display_date desc) from days day),'[]'::jsonb),
    'next_cursor',case when (select count(*) from bounded)>page_limit then
      (select jsonb_build_object('occurred_at',item.occurred_at,'id',item.id)
       from page item order by item.occurred_at,item.id limit 1) end));
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
          when public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) is null then 'not_scheduled'
          else coalesce(state.status,'open')
        end status,
        case when task.recurrence_kind='none' then null else public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) end occurrence_on
      from public.portfolio_tasks task
      left join public.general_task_occurrence_states state on state.user_id=task.user_id and state.task_id=task.id
        and state.occurrence_key=public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone)
      where task.user_id=auth.uid() and task.kind='general'
    ), filtered as (
      select task.* from candidates task
      where (normalized_filter='all' or (normalized_filter='active' and task.status in ('open','not_scheduled'))
        or (normalized_filter='completed' and task.status='done') or task.status=normalized_filter)
        and (cursor_updated_at is null or (task.updated_at,task.id)<(cursor_updated_at,cursor_id))
      order by task.updated_at desc,task.id desc limit page_limit+1
    ), page as (select * from filtered order by updated_at desc,id desc limit page_limit)
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',task.id,'kind',task.kind,'version',task.version,'title',task.title,'subject',task.subject,
        'due_date',task.due_date,'timezone',task.timezone,'trigger_text',task.trigger_text,
        'control_state',task.control_state,'status',task.status,'recurrence_kind',task.recurrence_kind,
        'recurrence_start_on',task.recurrence_start_on,'recurrence_weekdays',task.recurrence_weekdays,
        'recurrence_time',task.recurrence_time,'occurrence_on',task.occurrence_on,
        'created_at',task.created_at,'updated_at',task.updated_at
      ) order by task.updated_at desc,task.id desc) from page task),'[]'::jsonb),
      'next_cursor',case when (select count(*) from filtered)>page_limit then (
        select jsonb_build_object('updated_at',task.updated_at,'id',task.id) from page task order by task.updated_at,task.id limit 1
      ) else null end));
end;
$$;


create or replace function public.app_search_activities(
  input_owner_user_id uuid default null,input_query text default null,
  input_from date default null,input_to date default null,input_record_state text default 'all',
  input_instrument_id bigint default null,input_tag_ids uuid[] default null,
  input_tag_match text default 'any',input_limit integer default 30,
  input_cursor jsonb default null,input_timezone text default 'Asia/Seoul'
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
  query_text text:=nullif(lower(trim(coalesce(input_query,''))), '');
  record_state text:=lower(trim(coalesce(input_record_state,'all')));
  tag_match text:=lower(trim(coalesce(input_tag_match,'any')));
  selected_tags uuid[]:=coalesce(input_tag_ids,array[]::uuid[]);
  page_limit integer:=greatest(1,least(coalesce(input_limit,30),100));
  cursor_at timestamptz;
  cursor_key text;
  tasks_allowed boolean;
  activity_allowed boolean;
  assets_allowed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if selected_owner is null then raise exception 'Owner is required'; end if;
  if record_state not in ('all','todo','done') then raise exception 'Invalid activity record state'; end if;
  if tag_match not in ('any','all') then raise exception 'Invalid activity tag match'; end if;
  if input_from is not null and input_to is not null and input_from>input_to then raise exception 'Invalid activity search date range'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
  if cardinality(selected_tags)>20 or array_position(selected_tags,null) is not null then raise exception 'Invalid activity tags'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'sort_at') or not(input_cursor?'key') then
      raise exception 'Invalid activity search cursor'; end if;
    begin cursor_at:=(input_cursor->>'sort_at')::timestamptz;
      cursor_key:=input_cursor->>'key';
    exception when others then raise exception 'Invalid activity search cursor'; end;
  end if;
  tasks_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks');
  activity_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity');
  assets_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'assets');
  if not assets_allowed and input_instrument_id is not null then
    raise exception 'Asset access required for target filters';
  end if;
  return (with task_rows as (
    select 'todo'::text record_state,'task'::text record_type,task.id::text record_id,
      null::bigint activity_id,task.id task_id,task.kind task_kind,task.title,task.trigger_text body,task.due_date,
      null::timestamptz occurred_at,task.created_at,task.updated_at,task.updated_at sort_at,
      'task:'||task.id::text record_key,task.version,
      case when assets_allowed then task.subject else task.subject-'holding_id'-'account_id'-'instrument_id' end subject,
      case when assets_allowed and task.subject->>'instrument_id' ~ '^[0-9]+$' then (task.subject->>'instrument_id')::bigint end instrument_id,
      coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
        from public.portfolio_task_activity_tags relation join public.activity_tags tag
          on tag.user_id=relation.user_id and tag.id=relation.tag_id
        where relation.user_id=task.user_id and relation.task_id=task.id),'[]'::jsonb) tags
    from public.portfolio_tasks task
    left join public.general_task_occurrence_states state
      on state.user_id=task.user_id and state.task_id=task.id
      and state.occurrence_key=public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone)
    where tasks_allowed and record_state in ('all','todo') and task.user_id=selected_owner
      and task.control_state='active' and coalesce(state.status,'open')='open'
      and (input_instrument_id is null or task.subject->>'instrument_id'=input_instrument_id::text)
      and (query_text is null or strpos(lower(concat_ws(' ',task.title,task.trigger_text)),query_text)>0)
      and (cardinality(selected_tags)=0 or case when tag_match='all' then
        (select count(distinct relation.tag_id) from public.portfolio_task_activity_tags relation
          where relation.user_id=task.user_id and relation.task_id=task.id and relation.tag_id=any(selected_tags))=cardinality(selected_tags)
        else exists(select 1 from public.portfolio_task_activity_tags relation
          where relation.user_id=task.user_id and relation.task_id=task.id and relation.tag_id=any(selected_tags)) end)
  ), event_rows as (
    select 'done'::text record_state,'activity'::text record_type,event.id::text record_id,
      event.id activity_id,case when tasks_allowed then event.task_id end task_id,null::text task_kind,
      coalesce(event.title,'기록') title,event.body,null::date due_date,event.occurred_at,
      event.created_at,event.updated_at,event.occurred_at sort_at,'activity:'||event.id::text record_key,
      case when selected_owner=auth.uid() then event.version end version,null::jsonb subject,
      case when assets_allowed then event.instrument_id end instrument_id,
      coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
        from public.activity_event_tags relation join public.activity_tags tag
          on tag.user_id=relation.user_id and tag.id=relation.tag_id
        where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb) tags
    from public.activity_events event
    where activity_allowed and record_state in ('all','done') and event.user_id=selected_owner
      and event.status='succeeded'
      and event.action_type not in ('create_general_task','update_general_task')
      and (input_from is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)>=input_from)
      and (input_to is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)<=input_to)
      and (input_instrument_id is null or event.instrument_id=input_instrument_id)
      and (query_text is null or strpos(lower(concat_ws(' ',event.title,event.body)),query_text)>0)
      and (cardinality(selected_tags)=0 or case when tag_match='all' then
        (select count(distinct relation.tag_id) from public.activity_event_tags relation
          where relation.user_id=event.user_id and relation.activity_event_id=event.id and relation.tag_id=any(selected_tags))=cardinality(selected_tags)
        else exists(select 1 from public.activity_event_tags relation
          where relation.user_id=event.user_id and relation.activity_event_id=event.id and relation.tag_id=any(selected_tags)) end)
  ), combined as (select * from task_rows union all select * from event_rows),
  bounded as (select * from combined where cursor_at is null or (sort_at,record_key)<(cursor_at,cursor_key)
    order by sort_at desc,record_key desc limit page_limit+1),
  page as (select * from bounded order by sort_at desc,record_key desc limit page_limit)
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(item)-'sort_at'-'record_key' order by sort_at desc,record_key desc)
      from page item),'[]'::jsonb),
    'next_cursor',case when (select count(*) from bounded)>page_limit then
      (select jsonb_build_object('sort_at',sort_at,'key',record_key) from page order by sort_at,record_key limit 1) end));
end;
$$;
