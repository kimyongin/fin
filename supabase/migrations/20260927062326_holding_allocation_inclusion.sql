-- #160: one current flag per account holding; old clients that omit it retain existing values.
alter table public.holdings add column include_in_allocation boolean not null default true;

create or replace function public.sync_holding_ledger_projection()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        new.ledger_quantity := coalesce(new.ledger_quantity, coalesce(new.quantity::numeric, 0));
        new.ledger_cost_pool := coalesce(new.ledger_cost_pool,
            case when new.quantity is null or new.avg_price is null then 0 else new.quantity::numeric * new.avg_price::numeric end);
        new.state_version := coalesce(new.state_version, 1);
        new.ledger_checkpoint_at := coalesce(new.ledger_checkpoint_at, now());
    elsif new.ledger_quantity is not distinct from old.ledger_quantity
       and new.ledger_cost_pool is not distinct from old.ledger_cost_pool
       and (new.quantity is distinct from old.quantity or new.avg_price is distinct from old.avg_price) then
        new.ledger_quantity := coalesce(new.quantity::numeric, 0);
        new.ledger_cost_pool := case when new.quantity is null or new.avg_price is null then 0
            else new.quantity::numeric * new.avg_price::numeric end;
        new.ledger_checkpoint_at := clock_timestamp();
        new.state_version := old.state_version + 1;
    elsif new.ledger_quantity is distinct from old.ledger_quantity
       or new.ledger_cost_pool is distinct from old.ledger_cost_pool then
        new.quantity := new.ledger_quantity::real;
        new.avg_price := case when new.ledger_quantity = 0 then null else (new.ledger_cost_pool / new.ledger_quantity)::real end;
        new.state_version := old.state_version + 1;
    elsif new.purchase_amount is distinct from old.purchase_amount
       or new.valuation_amount is distinct from old.valuation_amount then
        new.ledger_checkpoint_at := clock_timestamp();
        new.state_version := old.state_version + 1;
    end if;
    if tg_op = 'UPDATE' and new.include_in_allocation is distinct from old.include_in_allocation
       and new.state_version is not distinct from old.state_version then
        new.state_version := old.state_version + 1;
    end if;
    return new;
end;
$$;

create or replace function public.app_save_asset_detail_with_activity(
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
  allocation_flag boolean;
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
    if item ? 'include_in_allocation' and jsonb_typeof(item->'include_in_allocation') <> 'boolean' then
      raise exception 'Invalid allocation inclusion flag';
    end if;
    allocation_flag:=case when item ? 'include_in_allocation'
      then (item->>'include_in_allocation')::boolean
      else coalesce(holding_row.include_in_allocation,true) end;
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
    current_values:=current_values||jsonb_build_object('include_in_allocation',coalesce(holding_row.include_in_allocation,true));
    next_values:=next_values||jsonb_build_object('include_in_allocation',allocation_flag);
    if holding_id is null or holding_row.account_id is distinct from target_account_id or current_values<>next_values then
      if holding_id is null then
        insert into public.holdings(user_id,account_id,ticker,quantity,avg_price,purchase_amount,valuation_amount,include_in_allocation)
        values(owner_id,target_account_id,instrument_row.ticker,
          case when next_type='market' then (next_values->>'quantity')::numeric end,
          case when next_type='market' then (next_values->>'avg_price')::numeric end,
          case when next_type='valuation' then (next_values->>'purchase_amount')::numeric end,
          case when next_type<>'market' then (next_values->>'valuation_amount')::numeric end,
          allocation_flag)
        returning id into holding_id;
      else
        update public.holdings set account_id=target_account_id,
          quantity=case when next_type='market' then (next_values->>'quantity')::numeric end,
          avg_price=case when next_type='market' then (next_values->>'avg_price')::numeric end,
          purchase_amount=case when next_type='valuation' then (next_values->>'purchase_amount')::numeric end,
          valuation_amount=case when next_type<>'market' then (next_values->>'valuation_amount')::numeric end,
          include_in_allocation=allocation_flag,updated_at=clock_timestamp()
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
      'valuation_amount',h.valuation_amount,'include_in_allocation',h.include_in_allocation,
      'state_version',h.state_version)
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

