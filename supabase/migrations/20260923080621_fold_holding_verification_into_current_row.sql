-- The product reads only the latest explicit comparison. Store that current
-- checkpoint with the current holding; keep performed facts in activities.
alter table public.holdings add column last_verification jsonb;

-- Portfolio holdings are intentionally shareable; brokerage comparison notes
-- are not. The existing recursive redactor also protects edit activity diffs.
create or replace function public.app_redact_private_note(input_value jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare result jsonb;
begin
  if input_value is null then return null; end if;
  if jsonb_typeof(input_value)='object' then
    select coalesce(jsonb_object_agg(key,public.app_redact_private_note(value)),'{}'::jsonb)
    into result from jsonb_each(input_value)
    where key not in ('private_note','last_verification');
    return result;
  elsif jsonb_typeof(input_value)='array' then
    select coalesce(jsonb_agg(public.app_redact_private_note(value) order by ordinal),'[]'::jsonb)
    into result from jsonb_array_elements(input_value) with ordinality as entry(value,ordinal);
    return result;
  end if;
  return input_value;
end; $$;

create or replace function public.app_verify_holding(
  input_holding_id bigint,input_expected_version bigint,input_fields text[],
  input_verified_on date,input_note text,input_idempotency_key uuid,
  input_source text default 'app'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid(); holding public.holdings%rowtype;
  instrument public.instruments%rowtype; allowed text[]; field text;
  snapshot jsonb:='{}'::jsonb; verification jsonb;
  receipt public.holding_integrity_mutation_receipts%rowtype;
  request_payload jsonb; response_payload jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if input_source not in ('app','agent') then raise exception 'Invalid verification source'; end if;
  if input_verified_on is null or input_verified_on>current_date then
    raise exception 'Verification date is required and cannot be in the future'; end if;
  if char_length(coalesce(input_note,''))>1000 then raise exception 'Verification note is too long'; end if;
  request_payload:=jsonb_build_object('holding_id',input_holding_id,
    'expected_version',input_expected_version,'fields',input_fields,
    'verified_on',input_verified_on,'note',nullif(trim(coalesce(input_note,'')),''),
    'source',input_source);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':verify:'||input_idempotency_key::text,0));
  select * into receipt from public.holding_integrity_mutation_receipts
    where user_id=owner_id and idempotency_key=input_idempotency_key;
  if found then
    if receipt.operation<>'verify' or receipt.request_payload<>request_payload then
      raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;
  select * into holding from public.holdings where id=input_holding_id and user_id=owner_id for update;
  if not found then raise exception 'Holding was not found or is not accessible'; end if;
  if holding.state_version<>input_expected_version then raise exception 'Holding version conflict'; end if;
  select * into instrument from public.instruments where user_id=owner_id and ticker=holding.ticker;
  allowed:=case instrument.instrument_type when 'market' then array['quantity','avg_price']
    when 'valuation' then array['purchase_amount','valuation_amount']
    when 'cash' then array['valuation_amount'] else '{}'::text[] end;
  if cardinality(coalesce(input_fields,'{}'::text[]))=0 then
    raise exception 'At least one verified field is required'; end if;
  if cardinality(input_fields)<>(select count(distinct value) from unnest(input_fields) value) then
    raise exception 'Verified fields must be unique'; end if;
  foreach field in array input_fields loop
    if not field=any(allowed) then raise exception 'Verified field is invalid for this holding type'; end if;
    snapshot:=snapshot||case field
      when 'quantity' then jsonb_build_object(field,holding.ledger_quantity::text)
      when 'avg_price' then jsonb_build_object(field,case when holding.ledger_quantity=0 then null else (holding.ledger_cost_pool/holding.ledger_quantity)::text end)
      when 'purchase_amount' then jsonb_build_object(field,holding.purchase_amount::text)
      else jsonb_build_object(field,holding.valuation_amount::text) end;
  end loop;
  verification:=jsonb_build_object('id',gen_random_uuid(),
    'holding_state_version',holding.state_version,'verified_fields',input_fields,
    'value_snapshot',snapshot,'verified_on',input_verified_on,
    'note',nullif(trim(coalesce(input_note,'')),''),'source',input_source,
    'created_at',clock_timestamp());
  update public.holdings set last_verification=verification where id=holding.id and user_id=owner_id;
  insert into public.activity_events(user_id,source,action_type,target_table,target_id,
    instrument_id,account_id,title,after_data,status,occurrence_on)
  values(owner_id,case when input_source='app' then 'user' else 'agent' end,
    'verify_holding','holdings',holding.id::text,instrument.id,holding.account_id,
    instrument.display_name||' 잔고 확인',verification,'succeeded',input_verified_on);
  response_payload:=jsonb_build_object('verification_id',verification->>'id',
    'holding_id',holding.id,'holding_state_version',holding.state_version,
    'verified_fields',input_fields,'value_snapshot',snapshot,'verified_on',input_verified_on,
    'note',verification->'note','source',input_source,'created_at',verification->'created_at');
  insert into public.holding_integrity_mutation_receipts
    (user_id,idempotency_key,operation,request_payload,response_payload)
  values(owner_id,input_idempotency_key,'verify',request_payload,response_payload);
  return response_payload;
end; $$;

