-- Asset detail keeps the established financial transaction while adding one optional
-- activity classification. The six-argument legacy RPC remains callable.
create function public.app_save_asset_detail_with_activity(
  input_instrument_id bigint, input_expected jsonb, input_instrument jsonb,
  input_holdings jsonb, input_idempotency_key uuid, input_reason text,
  input_activity_tag_ids uuid[]
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  instrument_row public.instruments%rowtype;
  holding_row public.holdings%rowtype;
  receipt public.activity_mutation_receipts%rowtype;
  prior_tag bigint;
  next_tag bigint;
  next_name text;
  next_currency text;
  next_type text;
  next_note text;
  reason_text text:=nullif(trim(coalesce(input_reason,'')),'');
  item jsonb;
  holding_id bigint;
  target_account_id bigint;
  account_name text;
  current_values jsonb;
  next_values jsonb;
  saved_rows jsonb:='[]'::jsonb;
  changes jsonb:='[]'::jsonb;
  summary text[]:=array[]::text[];
  payload jsonb;
  result jsonb;
  id_set bigint[]:=array[]::bigint[];
  account_set bigint[]:=array[]::bigint[];
  activity_id bigint;
  activity_tag_id uuid;
  seen_activity_tags uuid[]:=array[]::uuid[];
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if jsonb_typeof(input_expected)<>'object' or jsonb_typeof(input_instrument)<>'object'
     or jsonb_typeof(input_holdings)<>'array' or jsonb_array_length(input_holdings)>40
     or char_length(reason_text)>1000 then raise exception 'Invalid asset detail'; end if;
  if input_instrument?'manual_price' or input_instrument?'manual_price_date' then
    raise exception 'Manual price is not accepted in asset detail'; end if;
  if array_length(input_activity_tag_ids,1)>30 then raise exception 'Too many activity tags'; end if;
  if input_expected?'private_note' or input_instrument?'private_note' then
    raise exception 'Legacy private note field is no longer accepted'; end if;
  payload:=jsonb_build_object('instrument_id',input_instrument_id,'expected',input_expected,
    'instrument',input_instrument,'holdings',input_holdings,'reason',reason_text,
    'activity_tag_ids',to_jsonb(coalesce(input_activity_tag_ids,'{}'::uuid[])));
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':asset_detail_current:'||input_idempotency_key::text,0));
  select * into receipt from public.activity_mutation_receipts
  where user_id=owner_id and operation='save_asset_detail_with_activity' and idempotency_key=input_idempotency_key;
  if found then
    if receipt.request_payload<>payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;

  foreach activity_tag_id in array coalesce(input_activity_tag_ids,'{}'::uuid[]) loop
    if activity_tag_id is null or activity_tag_id=any(seen_activity_tags)
      or not exists(select 1 from public.activity_tags where id=activity_tag_id and user_id=owner_id)
      then raise exception 'Invalid activity tag'; end if;
    seen_activity_tags:=array_append(seen_activity_tags,activity_tag_id);
  end loop;

  select * into instrument_row from public.instruments
  where id=input_instrument_id and user_id=owner_id for update;
  if not found or instrument_row.instrument_type='fx' then raise exception 'Instrument not found'; end if;
  select tag_id into prior_tag from public.instrument_tags
  where user_id=owner_id and ticker=instrument_row.ticker limit 1;
  if input_expected<>jsonb_build_object('display_name',instrument_row.display_name,
    'currency',instrument_row.currency,'instrument_type',instrument_row.instrument_type,
    'note',instrument_row.note,'tag_id',prior_tag)
    then raise exception 'Instrument changed; reload before saving'; end if;
  next_name:=nullif(trim(input_instrument->>'display_name'),'');
  next_currency:=upper(trim(coalesce(input_instrument->>'currency','')));
  next_type:=input_instrument->>'instrument_type';
  next_note:=nullif(trim(coalesce(input_instrument->>'note','')),'');
  next_tag:=nullif(input_instrument->>'tag_id','')::bigint;
  if next_name is null or char_length(next_name)>500 or next_currency not in ('KRW','USD','JPY')
    or next_type not in ('market','valuation','cash') or char_length(next_note)>25000
    then raise exception 'Invalid instrument fields'; end if;
  if next_tag is not null and not exists(select 1 from public.tags
    where id=next_tag and user_id=owner_id) then raise exception 'Tag not found'; end if;
  if next_type<>instrument_row.instrument_type and exists(select 1 from public.holdings
    where user_id=owner_id and ticker=instrument_row.ticker) then
    raise exception 'Change the type only after removing its holdings'; end if;
  if (instrument_row.display_name,instrument_row.currency,instrument_row.instrument_type,instrument_row.note,prior_tag)
    is distinct from (next_name,next_currency,next_type,next_note,next_tag) then
    summary:=array_append(summary,'종목 정보 변경');
    changes:=changes||jsonb_build_array(jsonb_build_object('subject','instrument',
      'before',jsonb_build_object('display_name',instrument_row.display_name,'currency',instrument_row.currency,
        'instrument_type',instrument_row.instrument_type,'note',instrument_row.note,'tag_id',prior_tag),
      'after',jsonb_build_object('display_name',next_name,'currency',next_currency,
        'instrument_type',next_type,'note',next_note,'tag_id',next_tag)));
    update public.instruments set display_name=next_name,currency=next_currency,
      instrument_type=next_type,note=next_note,updated_at=clock_timestamp()
    where id=input_instrument_id and user_id=owner_id;
    if prior_tag is distinct from next_tag then
      delete from public.instrument_tags where user_id=owner_id and ticker=instrument_row.ticker;
      if next_tag is not null then insert into public.instrument_tags(user_id,ticker,tag_id)
        values(owner_id,instrument_row.ticker,next_tag); end if;
    end if;
  end if;

  for item in select value from jsonb_array_elements(input_holdings) loop
    if jsonb_typeof(item)<>'object' or item?'note' or item?'private_note'
       or item?'expected_note' or item?'expected_private_note' then
      raise exception 'Legacy holding note field is no longer accepted'; end if;
    holding_id:=nullif(item->>'id','')::bigint;
    target_account_id:=nullif(item->>'account_id','')::bigint;
    if target_account_id is null or target_account_id=any(account_set) or (holding_id is not null and holding_id=any(id_set)) then
      raise exception 'Duplicate or missing holding account'; end if;
    account_set:=array_append(account_set,target_account_id);
    if holding_id is not null then id_set:=array_append(id_set,holding_id); end if;
    select name into account_name from public.accounts where id=target_account_id and user_id=owner_id;
    if account_name is null then raise exception 'Account not found'; end if;
    holding_row:=null;
    if holding_id is not null then
      select * into holding_row from public.holdings where id=holding_id
        and user_id=owner_id and ticker=instrument_row.ticker for update;
      if not found then raise exception 'Holding not found'; end if;
      if holding_row.state_version is distinct from (item->>'expected_state_version')::integer
        or holding_row.account_id is distinct from (item->>'expected_account_id')::bigint then
        raise exception 'Holding changed; reload before saving'; end if;
    elsif exists(select 1 from public.holdings where user_id=owner_id
      and ticker=instrument_row.ticker and account_id=target_account_id) then
      raise exception 'Holding already exists for this account'; end if;
    if next_type='market' then
      next_values:=jsonb_build_object('quantity',nullif(item->>'quantity','')::numeric,
        'avg_price',nullif(item->>'avg_price','')::numeric);
      if (next_values->>'quantity')::numeric is null or (next_values->>'quantity')::numeric<0
        or (next_values->>'avg_price')::numeric is null or (next_values->>'avg_price')::numeric<0
        then raise exception 'Invalid market holding'; end if;
    elsif next_type='valuation' then
      next_values:=jsonb_build_object('purchase_amount',nullif(item->>'purchase_amount','')::numeric,
        'valuation_amount',nullif(item->>'valuation_amount','')::numeric);
      if (next_values->>'purchase_amount')::numeric is null or (next_values->>'purchase_amount')::numeric<0
        or (next_values->>'valuation_amount')::numeric is null or (next_values->>'valuation_amount')::numeric<0
        then raise exception 'Invalid valuation holding'; end if;
    else
      next_values:=jsonb_build_object('valuation_amount',nullif(item->>'valuation_amount','')::numeric);
      if (next_values->>'valuation_amount')::numeric is null or (next_values->>'valuation_amount')::numeric<0
        then raise exception 'Invalid cash holding'; end if;
    end if;
    current_values:=case next_type
      when 'market' then jsonb_build_object('quantity',holding_row.quantity,'avg_price',holding_row.avg_price)
      when 'valuation' then jsonb_build_object('purchase_amount',holding_row.purchase_amount,'valuation_amount',holding_row.valuation_amount)
      else jsonb_build_object('valuation_amount',holding_row.valuation_amount) end;
    if holding_id is null or holding_row.account_id is distinct from target_account_id or current_values<>next_values then
      if holding_id is null then
        insert into public.holdings(user_id,account_id,ticker,quantity,avg_price,purchase_amount,valuation_amount)
        values(owner_id,target_account_id,instrument_row.ticker,
          case when next_type='market' then (next_values->>'quantity')::numeric end,
          case when next_type='market' then (next_values->>'avg_price')::numeric end,
          case when next_type='valuation' then (next_values->>'purchase_amount')::numeric end,
          case when next_type<>'market' then (next_values->>'valuation_amount')::numeric end)
        returning id into holding_id;
      else
        update public.holdings set account_id=target_account_id,
          quantity=case when next_type='market' then (next_values->>'quantity')::numeric end,
          avg_price=case when next_type='market' then (next_values->>'avg_price')::numeric end,
          purchase_amount=case when next_type='valuation' then (next_values->>'purchase_amount')::numeric end,
          valuation_amount=case when next_type<>'market' then (next_values->>'valuation_amount')::numeric end,
          updated_at=clock_timestamp()
        where id=holding_id and user_id=owner_id;
      end if;
      summary:=array_append(summary,format('%s · %s → %s',account_name,
        case when holding_row.id is null then '신규' else current_values::text end,next_values::text));
      changes:=changes||jsonb_build_array(jsonb_build_object('subject','holding','account_id',target_account_id,
        'account_name',account_name,'before',case when holding_row.id is null then null else current_values end,
        'after',next_values));
    end if;
    saved_rows:=saved_rows||jsonb_build_array((select jsonb_build_object('id',h.id,'account_id',h.account_id,
      'quantity',h.quantity,'avg_price',h.avg_price,'purchase_amount',h.purchase_amount,
      'valuation_amount',h.valuation_amount,'state_version',h.state_version)
      from public.holdings h where h.id=holding_id and h.user_id=owner_id));
  end loop;
  result:=jsonb_build_object('instrument',(select jsonb_build_object('id',i.id,'display_name',i.display_name,
    'currency',i.currency,'instrument_type',i.instrument_type,'note',i.note,
    'tag_id',next_tag) from public.instruments i
    where i.id=input_instrument_id and i.user_id=owner_id),'holdings',saved_rows);
  if array_length(summary,1)>0 then
    insert into public.activity_events(user_id,source,action_type,target_table,target_id,
      title,body,instrument_id,before_data,after_data,status)
    values(owner_id,'user','save_asset_detail','instruments',input_instrument_id::text,
      next_name||' 변경',array_to_string(summary,E'\n')||case when reason_text is null then '' else E'\n사유: '||reason_text end,
      input_instrument_id,null,jsonb_build_object('changes',changes),'succeeded')
    returning id into activity_id;
    insert into public.activity_event_tags(user_id,activity_event_id,tag_id)
    select owner_id,activity_id,unnest(seen_activity_tags);
  end if;
  result:=result||jsonb_build_object('activity_id',activity_id);
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
  values(owner_id,'save_asset_detail_with_activity',input_idempotency_key,payload,result);
  return result;
