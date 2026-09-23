-- Keep the existing field and tag validators, but expose one atomic detail save.
create function public.app_save_activity_detail(
  input_activity_id bigint, input_expected_version integer, input_idempotency_key uuid,
  input_patch jsonb, input_tag_ids uuid[], input_authored_via text default 'app'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  current_user_id uuid:=auth.uid(); current_event public.activity_events%rowtype;
  stored_receipt public.activity_mutation_receipts%rowtype;
  request_payload jsonb; response_payload jsonb; saved jsonb;
  current_tags uuid[]; requested_tags uuid[]:=coalesce(input_tag_ids,array[]::uuid[]);
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if coalesce(jsonb_typeof(input_patch),'null')<>'object' then raise exception 'Activity patch must be an object'; end if;
  request_payload:=jsonb_build_object('activity_id',input_activity_id,'expected_version',input_expected_version,
    'patch',input_patch,'tag_ids',to_jsonb(requested_tags),'authored_via',input_authored_via);
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':save_activity_detail:'||input_idempotency_key::text,0));
  select * into stored_receipt from public.activity_mutation_receipts
    where user_id=current_user_id and operation='save_activity_detail' and idempotency_key=input_idempotency_key;
  if found then
    if stored_receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return stored_receipt.response_payload;
  end if;
  select * into current_event from public.activity_events event
    where event.id=input_activity_id and event.user_id=current_user_id and event.status='succeeded' for update;
  if not found then raise exception 'Activity was not found'; end if;
  if current_event.version<>input_expected_version then raise exception 'Activity version conflict'; end if;
  select coalesce(array_agg(tag_id order by tag_id),array[]::uuid[]) into current_tags
  from public.activity_event_tags where user_id=current_user_id and activity_event_id=input_activity_id;
  if input_patch<>'{}'::jsonb then
    saved:=public.app_update_activity(input_activity_id,input_expected_version,input_idempotency_key,input_patch,input_authored_via);
  else
    saved:=public.app_get_activity(input_activity_id,null);
  end if;
  if current_tags<> (select coalesce(array_agg(value order by value),array[]::uuid[]) from unnest(requested_tags) value) then
    saved:=public.app_set_activity_tags(input_activity_id,(saved->>'version')::integer,requested_tags,input_idempotency_key);
  end if;
  response_payload:=public.app_get_activity(input_activity_id,null);
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
  values(current_user_id,'save_activity_detail',input_idempotency_key,request_payload,response_payload);
  return response_payload;
end;
$$;

revoke all on function public.app_save_activity_detail(bigint,integer,uuid,jsonb,uuid[],text) from public, anon;
grant execute on function public.app_save_activity_detail(bigint,integer,uuid,jsonb,uuid[],text) to authenticated;
