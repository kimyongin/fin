-- A general task is current intent. Completed/reopened work is already in
-- activity_events and recurrence status in general_task_occurrence_states.
-- Keep the current-row version only for concurrent edits and transitions.
create or replace function public.app_get_general_task(input_task_id uuid)
returns jsonb language sql volatile security definer set search_path = public as $$
  select jsonb_build_object(
    'id', task.id, 'kind', task.kind, 'version', task.version, 'title', task.title,
    'subject', task.subject, 'due_date', task.due_date, 'timezone', task.timezone,
    'trigger_text', task.trigger_text, 'control_state', task.control_state,
    'recurrence_kind', task.recurrence_kind, 'recurrence_start_on', task.recurrence_start_on,
    'occurrence_on', case when task.recurrence_kind='daily' then (clock_timestamp() at time zone task.timezone)::date else null end,
    'status', case
      when task.control_state='cancelled' then 'cancelled'
      when task.recurrence_kind='daily' and (clock_timestamp() at time zone task.timezone)::date < task.recurrence_start_on then 'not_scheduled'
      else coalesce((select state.status from public.general_task_occurrence_states state
        where state.user_id=task.user_id and state.task_id=task.id
          and state.occurrence_key=case when task.recurrence_kind='daily' then (clock_timestamp() at time zone task.timezone)::date else date '0001-01-01' end),'open')
    end,
    'created_at', task.created_at, 'updated_at', task.updated_at,
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
  task_id uuid:=coalesce(input_task_id,gen_random_uuid()); next_version integer;
  normalized_title text; normalized_timezone text; normalized_subject jsonb; normalized_due_date date;
  normalized_trigger text; authored_channel text;
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
    insert into public.portfolio_tasks(id,user_id,kind,version,title,subject,due_date,timezone,trigger_text,control_state,recurrence_kind,recurrence_start_on)
    values(task_id,current_user_id,'general',1,normalized_title,normalized_subject,normalized_due_date,normalized_timezone,normalized_trigger,'active',normalized_recurrence,normalized_start_on);
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
  effective_on:=coalesce(input_occurrence_on,local_today);
  if effective_on>local_today then raise exception 'A general task occurrence cannot be completed in the future'; end if;
  if current_task.recurrence_kind='daily' and effective_on<current_task.recurrence_start_on then raise exception 'General task occurrence is before its recurrence start'; end if;
  current_status:=case
    when current_task.control_state='cancelled' then 'cancelled'
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

alter table public.portfolio_tasks drop column current_history_id;
drop table public.portfolio_task_history;