create or replace function public.app_get_holding_integrity(input_holding_id bigint)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'holding_id',holding.id,'state_version',holding.state_version,
    'last_reconciliation',(
      select jsonb_build_object('id',event.id,'effective_on',event.occurrence_on,
        'reason',event.after_data->>'reason','created_at',event.created_at)
      from public.activity_events event
      where event.user_id=auth.uid() and event.target_table='holdings'
        and event.target_id=holding.id::text and event.action_type='reconcile_holding'
        and event.status='succeeded'
      order by event.created_at desc,event.id desc limit 1),
    'last_verification',case when holding.last_verification is null then null else
      holding.last_verification||jsonb_build_object(
        'changed_since',(holding.last_verification->>'holding_state_version')::bigint<>holding.state_version) end
  ) from public.holdings holding where holding.id=input_holding_id and holding.user_id=auth.uid();
$$;

create or replace function public.app_get_portfolio_integrity()
returns jsonb language sql stable security definer set search_path=public as $$
  with rows as (
    select h.id holding_id,h.account_id,a.name account_name,h.ticker,h.state_version,
      (h.last_verification->>'created_at')::timestamptz verified_at,
      (h.last_verification->>'holding_state_version')::bigint verified_version,
      case when h.last_verification is null then 'never_verified'
        when (h.last_verification->>'holding_state_version')::bigint<h.state_version then 'changed_since'
        else 'verified' end status
    from public.holdings h join public.accounts a on a.id=h.account_id and a.user_id=h.user_id
    where h.user_id=auth.uid()
  ), accounts_summary as (
    select account_id,account_name,count(*) total_count,
      count(*) filter(where status='verified') verified_count,
      count(*) filter(where status='changed_since') changed_count,
      count(*) filter(where status='never_verified') never_verified_count,
      max(verified_at) last_verified_at from rows group by account_id,account_name
  ) select jsonb_build_object(
    'total_count',(select count(*) from rows),
    'verified_count',(select count(*) from rows where status='verified'),
    'changed_count',(select count(*) from rows where status='changed_since'),
    'never_verified_count',(select count(*) from rows where status='never_verified'),
    'last_verified_at',(select max(verified_at) from rows),
    'accounts',coalesce((select jsonb_agg(to_jsonb(accounts_summary) order by account_name) from accounts_summary),'[]'::jsonb),
    'holdings',coalesce((select jsonb_agg(to_jsonb(rows) order by account_name,ticker) from rows),'[]'::jsonb));
$$;

create or replace function public.app_apply_holding_correction(
  input_holding_id bigint,input_values jsonb,input_reason text,
  input_effective_on date,input_confirmed_fields text[],
  input_expected_version bigint,input_idempotency_key uuid,
  input_authored_via text default 'app'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid(); holding public.holdings%rowtype;
  saved_holding public.holdings%rowtype; instrument public.instruments%rowtype;
  estimate jsonb; verification jsonb; receipt public.holding_integrity_mutation_receipts%rowtype;
  request_payload jsonb; response_payload jsonb; activity_id bigint;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if input_authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
  if input_expected_version is null or input_expected_version<1 then
    raise exception 'Expected holding version is required'; end if;
  request_payload:=jsonb_build_object('holding_id',input_holding_id,'values',input_values,
    'reason',trim(coalesce(input_reason,'')),'effective_on',input_effective_on,
    'confirmed_fields',coalesce(input_confirmed_fields,'{}'::text[]),
    'expected_version',input_expected_version,'authored_via',input_authored_via);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':reconcile:'||input_idempotency_key::text,0));
  select * into receipt from public.holding_integrity_mutation_receipts
    where user_id=owner_id and idempotency_key=input_idempotency_key;
  if found then
    if receipt.operation<>'reconcile' or receipt.request_payload<>request_payload then
      raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;
  select * into holding from public.holdings where id=input_holding_id and user_id=owner_id for update;
  if not found then raise exception 'Holding was not found or is not accessible'; end if;
  if holding.state_version<>input_expected_version then raise exception 'Holding version conflict'; end if;
  estimate:=public.app_preview_holding_reconciliation(
    input_holding_id,input_values,input_reason,input_effective_on,input_confirmed_fields);
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
  if cardinality(coalesce(input_confirmed_fields,'{}'::text[]))>0 then
    verification:=jsonb_build_object('id',gen_random_uuid(),
      'holding_state_version',saved_holding.state_version,
      'verified_fields',input_confirmed_fields,'value_snapshot',estimate->'after',
      'verified_on',input_effective_on,'note','보정과 함께 실제 잔고를 확인함',
      'source','reconciliation','created_at',clock_timestamp());
    update public.holdings set last_verification=verification
      where id=holding.id and user_id=owner_id;
  end if;
  insert into public.activity_events(
    user_id,source,action_type,target_table,target_id,instrument_id,account_id,
    title,before_data,after_data,status,occurrence_on)
  values(owner_id,case when input_authored_via='app' then 'user' else 'agent' end,
    'reconcile_holding','holdings',holding.id::text,instrument.id,holding.account_id,
    instrument.display_name||' 잔고 보정',estimate->'before',
    (estimate->'after')||jsonb_build_object('reason',trim(input_reason),
      'confirmed_fields',coalesce(input_confirmed_fields,'{}'::text[]),
      'effective_on',input_effective_on),'succeeded',input_effective_on)
  returning id into activity_id;
  response_payload:=jsonb_build_object('activity_id',activity_id,'holding_id',holding.id,
    'holding_state_version',saved_holding.state_version,
    'before',estimate->'before','after',estimate->'after',
    'verification_id',verification->>'id');
  insert into public.holding_integrity_mutation_receipts
    (user_id,idempotency_key,operation,request_payload,response_payload)
  values(owner_id,input_idempotency_key,'reconcile',request_payload,response_payload);
  return response_payload;
end; $$;

-- Old comparisons are not replayed into current state: the owner accepted
-- discarding prior investment data. New changes retain just the latest state.
drop table public.holding_verifications;
drop function if exists public.log_holding_verification_activity();