CREATE OR REPLACE FUNCTION public.app_bulk_save_portfolio_rows(input_rows jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(account_count integer, instrument_count integer, holding_count integer, activity_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  current_user_id uuid := auth.uid();
  input_row jsonb;
  type_value text;
  ticker_value text;
  account_value text;
  name_value text;
  account_id_value bigint;
  instrument_id_value bigint;
  tag_id_value bigint;
  created_accounts integer := 0;
  created_instruments integer := 0;
  saved_holdings integer := 0;
  event_id bigint;
  quantity_value numeric;
  average_value numeric;
  purchase_value numeric;
  valuation_value numeric;
  allocation_flag boolean;
  before_snapshot jsonb;
  after_snapshot jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(input_rows) <> 'array' or jsonb_array_length(input_rows) = 0 or jsonb_array_length(input_rows) > 200 then raise exception 'Provide 1 to 200 rows'; end if;

  before_snapshot := public.app_portfolio_snapshot(current_user_id);

  for input_row in select value from jsonb_array_elements(input_rows) loop
    if input_row ? 'note' then raise exception 'Legacy holding note field is no longer accepted'; end if;
    account_value := trim(coalesce(input_row ->> 'account_name', ''));
    name_value := trim(coalesce(input_row ->> 'display_name', ''));
    type_value := lower(trim(coalesce(input_row ->> 'instrument_type', 'market')));
    ticker_value := upper(trim(coalesce(input_row ->> 'ticker', '')));
    quantity_value := nullif(input_row ->> 'quantity', '')::numeric;
    average_value := nullif(input_row ->> 'avg_price', '')::numeric;
    purchase_value := nullif(input_row ->> 'purchase_amount', '')::numeric;
    valuation_value := nullif(input_row ->> 'valuation_amount', '')::numeric;
    if input_row ? 'include_in_allocation' and jsonb_typeof(input_row->'include_in_allocation') <> 'boolean' then
      raise exception 'Invalid allocation inclusion flag';
    end if;
    allocation_flag := case when input_row ? 'include_in_allocation'
      then (input_row->>'include_in_allocation')::boolean else null end;

    if account_value = '' or name_value = '' then raise exception 'Account name and instrument name are required'; end if;
    if type_value not in ('market', 'valuation', 'cash') then raise exception 'Invalid instrument type'; end if;
    if type_value = 'market' and (ticker_value = '' or quantity_value is null or quantity_value < 0 or average_value is null or average_value < 0) then raise exception 'Market investments require ticker, quantity, and average price'; end if;
    if type_value = 'valuation' and (purchase_value is null or purchase_value < 0 or valuation_value is null or valuation_value < 0) then raise exception 'Valuation investments require purchase and valuation amounts'; end if;
    if type_value = 'cash' and (valuation_value is null or valuation_value < 0) then raise exception 'Cash requires a nonnegative valuation amount'; end if;

    if ticker_value = '' then
      ticker_value := case when type_value = 'cash' then 'CASH:' else 'VALUATION:' end
        || upper(substr(md5(account_value || '|' || name_value || '|' || coalesce(input_row ->> 'currency', 'KRW')), 1, 20));
    end if;

    select id into account_id_value from public.accounts where user_id = current_user_id and lower(name) = lower(account_value) limit 1;
    if account_id_value is null then
      insert into public.accounts (user_id, name, broker, is_active)
      values (current_user_id, account_value, nullif(trim(coalesce(input_row ->> 'broker', '')), ''), true)
      returning id into account_id_value;
      created_accounts := created_accounts + 1;
    else
      update public.accounts set broker = nullif(trim(coalesce(input_row ->> 'broker', '')), '') where id = account_id_value;
    end if;

    select id into instrument_id_value from public.instruments where user_id = current_user_id and ticker = ticker_value;
    if instrument_id_value is null then
      insert into public.instruments (user_id, ticker, display_name, currency, instrument_type, price_source)
      values (current_user_id, ticker_value, name_value, upper(coalesce(input_row ->> 'currency', 'KRW')), type_value, 'manual')
      returning id into instrument_id_value;
      created_instruments := created_instruments + 1;
    else
      update public.instruments
      set display_name = name_value, currency = upper(coalesce(input_row ->> 'currency', 'KRW')), instrument_type = type_value
      where id = instrument_id_value;
    end if;

    tag_id_value := nullif(input_row ->> 'tag_id', '')::bigint;
    if tag_id_value is not null and not exists (select 1 from public.tags where id = tag_id_value and user_id = current_user_id) then raise exception 'Tag not found'; end if;
    delete from public.instrument_tags where user_id = current_user_id and ticker = ticker_value;
    if tag_id_value is not null then insert into public.instrument_tags (user_id, ticker, tag_id) values (current_user_id, ticker_value, tag_id_value); end if;

    insert into public.holdings (user_id, account_id, ticker, quantity, avg_price, purchase_amount, valuation_amount, include_in_allocation)
    values (
      current_user_id, account_id_value, ticker_value,
      case when type_value = 'market' then quantity_value else null end,
      case when type_value = 'market' then average_value else null end,
      case when type_value = 'valuation' then purchase_value else null end,
      case when type_value in ('valuation', 'cash') then valuation_value else null end,
      coalesce(allocation_flag,true)
    )
    on conflict on constraint holdings_account_id_ticker_key do update
    set quantity = excluded.quantity, avg_price = excluded.avg_price, purchase_amount = excluded.purchase_amount,
        valuation_amount = excluded.valuation_amount,
        include_in_allocation = coalesce(allocation_flag,public.holdings.include_in_allocation);
    saved_holdings := saved_holdings + 1;
  end loop;

  after_snapshot := public.app_portfolio_snapshot(current_user_id);

  insert into public.activity_events (user_id, source, action_type, target_table, before_data, after_data, status)
  values (
    current_user_id, 'user', 'bulk_edit_portfolio', 'portfolio',
    jsonb_build_object('portfolio_snapshot', before_snapshot),
    jsonb_build_object(
      'portfolio_snapshot', after_snapshot,
      'row_count', saved_holdings,
      'created_account_count', created_accounts,
      'created_instrument_count', created_instruments
    ),
    'succeeded'
  )
  returning id into event_id;

  return query select created_accounts, created_instruments, saved_holdings, event_id;
end;
$function$;




create function public.app_get_allocation_summary(input_owner_user_id uuid default null)
returns jsonb language sql stable security definer set search_path=public as $$
  with owner_ctx as (
    select coalesce(input_owner_user_id,auth.uid()) as user_id
    where public.can_view_owner(coalesce(input_owner_user_id,auth.uid()))
  ), quality as (
    select public.app_get_portfolio_valuation_quality(input_owner_user_id) as body
    from owner_ctx
  ), positions as (
    select h.include_in_allocation, h.ticker, h.user_id,
      nullif(item->>'value_krw','')::numeric as value_krw,
      item->>'status' as status
    from quality q
    cross join lateral jsonb_array_elements(coalesce(q.body->'items','[]'::jsonb)) item
    join public.holdings h on h.id=(item->>'holding_id')::bigint
    join owner_ctx o on o.user_id=h.user_id
  ), totals as (
    select count(*)::integer as total_count,
      count(*) filter (where include_in_allocation)::integer as included_count,
      count(*) filter (where not include_in_allocation)::integer as excluded_count,
      count(*) filter (where include_in_allocation and value_krw is null)::integer as included_missing_count,
      count(*) filter (where not include_in_allocation and value_krw is null)::integer as excluded_missing_count,
      count(*) filter (where include_in_allocation and status='stale')::integer as included_stale_count,
      coalesce(sum(value_krw),0) as known_total_krw,
      coalesce(sum(value_krw) filter (where include_in_allocation),0) as known_included_krw,
      coalesce(sum(value_krw) filter (where not include_in_allocation),0) as known_excluded_krw
    from positions
  )
  select jsonb_build_object(
    'known_total_krw',t.known_total_krw,
    'known_included_krw',t.known_included_krw,
    'known_excluded_krw',t.known_excluded_krw,
    'total_count',t.total_count,'included_count',t.included_count,'excluded_count',t.excluded_count,
    'included_missing_count',t.included_missing_count,'excluded_missing_count',t.excluded_missing_count,
    'included_stale_count',t.included_stale_count,
    'included_is_complete',t.included_missing_count=0,
    'excluded_is_complete',t.excluded_missing_count=0,
    'tag_values',coalesce((
      select jsonb_agg(jsonb_build_object('tag_id',tag_id,'value_krw',value_krw) order by tag_id)
      from (
        select it.tag_id, sum(p.value_krw) as value_krw
        from positions p left join public.instrument_tags it on it.user_id=p.user_id and it.ticker=p.ticker
        where p.include_in_allocation and p.value_krw is not null
        group by it.tag_id
      ) tagged
    ),'[]'::jsonb)
  ) from totals t;
$$;
revoke all on function public.app_get_allocation_summary(uuid) from public,anon,authenticated;
grant execute on function public.app_get_allocation_summary(uuid) to authenticated;
create or replace function public.app_get_portfolio_state(input_owner_user_id uuid default null)
returns jsonb language sql stable security definer set search_path=public as $$
  select public.app_redact_private_note(
    public.app_get_portfolio_state_before_private_notes(input_owner_user_id))
    || jsonb_build_object('allocation',public.app_get_allocation_summary(input_owner_user_id));
$$;
revoke all on function public.app_get_portfolio_state(uuid) from public,anon;
grant execute on function public.app_get_portfolio_state(uuid) to authenticated;
