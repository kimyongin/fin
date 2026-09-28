-- #168: the existing allocation receipt and conflict rules are unchanged;
-- persist the pre-save target set in the same activity for readable diffs.
create or replace function public.app_save_allocation_targets_with_activity(
  input_targets jsonb,input_expected_targets jsonb,input_change_note text,
  input_activity_tag_ids uuid[],input_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid(); item jsonb; tag_id bigint; percentage numeric;
  seen bigint[]:='{}'; total numeric:=0; current_targets jsonb; desired_targets jsonb;
  activity_id bigint; activity_tag_id uuid; seen_activity_tags uuid[]:=array[]::uuid[];
  next_note text:=nullif(trim(coalesce(input_change_note,'')),''); result jsonb;
  receipt public.activity_mutation_receipts%rowtype; payload jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  payload:=jsonb_build_object('targets',input_targets,'expected_targets',input_expected_targets,
    'change_note',next_note,'activity_tag_ids',to_jsonb(coalesce(input_activity_tag_ids,'{}'::uuid[])));
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':allocation_activity:'||input_idempotency_key::text,0));
  select * into receipt from public.activity_mutation_receipts
  where user_id=owner_id and operation='save_allocation_targets_with_activity' and idempotency_key=input_idempotency_key;
  if found then
    if receipt.request_payload<>payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;
  if char_length(next_note)>1000 or array_length(input_activity_tag_ids,1)>30 then raise exception 'Invalid activity context'; end if;
  foreach activity_tag_id in array coalesce(input_activity_tag_ids,'{}'::uuid[]) loop
    if activity_tag_id is null or activity_tag_id=any(seen_activity_tags)
      or not exists(select 1 from public.activity_tags where id=activity_tag_id and user_id=owner_id)
      then raise exception 'Invalid activity tag'; end if;
    seen_activity_tags:=array_append(seen_activity_tags,activity_tag_id);
  end loop;
  if jsonb_typeof(input_targets)<>'array' or jsonb_array_length(input_targets)=0 then
    raise exception 'Allocation targets must be a nonempty array';
  end if;
  if input_expected_targets is null or jsonb_typeof(input_expected_targets)<>'array' then
    raise exception 'Invalid expected targets'; end if;
  for item in select value from jsonb_array_elements(input_targets) loop
    if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'tag_id')<>'number'
      or jsonb_typeof(item->'target_percentage')<>'number'
      or (item->>'tag_id') !~ '^[1-9][0-9]*$'
      or (item->>'target_percentage') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception 'Invalid allocation target';
    end if;
    tag_id:=(item->>'tag_id')::bigint;
    percentage:=(item->>'target_percentage')::numeric;
    if tag_id<=0 or percentage<0 or percentage>100 or tag_id=any(seen) then
      raise exception 'Invalid or duplicate allocation target'; end if;
    if not exists(select 1 from public.tags tag where tag.id=tag_id and tag.user_id=owner_id) then
      raise exception 'Allocation tag does not belong to the owner'; end if;
    seen:=array_append(seen,tag_id);
    total:=total+percentage;
  end loop;
  if total<>100 then raise exception 'Allocation targets must total 100.00 percent'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':allocation-targets',0));
  select coalesce(jsonb_agg(jsonb_build_object('tag_id',t.tag_id,'target_percentage',t.target_percentage)
    order by t.tag_id),'[]'::jsonb) into current_targets
  from public.allocation_targets t where t.user_id=owner_id;
  select jsonb_agg(jsonb_build_object('tag_id',(value->>'tag_id')::bigint,
    'target_percentage',(value->>'target_percentage')::numeric) order by (value->>'tag_id')::bigint)
    into desired_targets from jsonb_array_elements(input_targets);
  if current_targets=desired_targets then
    return public.app_get_strategy_state(null)||jsonb_build_object('activity_id',null); end if;
  if current_targets<>input_expected_targets then raise exception 'Allocation targets changed; reload before saving'; end if;
  delete from public.allocation_targets where user_id=owner_id;
  insert into public.allocation_targets(user_id,tag_id,target_percentage)
  select owner_id,(value->>'tag_id')::bigint,(value->>'target_percentage')::numeric
  from jsonb_array_elements(input_targets);
  insert into public.activity_events(user_id,source,action_type,target_table,before_data,after_data,status,body)
  values(owner_id,'user','update_strategy','allocation_targets',current_targets,desired_targets,'succeeded',next_note)
  returning id into activity_id;
  insert into public.activity_event_tags(user_id,activity_event_id,tag_id)
  select owner_id,activity_id,unnest(seen_activity_tags);
  result:=public.app_get_strategy_state(null)||jsonb_build_object('activity_id',activity_id);
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
  values(owner_id,'save_allocation_targets_with_activity',input_idempotency_key,payload,result);
  return result;