end;
$$;

revoke all on function public.app_save_asset_detail_with_activity(bigint,jsonb,jsonb,jsonb,uuid,text,uuid[]) from public,anon;
grant execute on function public.app_save_asset_detail_with_activity(bigint,jsonb,jsonb,jsonb,uuid,text,uuid[]) to authenticated;

-- Allocation keeps its existing exact-target conflict check and single activity.
create function public.app_save_allocation_targets_with_activity(input_targets jsonb,input_expected_targets jsonb, input_change_note text, input_activity_tag_ids uuid[], input_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare owner_id uuid := auth.uid(); item jsonb; tag_id bigint; percentage numeric;
  seen bigint[] := '{}'; total numeric := 0; current_targets jsonb; desired_targets jsonb;
  activity_id bigint; activity_tag_id uuid; seen_activity_tags uuid[]:=array[]::uuid[];
  next_note text:=nullif(trim(coalesce(input_change_note,'')),''); result jsonb;
  receipt public.activity_mutation_receipts%rowtype; payload jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  payload:=jsonb_build_object('targets',input_targets,'expected_targets',input_expected_targets,'change_note',next_note,'activity_tag_ids',to_jsonb(coalesce(input_activity_tag_ids,'{}'::uuid[])));
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':allocation_activity:'||input_idempotency_key::text,0));
  select * into receipt from public.activity_mutation_receipts where user_id=owner_id and operation='save_allocation_targets_with_activity' and idempotency_key=input_idempotency_key;
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
  if input_expected_targets is null or jsonb_typeof(input_expected_targets)<>'array' then raise exception 'Invalid expected targets'; end if;
  for item in select value from jsonb_array_elements(input_targets) loop
    if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'tag_id')<>'number'
      or jsonb_typeof(item->'target_percentage')<>'number'
      or (item->>'tag_id') !~ '^[1-9][0-9]*$'
      or (item->>'target_percentage') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception 'Invalid allocation target';
    end if;
    tag_id := (item->>'tag_id')::bigint;
    percentage := (item->>'target_percentage')::numeric;
    if tag_id<=0 or percentage<0 or percentage>100 or tag_id=any(seen) then
      raise exception 'Invalid or duplicate allocation target';
    end if;
    if not exists(select 1 from public.tags tag where tag.id=tag_id and tag.user_id=owner_id) then
      raise exception 'Allocation tag does not belong to the owner';
    end if;
    seen := array_append(seen,tag_id);
    total := total+percentage;
  end loop;
  if total<>100 then raise exception 'Allocation targets must total 100.00 percent'; end if;

  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':allocation-targets',0));
  select coalesce(jsonb_agg(jsonb_build_object('tag_id',t.tag_id,'target_percentage',t.target_percentage)
    order by t.tag_id),'[]'::jsonb) into current_targets
  from public.allocation_targets t where t.user_id=owner_id;
  select jsonb_agg(jsonb_build_object('tag_id',(value->>'tag_id')::bigint,
    'target_percentage',(value->>'target_percentage')::numeric) order by (value->>'tag_id')::bigint)
    into desired_targets from jsonb_array_elements(input_targets);
  if current_targets=desired_targets then return public.app_get_strategy_state(null)||jsonb_build_object('activity_id',null); end if;
  if current_targets<>input_expected_targets then raise exception 'Allocation targets changed; reload before saving'; end if;

  delete from public.allocation_targets where user_id=owner_id;
  insert into public.allocation_targets(user_id,tag_id,target_percentage)
  select owner_id,(value->>'tag_id')::bigint,(value->>'target_percentage')::numeric
  from jsonb_array_elements(input_targets);
  insert into public.activity_events(user_id,source,action_type,target_table,after_data,status,body)
  values(owner_id,'user','update_strategy','allocation_targets',desired_targets,'succeeded',next_note)
  returning id into activity_id;
  insert into public.activity_event_tags(user_id,activity_event_id,tag_id)
  select owner_id,activity_id,unnest(seen_activity_tags);
  result:=public.app_get_strategy_state(null)||jsonb_build_object('activity_id',activity_id);
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
  values(owner_id,'save_allocation_targets_with_activity',input_idempotency_key,payload,result);
  return result;
