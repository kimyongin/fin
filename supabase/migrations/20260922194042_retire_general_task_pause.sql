-- Older paused general tasks become ended, not performed. Their old history
-- and any actual completed occurrences remain unchanged for later export.
update public.portfolio_tasks
set control_state='cancelled',version=version+1,updated_at=clock_timestamp()
where kind='general' and control_state='paused';

-- New calls cannot enter the retired pause/resume state. The existing cancel
-- transition is the whole-task ending operation; it creates no completion.
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
