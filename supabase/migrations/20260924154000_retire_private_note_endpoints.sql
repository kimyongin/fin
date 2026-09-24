-- #124: a common instrument memo replaces private instrument/holding reasons.
drop function public.app_list_private_holding_notes();
drop function public.app_save_private_holding_note(bigint,bigint,text,text);

create or replace function public.app_update_entity_note(
  input_entity_type text, input_entity_id bigint, input_expected_note text,
  input_note text, input_idempotency_key uuid, input_source text default 'app'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  current_user_id uuid:=auth.uid();
  normalized_expected text:=nullif(trim(coalesce(input_expected_note,'')),'');
  normalized_note text:=nullif(trim(coalesce(input_note,'')),'');
  current_note text;
  request jsonb;
  response jsonb;
  receipt public.entity_note_mutation_receipts%rowtype;
  target_table text;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if input_source not in ('app','agent') then raise exception 'Invalid note source'; end if;
  if input_entity_type not in ('account','instrument') then raise exception 'Invalid note entity type'; end if;
  if input_entity_id is null or input_entity_id<=0 then raise exception 'Entity id must be positive'; end if;
  if normalized_note is not null and char_length(normalized_note)>4000 then raise exception 'Entity note is too long'; end if;
  request:=jsonb_build_object('entity_type',input_entity_type,'entity_id',input_entity_id,
    'expected_note',normalized_expected,'note',normalized_note,'source',input_source);
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':entity-note:'||input_idempotency_key::text,0));
  select * into receipt from public.entity_note_mutation_receipts
  where user_id=current_user_id and idempotency_key=input_idempotency_key;
  if found then
    if receipt.request_payload<>request then raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;
  if input_entity_type='account' then
    select note into current_note from public.accounts where id=input_entity_id and user_id=current_user_id for update;
    target_table:='accounts';
  else
    select note into current_note from public.instruments where id=input_entity_id and user_id=current_user_id for update;
    target_table:='instruments';
  end if;
  if not found then raise exception 'Entity was not found or is not accessible'; end if;
  current_note:=nullif(trim(coalesce(current_note,'')),'');
  if current_note is distinct from normalized_expected then raise exception 'Entity note conflict'; end if;
  response:=jsonb_build_object('entity_type',input_entity_type,'entity_id',input_entity_id,'note',normalized_note);
  if current_note is distinct from normalized_note then
    if input_entity_type='account' then
      update public.accounts set note=normalized_note where id=input_entity_id and user_id=current_user_id;
    else
      update public.instruments set note=normalized_note where id=input_entity_id and user_id=current_user_id;
    end if;
    insert into public.activity_events(user_id,source,action_type,target_table,target_id,before_data,after_data,status)
    values(current_user_id,case when input_source='app' then 'user' else 'agent' end,
      'update_entity_note',target_table,input_entity_id::text,
      jsonb_build_object('note',current_note),jsonb_build_object('note',normalized_note),'succeeded');
  end if;
  insert into public.entity_note_mutation_receipts(user_id,idempotency_key,request_payload,response_payload)
  values(current_user_id,input_idempotency_key,request,response);
  return response;
end;
$$;