end;
$$;

revoke all on function public.app_save_allocation_targets_with_activity(jsonb,jsonb,text,uuid[],uuid) from public,anon;
grant execute on function public.app_save_allocation_targets_with_activity(jsonb,jsonb,text,uuid[],uuid) to authenticated;

create function public.app_clear_allocation_targets_with_activity(input_expected_targets jsonb, input_change_note text, input_activity_tag_ids uuid[], input_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare owner_id uuid:=auth.uid(); current_targets jsonb;
  activity_id bigint; activity_tag_id uuid; seen_activity_tags uuid[]:=array[]::uuid[];
  next_note text:=nullif(trim(coalesce(input_change_note,'')),'');
  receipt public.activity_mutation_receipts%rowtype; payload jsonb; result jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  payload:=jsonb_build_object('expected_targets',input_expected_targets,'change_note',next_note,'activity_tag_ids',to_jsonb(coalesce(input_activity_tag_ids,'{}'::uuid[])));
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':allocation_activity:'||input_idempotency_key::text,0));
  select * into receipt from public.activity_mutation_receipts where user_id=owner_id and operation='clear_allocation_targets_with_activity' and idempotency_key=input_idempotency_key;
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
  if input_expected_targets is null or jsonb_typeof(input_expected_targets)<>'array' then raise exception 'Invalid expected targets'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':allocation-targets',0));
  select coalesce(jsonb_agg(jsonb_build_object('tag_id',t.tag_id,'target_percentage',t.target_percentage)
    order by t.tag_id),'[]'::jsonb) into current_targets
  from public.allocation_targets t where t.user_id=owner_id;
  if current_targets='[]'::jsonb then return public.app_get_strategy_state(null)||jsonb_build_object('activity_id',null); end if;
  if current_targets<>input_expected_targets then raise exception 'Allocation targets changed; reload before clearing'; end if;
  delete from public.allocation_targets where user_id=owner_id;
  insert into public.activity_events(user_id,source,action_type,target_table,after_data,status,body)
    values(owner_id,'user','reset_allocation_targets','allocation_targets','[]'::jsonb,'succeeded',next_note)
    returning id into activity_id;
  insert into public.activity_event_tags(user_id,activity_event_id,tag_id)
  select owner_id,activity_id,unnest(seen_activity_tags);
  result:=public.app_get_strategy_state(null)||jsonb_build_object('activity_id',activity_id);
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
  values(owner_id,'clear_allocation_targets_with_activity',input_idempotency_key,payload,result);
  return result;
