-- Deleting a task removes intent, not the records of work already performed.
-- Keep the composite owner/task FK and detach only the optional task_id.
create function public.app_delete_general_task(
  input_task_id uuid, input_expected_version integer, input_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  selected_task public.portfolio_tasks%rowtype;
  stored_receipt public.general_task_mutation_receipts%rowtype;
  request_payload jsonb;
  response_payload jsonb;
  detached_count integer;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_task_id is null or input_idempotency_key is null then raise exception 'Task and idempotency key are required'; end if;
  request_payload:=jsonb_build_object('task_id',input_task_id,'expected_version',input_expected_version);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':delete_general_task:'||input_idempotency_key::text,0));
  select * into stored_receipt from public.general_task_mutation_receipts
    where user_id=owner_id and operation='delete_general_task' and idempotency_key=input_idempotency_key;
  if found then
    if stored_receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return stored_receipt.response_payload;
  end if;
  select * into selected_task from public.portfolio_tasks task
    where task.id=input_task_id and task.user_id=owner_id and task.kind='general' for update;
  if not found then raise exception 'General task was not found'; end if;
  if input_expected_version is null or selected_task.version<>input_expected_version then raise exception 'General task version conflict'; end if;
  update public.activity_events event set task_id=null
    where event.user_id=owner_id and event.task_id=input_task_id;
  get diagnostics detached_count = row_count;
  -- A lost response to an older create/save/transition must not return a live
  -- task snapshot after deletion. It must also not repeat that mutation.
  update public.general_task_mutation_receipts receipt
    set response_payload=jsonb_build_object('id',input_task_id,'deleted',true)
    where receipt.user_id=owner_id and receipt.response_payload->>'id'=input_task_id::text;
  delete from public.portfolio_tasks task where task.id=input_task_id and task.user_id=owner_id;
  response_payload:=jsonb_build_object('id',input_task_id,'deleted',true,'detached_activity_count',detached_count);
  insert into public.general_task_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(owner_id,'delete_general_task',input_idempotency_key,request_payload,response_payload);
  return response_payload;
end;
$$;

revoke all on function public.app_delete_general_task(uuid,integer,uuid) from public,anon;
grant execute on function public.app_delete_general_task(uuid,integer,uuid) to authenticated;
