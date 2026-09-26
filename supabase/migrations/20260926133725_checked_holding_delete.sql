-- A current holding deletion is a financial write: check the row the user saw
-- and seal the result so a lost response cannot apply the deletion twice.
create function public.app_delete_holding_checked(
  input_holding_id bigint, input_expected_version integer, input_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  selected_holding public.holdings%rowtype;
  stored_receipt public.activity_mutation_receipts%rowtype;
  request_payload jsonb;
  response_payload jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_holding_id is null or input_idempotency_key is null then raise exception 'Holding and idempotency key are required'; end if;
  request_payload:=jsonb_build_object('holding_id',input_holding_id,'expected_version',input_expected_version);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':delete_holding_checked:'||input_idempotency_key::text,0));
  select * into stored_receipt from public.activity_mutation_receipts
    where user_id=owner_id and operation='delete_holding_checked' and idempotency_key=input_idempotency_key;
  if found then
    if stored_receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return stored_receipt.response_payload;
  end if;
  select * into selected_holding from public.holdings holding
    where holding.id=input_holding_id and holding.user_id=owner_id for update;
  if not found then raise exception 'Holding not found'; end if;
  if input_expected_version is null or selected_holding.state_version<>input_expected_version then
    raise exception 'Holding changed; reload before deleting';
  end if;
  select to_jsonb(deleted) into response_payload from public.app_delete_holding(input_holding_id,'user',null) deleted;
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(owner_id,'delete_holding_checked',input_idempotency_key,request_payload,response_payload);
  return response_payload;
end;
$$;

revoke all on function public.app_delete_holding_checked(bigint,integer,uuid) from public,anon;
grant execute on function public.app_delete_holding_checked(bigint,integer,uuid) to authenticated;
