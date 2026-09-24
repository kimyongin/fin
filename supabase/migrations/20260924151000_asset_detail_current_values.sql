-- One direct-current-value edit and one human-readable activity in the same transaction.
-- Legacy private notes are read for conflict protection but never copied to the event.
create function public.app_save_asset_detail_current(
  input_instrument_id bigint, input_expected jsonb, input_instrument jsonb,
  input_holdings jsonb, input_idempotency_key uuid, input_reason text default null
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
  price numeric;
  price_day date;
  old_price public.holding_prices_daily%rowtype;
  payload jsonb;
  result jsonb;
  id_set bigint[]:=array[]::bigint[];
  account_set bigint[]:=array[]::bigint[];
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if jsonb_typeof(input_expected)<>'object' or jsonb_typeof(input_instrument)<>'object'
     or jsonb_typeof(input_holdings)<>'array' or jsonb_array_length(input_holdings)>40
     or char_length(reason_text)>1000 then raise exception 'Invalid asset detail'; end if;
  payload:=jsonb_build_object('instrument_id',input_instrument_id,'expected',input_expected,
    'instrument',input_instrument,'holdings',input_holdings,'reason',reason_text);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':asset_detail_current:'||input_idempotency_key::text,0));
  select * into receipt from public.activity_mutation_receipts
  where user_id=owner_id and operation='save_asset_detail_current' and idempotency_key=input_idempotency_key;
  if found then
    if receipt.request_payload<>payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;

  select * into instrument_row from public.instruments
  where id=input_instrument_id and user_id=owner_id for update;
  if not found or instrument_row.instrument_type='fx' then raise exception 'Instrument not found'; end if;
  select tag_id into prior_tag from public.instrument_tags
  where user_id=owner_id and ticker=instrument_row.ticker limit 1;
  if input_expected<>jsonb_build_object('display_name',instrument_row.display_name,
    'currency',instrument_row.currency,'instrument_type',instrument_row.instrument_type,
    'note',instrument_row.note,'private_note',instrument_row.private_note,'tag_id',prior_tag)
    then raise exception 'Instrument changed; reload before saving'; end if;
  next_name:=nullif(trim(input_instrument->>'display_name'),'');
  next_currency:=upper(trim(coalesce(input_instrument->>'currency','')));
  next_type:=input_instrument->>'instrument_type';
  next_note:=nullif(trim(coalesce(input_instrument->>'note','')),'');
  next_tag:=nullif(input_instrument->>'tag_id','')::bigint;
  if next_name is null or char_length(next_name)>500 or next_currency not in ('KRW','USD','JPY')
    or next_type not in ('market','valuation','cash') or char_length(next_note)>25000
    or (input_instrument?'private_note') then raise exception 'Invalid instrument fields'; end if;
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

  if input_instrument?'manual_price' then
    if next_type<>'market' then raise exception 'Only market instruments have manual prices'; end if;
    price:=(input_instrument->>'manual_price')::numeric;
    price_day:=(input_instrument->>'manual_price_date')::date;
    if price is null or price<=0 or price_day is null then raise exception 'Invalid manual price'; end if;
    select * into old_price from public.holding_prices_daily
    where user_id=owner_id and ticker=instrument_row.ticker and price_date=price_day for update;
    if not found or old_price.close_price is distinct from price or old_price.source is distinct from 'manual' then
      insert into public.holding_prices_daily(user_id,ticker,price_date,close_price,source)
      values(owner_id,instrument_row.ticker,price_day,price,'manual')
      on conflict on constraint holding_prices_daily_user_id_ticker_price_date_key
      do update set close_price=excluded.close_price,source=excluded.source;
      summary:=array_append(summary,format('시세 %s · %s',price,price_day));
      changes:=changes||jsonb_build_array(jsonb_build_object('subject','price','date',price_day,
        'before',old_price.close_price,'after',price));
    end if;
  end if;

  for item in select value from jsonb_array_elements(input_holdings) loop
    if jsonb_typeof(item)<>'object' or item?'note' or item?'private_note' then
      raise exception 'Invalid holding fields'; end if;
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
        or holding_row.account_id is distinct from (item->>'expected_account_id')::bigint
        or holding_row.note is distinct from (item->>'expected_note')
        or holding_row.private_note is distinct from (item->>'expected_private_note') then
        raise exception 'Holding changed; reload before saving'; end if;
    elsif exists(select 1 from public.holdings where user_id=owner_id
      and ticker=instrument_row.ticker and account_id=target_account_id) then
      raise exception 'Holding already exists for this account';
    end if;
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
      'valuation_amount',h.valuation_amount,'note',h.note,'private_note',h.private_note,
      'state_version',h.state_version) from public.holdings h where h.id=holding_id and h.user_id=owner_id));
  end loop;
  result:=jsonb_build_object('instrument',(select jsonb_build_object('id',i.id,'display_name',i.display_name,
    'currency',i.currency,'instrument_type',i.instrument_type,'note',i.note,
    'private_note',i.private_note,'tag_id',next_tag) from public.instruments i
    where i.id=input_instrument_id and i.user_id=owner_id),'holdings',saved_rows);
  if array_length(summary,1)>0 then
    insert into public.activity_events(user_id,source,action_type,target_table,target_id,
      title,body,instrument_id,before_data,after_data,status)
    values(owner_id,'user','save_asset_detail','instruments',input_instrument_id::text,
      next_name||' 변경',array_to_string(summary,E'\n')||case when reason_text is null then '' else E'\n사유: '||reason_text end,
      input_instrument_id,null,jsonb_build_object('changes',changes),'succeeded');
  end if;
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
  values(owner_id,'save_asset_detail_current',input_idempotency_key,payload,result);
  return result;
end;
$$;
revoke all on function public.app_save_asset_detail_current(bigint,jsonb,jsonb,jsonb,uuid,text) from public,anon;
grant execute on function public.app_save_asset_detail_current(bigint,jsonb,jsonb,jsonb,uuid,text) to authenticated;