end;
$$;

revoke all on function public.app_clear_allocation_targets_with_activity(jsonb,text,uuid[],uuid) from public,anon;
grant execute on function public.app_clear_allocation_targets_with_activity(jsonb,text,uuid[],uuid) to authenticated;

-- A new principle row is one dated change and one searchable activity.
create function public.app_save_principle_with_activity(
  input_principle_id uuid,
  input_expected_row_id bigint,
  input_expected_body text,
  input_expected_change_note text,
  input_body text,
  input_change_note text, input_activity_tag_ids uuid[]
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  current_row public.principles%rowtype;
  saved public.principles%rowtype;
  next_note text:=nullif(trim(coalesce(input_change_note,'')), '');
  next_id uuid;
  activity_id bigint;
  activity_tag_id uuid;
  seen_activity_tags uuid[]:=array[]::uuid[];
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_body is null or btrim(input_body)='' or char_length(input_body)>10000 then raise exception 'Principle body is required'; end if;
  if next_note is not null and char_length(next_note)>1000 then raise exception 'Principle change note is too long'; end if;
  if array_length(input_activity_tag_ids,1)>30 then raise exception 'Too many activity tags'; end if;
  foreach activity_tag_id in array coalesce(input_activity_tag_ids,'{}'::uuid[]) loop
    if activity_tag_id is null or activity_tag_id=any(seen_activity_tags)
      or not exists(select 1 from public.activity_tags where id=activity_tag_id and user_id=owner_id)
      then raise exception 'Invalid activity tag'; end if;
    seen_activity_tags:=array_append(seen_activity_tags,activity_tag_id);
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':principle',0));
  select * into current_row from public.principles where user_id=owner_id
    order by effective_at desc,id desc limit 1 for update;
  if found and not current_row.ended then
    if input_principle_id is distinct from current_row.principle_id then raise exception 'Current principle ID changed; reload before saving'; end if;
    if current_row.body=input_body and current_row.change_note is not distinct from next_note then
      select id into activity_id from public.activity_events
      where user_id=owner_id and target_table='principles' and target_id=current_row.id::text
      order by id desc limit 1;
      return (to_jsonb(current_row)-'user_id')||jsonb_build_object('activity_id',activity_id);
    end if;
    if input_expected_row_id is distinct from current_row.id
       or input_expected_body is distinct from current_row.body
       or input_expected_change_note is distinct from current_row.change_note then
      raise exception 'Principle changed; reload before saving';
    end if;
    next_id:=current_row.principle_id;
  else
    if input_expected_row_id is not null or input_expected_body is not null or input_expected_change_note is not null then
      raise exception 'Principle changed; reload before saving';
    end if;
    next_id:=coalesce(input_principle_id,gen_random_uuid());
    if exists(select 1 from public.principles where user_id=owner_id and principle_id=next_id) then
      raise exception 'Principle ID was previously used';
    end if;
  end if;
  insert into public.principles(principle_id,user_id,body,change_note,ended)
    values(next_id,owner_id,input_body,next_note,false) returning * into saved;
  insert into public.activity_events(user_id,source,action_type,target_table,target_id,title,body,status)
  values(owner_id,'user','update_principle','principles',saved.id::text,
    case when current_row.id is null then '원칙 작성' else '원칙 변경' end,
    coalesce(next_note,'원칙 문서를 변경했습니다.'),'succeeded')
  returning id into activity_id;
  insert into public.activity_event_tags(user_id,activity_event_id,tag_id)
  select owner_id,activity_id,unnest(seen_activity_tags);
  return (to_jsonb(saved)-'user_id')||jsonb_build_object('activity_id',activity_id);
end;
$$;

revoke all on function public.app_save_principle_with_activity(uuid,bigint,text,text,text,text,uuid[]) from public,anon;
grant execute on function public.app_save_principle_with_activity(uuid,bigint,text,text,text,text,uuid[]) to authenticated;
