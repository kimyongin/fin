-- Deleting a human-facing record never reverses a completed holding or task
-- mutation. Execution receipts remain sealed for financial retries.
create function public.app_delete_activity(
  input_activity_id bigint,input_expected_version integer
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  selected_event public.activity_events%rowtype;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  select * into selected_event from public.activity_events event
  where event.id=input_activity_id and event.user_id=owner_id for update;
  if not found then raise exception 'Activity was not found'; end if;
  if selected_event.status='deleted' then return jsonb_build_object('id',input_activity_id,'deleted',true); end if;
  if selected_event.status<>'succeeded' then raise exception 'Activity was not found'; end if;
  if input_expected_version is null or selected_event.version<>input_expected_version then
    raise exception 'Activity version conflict'; end if;
  delete from public.activity_embeddings where user_id=owner_id and activity_event_id=input_activity_id;
  delete from public.activity_event_tags where user_id=owner_id and activity_event_id=input_activity_id;
  update public.activity_mutation_receipts receipt set
    request_payload=jsonb_build_object('deleted_activity_id',input_activity_id),
    response_payload=jsonb_build_object('id',input_activity_id,'deleted',true)
  where receipt.user_id=owner_id
    and receipt.operation in ('create_activity','update_activity','set_activity_tags','save_activity_detail')
    and receipt.response_payload->>'id'=input_activity_id::text;
  update public.activity_events event set status='deleted',title=null,body=null,
    note=null,result=null,conclusion=null,natural_language_request=null,
    after_data=case when selected_event.action_type='record_manual_activity' then '{}'::jsonb else event.after_data end,
    version=event.version+1,updated_at=clock_timestamp()
  where event.id=input_activity_id and event.user_id=owner_id;
  return jsonb_build_object('id',input_activity_id,'deleted',true);
end;
$$;
revoke all on function public.app_delete_activity(bigint,integer) from public,anon;
grant execute on function public.app_delete_activity(bigint,integer) to authenticated;
