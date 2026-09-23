-- A task detail edits its current fields and tags in one transaction.
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

create function public.app_save_general_task_detail(
  input_task_id uuid, input_expected_version integer, input_idempotency_key uuid,
  input_payload jsonb, input_tag_ids uuid[]
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  current_user_id uuid:=auth.uid();
  request_payload jsonb; stored_receipt public.general_task_mutation_receipts%rowtype;
  saved jsonb; response_payload jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if input_task_id is null or input_idempotency_key is null then raise exception 'Task and idempotency key are required'; end if;
  request_payload:=jsonb_build_object('task_id',input_task_id,'expected_version',input_expected_version,
    'payload',input_payload,'tag_ids',to_jsonb(coalesce(input_tag_ids,array[]::uuid[])));
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':save_general_task_detail:'||input_idempotency_key::text,0));
  select * into stored_receipt from public.general_task_mutation_receipts
    where user_id=current_user_id and operation='save_general_task_detail' and idempotency_key=input_idempotency_key;
  if found then
    if stored_receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return stored_receipt.response_payload;
  end if;
  saved:=public.app_save_general_task(input_task_id,input_expected_version,input_idempotency_key,input_payload);
  perform public.app_set_general_task_tags(input_task_id,(saved->>'version')::integer,input_tag_ids,input_idempotency_key);
  response_payload:=public.app_get_general_task(input_task_id);
  insert into public.general_task_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
  values(current_user_id,'save_general_task_detail',input_idempotency_key,request_payload,response_payload);
  return response_payload;
end;
$$;

revoke all on function public.app_save_general_task_detail(uuid,integer,uuid,jsonb,uuid[]) from public, anon;
grant execute on function public.app_save_general_task_detail(uuid,integer,uuid,jsonb,uuid[]) to authenticated;
