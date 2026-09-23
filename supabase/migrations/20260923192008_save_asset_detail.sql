-- One instrument detail submission is one transaction. Financial trades and
-- brokerage verification remain separate purpose-specific commands.
create function public.app_save_asset_detail(
  input_instrument_id bigint,
  input_expected jsonb,
  input_instrument jsonb,
  input_holdings jsonb,
  input_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid := auth.uid();
  current_instrument public.instruments%rowtype;
  current_holding public.holdings%rowtype;
  prior_receipt public.activity_mutation_receipts%rowtype;
  prior_tag bigint;
  next_tag bigint;
  next_name text;
  next_currency text;
  next_type text;
  next_note text;
  next_private_note text;
  prior_public jsonb;
  changed_public boolean;
  item jsonb;
  target_id bigint;
  target_account_id bigint;
  target_note text;
  target_private_note text;
  saved_holding_id bigint;
  saved_rows jsonb := '[]'::jsonb;
  request_payload jsonb;
  response_payload jsonb;
  price numeric;
  price_day date;
  prior_price public.holding_prices_daily%rowtype;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if jsonb_typeof(input_expected) <> 'object' or jsonb_typeof(input_instrument) <> 'object'
     or jsonb_typeof(input_holdings) <> 'array' or jsonb_array_length(input_holdings) > 40 then
    raise exception 'Invalid asset detail';
  end if;
  request_payload := jsonb_build_object('instrument_id',input_instrument_id,'expected',input_expected,
    'instrument',input_instrument,'holdings',input_holdings);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':asset_detail:'||input_idempotency_key::text,0));
  select * into prior_receipt from public.activity_mutation_receipts
  where user_id=owner_id and operation='save_asset_detail' and idempotency_key=input_idempotency_key;
  if found then
    if prior_receipt.request_payload <> request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return prior_receipt.response_payload;
  end if;

  select * into current_instrument from public.instruments
  where id=input_instrument_id and user_id=owner_id for update;
  if not found or current_instrument.instrument_type='fx' then raise exception 'Instrument not found'; end if;
  select it.tag_id into prior_tag from public.instrument_tags it
  where it.user_id=owner_id and it.ticker=current_instrument.ticker limit 1;
  if input_expected <> jsonb_build_object(
    'display_name',current_instrument.display_name,'currency',current_instrument.currency,
    'instrument_type',current_instrument.instrument_type,'note',current_instrument.note,
    'private_note',current_instrument.private_note,'tag_id',prior_tag) then
    raise exception 'Instrument changed; reload before saving';
  end if;
  next_name := nullif(trim(input_instrument->>'display_name'),'');
  next_currency := upper(trim(coalesce(input_instrument->>'currency','')));
  next_type := input_instrument->>'instrument_type';
  next_note := nullif(trim(coalesce(input_instrument->>'note','')),'');
  next_private_note := nullif(trim(coalesce(input_instrument->>'private_note','')),'');
  next_tag := nullif(input_instrument->>'tag_id','')::bigint;
  if next_name is null or char_length(next_name)>500 or next_currency not in ('KRW','USD','JPY')
     or next_type not in ('market','valuation','cash') or char_length(next_private_note)>25000 then
    raise exception 'Invalid instrument fields';
  end if;
  if next_tag is not null and not exists(select 1 from public.tags where id=next_tag and user_id=owner_id) then
    raise exception 'Tag not found';
  end if;
  if next_type<>current_instrument.instrument_type and exists(
    select 1 from public.holdings where user_id=owner_id and ticker=current_instrument.ticker) then
    raise exception 'Change the type only after removing its holdings';
  end if;
  changed_public := (current_instrument.display_name,current_instrument.currency,current_instrument.instrument_type,current_instrument.note,prior_tag)
    is distinct from (next_name,next_currency,next_type,next_note,next_tag);
  if changed_public then
    prior_public := jsonb_build_object('id',current_instrument.id,'ticker',current_instrument.ticker,
      'display_name',current_instrument.display_name,'currency',current_instrument.currency,
      'instrument_type',current_instrument.instrument_type,'note',current_instrument.note,'tag_id',prior_tag);
  end if;
  if changed_public or current_instrument.private_note is distinct from next_private_note then
    update public.instruments set display_name=next_name,currency=next_currency,instrument_type=next_type,
      note=next_note,private_note=next_private_note,updated_at=clock_timestamp()
    where id=input_instrument_id and user_id=owner_id;
  end if;
  if prior_tag is distinct from next_tag then
    delete from public.instrument_tags where user_id=owner_id and ticker=current_instrument.ticker;
    if next_tag is not null then
      insert into public.instrument_tags(user_id,ticker,tag_id) values(owner_id,current_instrument.ticker,next_tag);
    end if;
  end if;
  if changed_public then
    insert into public.activity_events(user_id,source,action_type,target_table,target_id,before_data,after_data,status)
    values(owner_id,'user','update_instrument','instruments',input_instrument_id::text,prior_public,
      jsonb_build_object('id',input_instrument_id,'ticker',current_instrument.ticker,'display_name',next_name,
        'currency',next_currency,'instrument_type',next_type,'note',next_note,'tag_id',next_tag),'succeeded');
  end if;

  if input_instrument ? 'manual_price' then
    if next_type<>'market' then raise exception 'Only market instruments have manual prices'; end if;
    price := (input_instrument->>'manual_price')::numeric;
    price_day := (input_instrument->>'manual_price_date')::date;
    if price is null or price<=0 or price_day is null then raise exception 'Invalid manual price'; end if;
    select * into prior_price from public.holding_prices_daily
    where user_id=owner_id and ticker=current_instrument.ticker and price_date=price_day for update;
    if not found or prior_price.close_price is distinct from price or prior_price.source is distinct from 'manual' then
      insert into public.holding_prices_daily(user_id,ticker,price_date,close_price,source)
      values(owner_id,current_instrument.ticker,price_day,price,'manual')
      on conflict on constraint holding_prices_daily_user_id_ticker_price_date_key
      do update set close_price=excluded.close_price,source=excluded.source;
      insert into public.activity_events(user_id,source,action_type,target_table,target_id,after_data,status)
      values(owner_id,'user','upsert_price','holding_prices_daily',current_instrument.ticker,
        jsonb_build_object('ticker',current_instrument.ticker,'price_date',price_day,'close_price',price),'succeeded');
    end if;
  end if;

  for item in select value from jsonb_array_elements(input_holdings) loop
    if jsonb_typeof(item)<>'object' then raise exception 'Invalid holding'; end if;
    target_id := nullif(item->>'id','')::bigint;
    target_account_id := nullif(item->>'account_id','')::bigint;
    target_note := nullif(trim(coalesce(item->>'note','')),'');
    target_private_note := nullif(trim(coalesce(item->>'private_note','')),'');
    if target_account_id is null or not exists(select 1 from public.accounts where id=target_account_id and user_id=owner_id)
       or char_length(target_private_note)>25000 then raise exception 'Invalid holding account or note'; end if;
    if target_id is not null then
      select * into current_holding from public.holdings
      where id=target_id and user_id=owner_id and ticker=current_instrument.ticker for update;
      if not found then raise exception 'Holding not found'; end if;
      if current_holding.state_version is distinct from (item->>'expected_state_version')::integer
         or current_holding.account_id is distinct from (item->>'expected_account_id')::bigint
         or current_holding.note is distinct from (item->>'expected_note')
         or current_holding.private_note is distinct from (item->>'expected_private_note') then
        raise exception 'Holding changed; reload before saving';
      end if;
    else
      if exists(select 1 from public.holdings where user_id=owner_id and account_id=target_account_id
        and ticker=current_instrument.ticker) then raise exception 'Holding already exists for this account'; end if;
    end if;
    if target_id is null or current_holding.account_id is distinct from target_account_id
       or current_holding.note is distinct from target_note
       or (next_type='market' and (current_holding.quantity is distinct from (item->>'quantity')::numeric
         or current_holding.avg_price is distinct from (item->>'avg_price')::numeric))
       or (next_type='valuation' and (current_holding.purchase_amount is distinct from (item->>'purchase_amount')::numeric
         or current_holding.valuation_amount is distinct from (item->>'valuation_amount')::numeric))
       or (next_type='cash' and current_holding.valuation_amount is distinct from (item->>'valuation_amount')::numeric) then
      if next_type='market' then
        select h.holding_id into saved_holding_id from public.app_save_holding(target_id,target_account_id,
          current_instrument.ticker,(item->>'quantity')::numeric,(item->>'avg_price')::numeric,target_note,'user',null) h;
      elsif next_type='valuation' then
        select h.holding_id into saved_holding_id from public.app_save_valuation_holding(target_id,target_account_id,
          current_instrument.ticker,(item->>'purchase_amount')::numeric,(item->>'valuation_amount')::numeric,target_note,'user',null) h;
      else
        select h.holding_id into saved_holding_id from public.app_save_cash_holding(target_id,target_account_id,
          current_instrument.ticker,(item->>'valuation_amount')::numeric,target_note,'user',null) h;
      end if;
    else
      saved_holding_id := target_id;
    end if;
    if target_id is null then
      current_holding.private_note := null;
    end if;
    if current_holding.private_note is distinct from target_private_note then
      update public.holdings set private_note=target_private_note where id=saved_holding_id and user_id=owner_id;
    end if;
    saved_rows := saved_rows || jsonb_build_array((select jsonb_build_object(
      'id',h.id,'account_id',h.account_id,'ticker',h.ticker,'quantity',h.quantity,'avg_price',h.avg_price,
      'purchase_amount',h.purchase_amount,'valuation_amount',h.valuation_amount,'note',h.note,
      'private_note',h.private_note,'state_version',h.state_version)
      from public.holdings h where h.id=saved_holding_id and h.user_id=owner_id));
    current_holding := null;
  end loop;

  response_payload := jsonb_build_object('instrument',(select jsonb_build_object(
    'id',i.id,'ticker',i.ticker,'display_name',i.display_name,'currency',i.currency,
    'instrument_type',i.instrument_type,'note',i.note,'private_note',i.private_note,'tag_id',next_tag)
    from public.instruments i where i.id=input_instrument_id and i.user_id=owner_id),
    'holdings',saved_rows);
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
  values(owner_id,'save_asset_detail',input_idempotency_key,request_payload,response_payload);
  return response_payload;
end;
$$;
revoke all on function public.app_save_asset_detail(bigint,jsonb,jsonb,jsonb,uuid) from public,anon;
grant execute on function public.app_save_asset_detail(bigint,jsonb,jsonb,jsonb,uuid) to authenticated;