end;
$$;

create or replace function public.app_clear_allocation_targets_with_activity(
  input_expected_targets jsonb,input_change_note text,input_activity_tag_ids uuid[],input_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare owner_id uuid:=auth.uid(); current_targets jsonb;
  activity_id bigint; activity_tag_id uuid; seen_activity_tags uuid[]:=array[]::uuid[];
  next_note text:=nullif(trim(coalesce(input_change_note,'')),'');
  receipt public.activity_mutation_receipts%rowtype; payload jsonb; result jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  payload:=jsonb_build_object('expected_targets',input_expected_targets,'change_note',next_note,
    'activity_tag_ids',to_jsonb(coalesce(input_activity_tag_ids,'{}'::uuid[])));
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':allocation_activity:'||input_idempotency_key::text,0));
  select * into receipt from public.activity_mutation_receipts
  where user_id=owner_id and operation='clear_allocation_targets_with_activity' and idempotency_key=input_idempotency_key;
  if found then
    if receipt.request_payload<>payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;
  if char_length(next_note)>1000 or array_length(input_activity_tag_ids,1)>30 then raise exception 'Invalid activity context'; end if;
  foreach activity_tag_id in array coalesce(input_activity_tag_ids,'{}'::uuid[]) loop
    if activity_tag_id is null or activity_tag_id=any(seen_activity_tags)
      or not exists(select 1 from public.activity_tags where id=activity_tag_id and user_id=owner_id)
      then raise exception 'Invalid activity tag'; end if;
    seen_activity_tags:=array_append(seen_activity_tags,activity_tag_id);
  end loop;
  if input_expected_targets is null or jsonb_typeof(input_expected_targets)<>'array' then
    raise exception 'Invalid expected targets'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':allocation-targets',0));
  select coalesce(jsonb_agg(jsonb_build_object('tag_id',t.tag_id,'target_percentage',t.target_percentage)
    order by t.tag_id),'[]'::jsonb) into current_targets
  from public.allocation_targets t where t.user_id=owner_id;
  if current_targets='[]'::jsonb then
    return public.app_get_strategy_state(null)||jsonb_build_object('activity_id',null); end if;
  if current_targets<>input_expected_targets then raise exception 'Allocation targets changed; reload before clearing'; end if;
  delete from public.allocation_targets where user_id=owner_id;
  insert into public.activity_events(user_id,source,action_type,target_table,before_data,after_data,status,body)
  values(owner_id,'user','reset_allocation_targets','allocation_targets',current_targets,'[]'::jsonb,'succeeded',next_note)
  returning id into activity_id;
  insert into public.activity_event_tags(user_id,activity_event_id,tag_id)
  select owner_id,activity_id,unnest(seen_activity_tags);
  result:=public.app_get_strategy_state(null)||jsonb_build_object('activity_id',activity_id);
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
  values(owner_id,'clear_allocation_targets_with_activity',input_idempotency_key,payload,result);
  return result;
end;
$$;
