-- A preview is a read-only estimate, not a reservation or persisted command.
create or replace function public.app_preview_trade_entry(
  input_account_id bigint, input_instrument_id bigint, input_side text,
  input_quantity numeric, input_unit_price numeric, input_executed_on date
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  side text:=lower(trim(coalesce(input_side,'')));
  instrument public.instruments%rowtype;
  holding public.holdings%rowtype;
  before_quantity numeric(38,16):=0;
  before_cost numeric(38,16):=0;
  after_quantity numeric(38,16);
  after_cost numeric(38,16);
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if side not in ('buy','sell') then raise exception 'Trade side must be buy or sell'; end if;
  if input_quantity is null or input_quantity<=0 or scale(input_quantity)>16 then raise exception 'Trade quantity must be positive with at most 16 decimal places'; end if;
  if input_unit_price is null or input_unit_price<=0 or scale(input_unit_price)>16 then raise exception 'Trade unit price must be positive with at most 16 decimal places'; end if;
  if input_executed_on is null or input_executed_on>current_date then raise exception 'Trade date is required and cannot be in the future'; end if;
  if not exists(select 1 from public.accounts where id=input_account_id and user_id=owner_id) then raise exception 'Account was not found or is not accessible'; end if;
  select * into instrument from public.instruments where id=input_instrument_id and user_id=owner_id;
  if not found then raise exception 'Instrument was not found or is not accessible'; end if;
  if instrument.instrument_type<>'market' then raise exception 'Only market instruments support trade entries'; end if;
  select * into holding from public.holdings where user_id=owner_id and account_id=input_account_id and ticker=instrument.ticker;
  if found then
    before_quantity:=holding.ledger_quantity;
    before_cost:=holding.ledger_cost_pool;
  elsif side='sell' then
    raise exception 'Cannot sell an instrument that is not held in this account';
  end if;
  if side='buy' then
    after_quantity:=before_quantity+input_quantity;
    after_cost:=before_cost+input_quantity*input_unit_price;
  else
    if input_quantity>before_quantity then raise exception 'Trade would sell more than the current holding'; end if;
    after_quantity:=before_quantity-input_quantity;
    after_cost:=case when after_quantity=0 then 0 else before_cost*after_quantity/before_quantity end;
  end if;
  return jsonb_build_object(
    'account_id',input_account_id,'instrument_id',input_instrument_id,
    'ticker',instrument.ticker,'instrument_name',instrument.display_name,
    'side',side,'quantity',input_quantity::text,'unit_price',input_unit_price::text,
    'executed_on',input_executed_on,'holding_id',holding.id,
    'holding_state_version',coalesce(holding.state_version,0),
    'before',jsonb_build_object('quantity',before_quantity::text,'avg_price',case when before_quantity=0 then null else (before_cost/before_quantity)::text end),
    'after',jsonb_build_object('quantity',after_quantity::text,'avg_price',case when after_quantity=0 then null else (after_cost/after_quantity)::text end)
  );
end; $$;

-- The old trade ledger remains temporarily for read compatibility. The new
-- path does not create trade_previews; next slice moves reads to activities.
alter table public.trade_entries alter column preview_id drop not null;

create function public.app_record_completed_trade(
  input_account_id bigint, input_instrument_id bigint, input_side text,
  input_quantity numeric, input_unit_price numeric, input_executed_on date,
  input_expected_holding_id bigint, input_expected_version bigint,
  input_idempotency_key uuid, input_authored_via text default 'app'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  side text:=lower(trim(coalesce(input_side,'')));
  instrument public.instruments%rowtype;
  holding public.holdings%rowtype;
  saved_holding public.holdings%rowtype;
  saved_trade public.trade_entries%rowtype;
  receipt public.trade_entry_mutation_receipts%rowtype;
  before_quantity numeric(38,16):=0;
  before_cost numeric(38,16):=0;
  after_quantity numeric(38,16);
  after_cost numeric(38,16);
  request_payload jsonb;
  response_payload jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if input_authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
  if side not in ('buy','sell') then raise exception 'Trade side must be buy or sell'; end if;
  if input_quantity is null or input_quantity<=0 or scale(input_quantity)>16 then raise exception 'Trade quantity must be positive with at most 16 decimal places'; end if;
  if input_unit_price is null or input_unit_price<=0 or scale(input_unit_price)>16 then raise exception 'Trade unit price must be positive with at most 16 decimal places'; end if;
  if input_executed_on is null or input_executed_on>current_date then raise exception 'Trade date is required and cannot be in the future'; end if;
  if input_expected_version is null or input_expected_version<0 then raise exception 'Expected holding version is required'; end if;
  request_payload:=jsonb_build_object(
    'account_id',input_account_id,'instrument_id',input_instrument_id,'side',side,
    'quantity',input_quantity::text,'unit_price',input_unit_price::text,'executed_on',input_executed_on,
    'expected_holding_id',input_expected_holding_id,'expected_version',input_expected_version,'authored_via',input_authored_via);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':log_trade:'||input_idempotency_key::text,0));
  select * into receipt from public.trade_entry_mutation_receipts
    where user_id=owner_id and idempotency_key=input_idempotency_key;
  if found then
    if receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;
  if not exists(select 1 from public.accounts where id=input_account_id and user_id=owner_id) then raise exception 'Account was not found or is not accessible'; end if;
  select * into instrument from public.instruments where id=input_instrument_id and user_id=owner_id;
  if not found then raise exception 'Instrument was not found or is not accessible'; end if;
  if instrument.instrument_type<>'market' then raise exception 'Only market instruments support trade entries'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    owner_id::text||':holding_stream:'||input_account_id::text||':'||input_instrument_id::text,0));
  select * into holding from public.holdings
    where user_id=owner_id and account_id=input_account_id and ticker=instrument.ticker for update;
  if found then
    if input_expected_holding_id is distinct from holding.id or input_expected_version<>holding.state_version
      then raise exception 'Trade estimate is stale; calculate it again'; end if;
    before_quantity:=holding.ledger_quantity;
    before_cost:=holding.ledger_cost_pool;
  elsif input_expected_holding_id is not null or input_expected_version<>0 then
    raise exception 'Trade estimate is stale; calculate it again';
  elsif side='sell' then
    raise exception 'Cannot sell an instrument that is not held in this account';
  end if;
  if side='buy' then
    after_quantity:=before_quantity+input_quantity;
    after_cost:=before_cost+input_quantity*input_unit_price;
  else
    if input_quantity>before_quantity then raise exception 'Trade would sell more than the current holding'; end if;
    after_quantity:=before_quantity-input_quantity;
    after_cost:=case when after_quantity=0 then 0 else before_cost*after_quantity/before_quantity end;
  end if;
  if holding.id is null then
    insert into public.holdings(user_id,account_id,ticker,quantity,avg_price,ledger_quantity,ledger_cost_pool)
    values(owner_id,input_account_id,instrument.ticker,after_quantity::real,(after_cost/after_quantity)::real,after_quantity,after_cost)
    returning * into saved_holding;
  else
    update public.holdings set ledger_quantity=after_quantity,ledger_cost_pool=after_cost,updated_at=clock_timestamp()
    where id=holding.id and user_id=owner_id returning * into saved_holding;
  end if;
  insert into public.trade_entries(
    user_id,account_id,instrument_id,holding_id,side,quantity,unit_price,executed_on,
    before_quantity,before_cost_pool,after_quantity,after_cost_pool,authored_via
  ) values (
    owner_id,input_account_id,input_instrument_id,saved_holding.id,side,input_quantity,input_unit_price,input_executed_on,
    before_quantity,before_cost,after_quantity,after_cost,input_authored_via
  ) returning * into saved_trade;
  insert into public.activity_events(
    user_id,source,action_type,target_table,target_id,instrument_id,account_id,
    title,before_data,after_data,status,occurrence_on
  ) values (
    owner_id,case when input_authored_via='app' then 'user' else 'agent' end,
    'log_completed_trade','trade_entries',saved_trade.id::text,input_instrument_id,input_account_id,
    instrument.display_name||case when side='buy' then ' 매수' else ' 매도' end,
    jsonb_build_object('quantity',before_quantity::text,'avg_price',case when before_quantity=0 then null else (before_cost/before_quantity)::text end),
    jsonb_build_object('quantity',after_quantity::text,'avg_price',case when after_quantity=0 then null else (after_cost/after_quantity)::text end,
      'side',side,'trade_quantity',input_quantity::text,'unit_price',input_unit_price::text,'executed_on',input_executed_on,
      'account_id',input_account_id,'instrument_id',input_instrument_id,'ticker',instrument.ticker),
    'succeeded',input_executed_on
  );
  response_payload:=jsonb_build_object(
    'trade_id',saved_trade.id,'holding_id',saved_holding.id,'side',side,
    'quantity',input_quantity::text,'unit_price',input_unit_price::text,'executed_on',input_executed_on,
    'holding',jsonb_build_object('state_version',saved_holding.state_version,
      'quantity',saved_holding.ledger_quantity::text,
      'avg_price',case when saved_holding.ledger_quantity=0 then null else (saved_holding.ledger_cost_pool/saved_holding.ledger_quantity)::text end));
  insert into public.trade_entry_mutation_receipts(user_id,idempotency_key,request_payload,response_payload)
  values(owner_id,input_idempotency_key,request_payload,response_payload);
  return response_payload;
end; $$;

revoke all on function public.app_record_completed_trade(bigint,bigint,text,numeric,numeric,date,bigint,bigint,uuid,text) from public,anon;
grant execute on function public.app_record_completed_trade(bigint,bigint,text,numeric,numeric,date,bigint,bigint,uuid,text) to authenticated;
