-- Brokerage comparison status was not part of the current asset workflow.
-- Keep absolute correction and its activity/receipt, but retire verification
-- checkpoints and the API branches that maintained them.
drop function if exists public.app_get_portfolio_integrity();
drop function if exists public.app_get_holding_integrity(bigint);
drop function if exists public.app_verify_holding(bigint,bigint,text[],date,text,uuid,text);
drop function if exists public.app_apply_holding_correction(bigint,jsonb,text,date,text[],bigint,uuid,text);
drop function if exists public.app_preview_holding_reconciliation(bigint,jsonb,text,date,text[]);

-- Keep only idempotent correction receipts. Verification-only receipts have
-- no remaining writer or retry contract.
delete from public.holding_integrity_mutation_receipts where operation='verify';
alter table public.holding_integrity_mutation_receipts drop column operation;
alter table public.holding_integrity_mutation_receipts rename to holding_correction_mutation_receipts;
alter policy holding_integrity_receipts_select_own on public.holding_correction_mutation_receipts
  rename to holding_correction_receipts_select_own;

create function public.app_preview_holding_reconciliation(
  input_holding_id bigint,input_values jsonb,input_reason text,input_effective_on date
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid(); holding public.holdings%rowtype;
  instrument public.instruments%rowtype; before_value jsonb; after_value jsonb;
  allowed_fields text[];
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if coalesce(jsonb_typeof(input_values),'null')<>'object' then
    raise exception 'Reconciliation values must be an object'; end if;
  if exists(select 1 from jsonb_each(input_values) item
    where jsonb_typeof(item.value)<>'string'
      or (item.value#>>'{}') !~ '^(0|[1-9][0-9]*)([.][0-9]{1,16})?$') then
    raise exception 'Reconciliation values must be nonnegative decimal strings with at most 16 decimal places'; end if;
  if char_length(trim(coalesce(input_reason,''))) not between 1 and 1000 then
    raise exception 'Reconciliation reason is required'; end if;
  if input_effective_on is null or input_effective_on>(clock_timestamp() at time zone 'Asia/Seoul')::date then
    raise exception 'Reconciliation date is required and cannot be in the future'; end if;
  select * into holding from public.holdings where id=input_holding_id and user_id=owner_id;
  if not found then raise exception 'Holding was not found or is not accessible'; end if;
  select * into instrument from public.instruments where user_id=owner_id and ticker=holding.ticker;
  if instrument.instrument_type='market' then
    allowed_fields:=array['quantity','avg_price'];
    if not(input_values?'quantity') or not(input_values?'avg_price') then
      raise exception 'Market reconciliation requires quantity and avg_price'; end if;
    before_value:=jsonb_build_object('quantity',holding.ledger_quantity::text,
      'avg_price',case when holding.ledger_quantity=0 then null
        else (holding.ledger_cost_pool/holding.ledger_quantity)::text end);
    after_value:=jsonb_build_object('quantity',((input_values->>'quantity')::numeric)::text,
      'avg_price',case when (input_values->>'quantity')::numeric=0 then null
        else ((input_values->>'avg_price')::numeric)::text end);
  elsif instrument.instrument_type='valuation' then
    allowed_fields:=array['purchase_amount','valuation_amount'];
    if not(input_values?'purchase_amount') or not(input_values?'valuation_amount') then
      raise exception 'Valuation reconciliation requires purchase_amount and valuation_amount'; end if;
    before_value:=jsonb_build_object('purchase_amount',holding.purchase_amount::text,
      'valuation_amount',holding.valuation_amount::text);
    after_value:=jsonb_build_object('purchase_amount',((input_values->>'purchase_amount')::numeric)::text,
      'valuation_amount',((input_values->>'valuation_amount')::numeric)::text);
  elsif instrument.instrument_type='cash' then
    allowed_fields:=array['valuation_amount'];
    if not(input_values?'valuation_amount') then
      raise exception 'Cash reconciliation requires a nonnegative valuation_amount'; end if;
    before_value:=jsonb_build_object('valuation_amount',holding.valuation_amount::text);
    after_value:=jsonb_build_object('valuation_amount',((input_values->>'valuation_amount')::numeric)::text);
  else
    raise exception 'This instrument type does not support reconciliation';
  end if;
  if exists(select 1 from jsonb_object_keys(input_values) key where not key=any(allowed_fields)) then
    raise exception 'Reconciliation contains an unsupported field'; end if;
  return jsonb_build_object('holding_id',holding.id,'holding_state_version',holding.state_version,
    'instrument_id',instrument.id,'instrument_type',instrument.instrument_type,
    'before',before_value,'after',after_value,
    'reason',trim(input_reason),'effective_on',input_effective_on);
end; $$;
revoke all on function public.app_preview_holding_reconciliation(bigint,jsonb,text,date) from public,anon;
grant execute on function public.app_preview_holding_reconciliation(bigint,jsonb,text,date) to authenticated;

create function public.app_apply_holding_correction(
  input_holding_id bigint,input_values jsonb,input_reason text,input_effective_on date,
  input_expected_version bigint,input_idempotency_key uuid,input_authored_via text default 'app'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid(); holding public.holdings%rowtype;
  saved_holding public.holdings%rowtype; instrument public.instruments%rowtype;
  estimate jsonb; receipt public.holding_correction_mutation_receipts%rowtype;
  request_payload jsonb; response_payload jsonb; activity_id bigint;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if input_authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
  if input_expected_version is null or input_expected_version<1 then
    raise exception 'Expected holding version is required'; end if;
  request_payload:=jsonb_build_object('holding_id',input_holding_id,'values',input_values,
    'reason',trim(coalesce(input_reason,'')),'effective_on',input_effective_on,
    'expected_version',input_expected_version,'authored_via',input_authored_via);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':reconcile:'||input_idempotency_key::text,0));
  select * into receipt from public.holding_correction_mutation_receipts
    where user_id=owner_id and idempotency_key=input_idempotency_key;
  if found then
    if receipt.request_payload-'confirmed_fields'<>request_payload then
      raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload-'verification_id';
  end if;
  select * into holding from public.holdings where id=input_holding_id and user_id=owner_id for update;
  if not found then raise exception 'Holding was not found or is not accessible'; end if;
  if holding.state_version<>input_expected_version then raise exception 'Holding version conflict'; end if;
  estimate:=public.app_preview_holding_reconciliation(
    input_holding_id,input_values,input_reason,input_effective_on);
  select * into instrument from public.instruments
    where id=(estimate->>'instrument_id')::bigint and user_id=owner_id;
  if instrument.instrument_type='market' then
    update public.holdings set
      ledger_quantity=(estimate#>>'{after,quantity}')::numeric,
      ledger_cost_pool=case when (estimate#>>'{after,quantity}')::numeric=0 then 0
        else (estimate#>>'{after,quantity}')::numeric*(estimate#>>'{after,avg_price}')::numeric end,
      ledger_checkpoint_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=holding.id and user_id=owner_id returning * into saved_holding;
  elsif instrument.instrument_type='valuation' then
    update public.holdings set
      purchase_amount=(estimate#>>'{after,purchase_amount}')::numeric,
      valuation_amount=(estimate#>>'{after,valuation_amount}')::numeric,
      ledger_checkpoint_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=holding.id and user_id=owner_id returning * into saved_holding;
  else
    update public.holdings set
      valuation_amount=(estimate#>>'{after,valuation_amount}')::numeric,
      ledger_checkpoint_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=holding.id and user_id=owner_id returning * into saved_holding;
  end if;
  insert into public.activity_events(
    user_id,source,action_type,target_table,target_id,instrument_id,account_id,
    title,before_data,after_data,status,occurrence_on)
  values(owner_id,case when input_authored_via='app' then 'user' else 'agent' end,
    'reconcile_holding','holdings',holding.id::text,instrument.id,holding.account_id,
    instrument.display_name||' 잔고 보정',estimate->'before',
    (estimate->'after')||jsonb_build_object('reason',trim(input_reason),
      'effective_on',input_effective_on),'succeeded',input_effective_on)
  returning id into activity_id;
  response_payload:=jsonb_build_object('activity_id',activity_id,'holding_id',holding.id,
    'holding_state_version',saved_holding.state_version,
    'before',estimate->'before','after',estimate->'after');
  insert into public.holding_correction_mutation_receipts
    (user_id,idempotency_key,request_payload,response_payload)
  values(owner_id,input_idempotency_key,request_payload,response_payload);
  return response_payload;
end; $$;
revoke all on function public.app_apply_holding_correction(bigint,jsonb,text,date,bigint,uuid,text) from public,anon;
grant execute on function public.app_apply_holding_correction(bigint,jsonb,text,date,bigint,uuid,text) to authenticated;

-- Historical verification activities remain readable as performed facts.
-- They do not influence the current holding or its display.
alter table public.holdings drop column last_verification;
