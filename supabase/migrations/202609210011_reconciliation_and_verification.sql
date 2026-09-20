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
        new.ledger_cost_pool := case when new.quantity is null or new.avg_price is null then 0 else new.quantity::numeric * new.avg_price::numeric end;
        new.ledger_checkpoint_at := clock_timestamp();
        new.state_version := old.state_version + 1;
    elsif new.ledger_quantity is distinct from old.ledger_quantity or new.ledger_cost_pool is distinct from old.ledger_cost_pool then
        new.quantity := new.ledger_quantity::real;
        new.avg_price := case when new.ledger_quantity = 0 then null else (new.ledger_cost_pool / new.ledger_quantity)::real end;
        new.state_version := old.state_version + 1;
    elsif new.purchase_amount is distinct from old.purchase_amount or new.valuation_amount is distinct from old.valuation_amount then
        new.ledger_checkpoint_at := clock_timestamp();
        new.state_version := old.state_version + 1;
    end if;
    return new;
end;
$$;

create table public.holding_reconciliation_previews (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    holding_id bigint not null references public.holdings(id) on delete cascade,
    instrument_id bigint not null references public.instruments(id) on delete cascade,
    holding_state_version bigint not null,
    before_snapshot jsonb not null check (jsonb_typeof(before_snapshot) = 'object'),
    after_snapshot jsonb not null check (jsonb_typeof(after_snapshot) = 'object'),
    reason text not null check (char_length(trim(reason)) between 1 and 1000),
    confirmed_fields text[] not null default '{}',
    effective_on date not null,
    expires_at timestamptz not null,
    consumed_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, id)
);

create table public.holding_reconciliations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    holding_id bigint not null references public.holdings(id) on delete restrict,
    instrument_id bigint not null references public.instruments(id) on delete restrict,
    preview_id uuid not null,
    before_snapshot jsonb not null,
    after_snapshot jsonb not null,
    reason text not null,
    effective_on date not null,
    holding_state_version bigint not null,
    authored_via text not null check (authored_via in ('app', 'agent')),
    created_at timestamptz not null default now(),
    unique (user_id, preview_id),
    foreign key (user_id, preview_id) references public.holding_reconciliation_previews(user_id, id)
);

create table public.holding_verifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    holding_id bigint not null references public.holdings(id) on delete cascade,
    instrument_id bigint not null references public.instruments(id) on delete cascade,
    holding_state_version bigint not null,
    verified_fields text[] not null check (cardinality(verified_fields) > 0),
    value_snapshot jsonb not null check (jsonb_typeof(value_snapshot) = 'object'),
    verified_on date not null,
    note text check (note is null or char_length(note) <= 1000),
    source text not null check (source in ('app', 'agent', 'reconciliation')),
    created_at timestamptz not null default now(),
    unique (user_id, id)
);

create table public.holding_integrity_mutation_receipts (
    user_id uuid not null references auth.users(id) on delete cascade,
    idempotency_key uuid not null,
    operation text not null check (operation in ('reconcile', 'verify')),
    request_payload jsonb not null,
    response_payload jsonb not null,
    created_at timestamptz not null default now(),
    primary key (user_id, idempotency_key)
);

alter table public.holding_reconciliation_previews enable row level security;
alter table public.holding_reconciliations enable row level security;
alter table public.holding_verifications enable row level security;
alter table public.holding_integrity_mutation_receipts enable row level security;
create policy holding_reconciliation_previews_select_own on public.holding_reconciliation_previews for select to authenticated using (user_id=auth.uid());
create policy holding_reconciliations_select_own on public.holding_reconciliations for select to authenticated using (user_id=auth.uid());
create policy holding_verifications_select_own on public.holding_verifications for select to authenticated using (user_id=auth.uid());
create policy holding_integrity_receipts_select_own on public.holding_integrity_mutation_receipts for select to authenticated using (user_id=auth.uid());

create or replace function public.app_preview_holding_reconciliation(
    input_holding_id bigint,
    input_values jsonb,
    input_reason text,
    input_effective_on date,
    input_confirmed_fields text[] default '{}'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
    current_user_id uuid := auth.uid();
    current_holding public.holdings%rowtype;
    instrument public.instruments%rowtype;
    before_value jsonb;
    after_value jsonb;
    allowed_fields text[];
    field text;
    saved public.holding_reconciliation_previews%rowtype;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if coalesce(jsonb_typeof(input_values),'null') <> 'object' then raise exception 'Reconciliation values must be an object'; end if;
    if char_length(trim(coalesce(input_reason,''))) not between 1 and 1000 then raise exception 'Reconciliation reason is required'; end if;
    if input_effective_on is null or input_effective_on > current_date then raise exception 'Reconciliation date is required and cannot be in the future'; end if;
    select * into current_holding from public.holdings where id=input_holding_id and user_id=current_user_id;
    if not found then raise exception 'Holding was not found or is not accessible'; end if;
    select * into instrument from public.instruments where user_id=current_user_id and ticker=current_holding.ticker;
    if instrument.instrument_type='market' then
        allowed_fields := array['quantity','avg_price'];
        if not (input_values ? 'quantity') or not (input_values ? 'avg_price') then raise exception 'Market reconciliation requires quantity and avg_price'; end if;
        if (input_values->>'quantity')::numeric < 0 or (input_values->>'avg_price')::numeric < 0 then raise exception 'Reconciliation values cannot be negative'; end if;
        before_value := jsonb_build_object('quantity',current_holding.ledger_quantity::text,'avg_price',case when current_holding.ledger_quantity=0 then null else (current_holding.ledger_cost_pool/current_holding.ledger_quantity)::text end);
        after_value := jsonb_build_object('quantity',((input_values->>'quantity')::numeric)::text,'avg_price',case when (input_values->>'quantity')::numeric=0 then null else ((input_values->>'avg_price')::numeric)::text end);
    elsif instrument.instrument_type='valuation' then
        allowed_fields := array['purchase_amount','valuation_amount'];
        if not (input_values ? 'purchase_amount') or not (input_values ? 'valuation_amount') then raise exception 'Valuation reconciliation requires purchase_amount and valuation_amount'; end if;
        if (input_values->>'purchase_amount')::numeric < 0 or (input_values->>'valuation_amount')::numeric < 0 then raise exception 'Reconciliation values cannot be negative'; end if;
        before_value := jsonb_build_object('purchase_amount',current_holding.purchase_amount::text,'valuation_amount',current_holding.valuation_amount::text);
        after_value := jsonb_build_object('purchase_amount',((input_values->>'purchase_amount')::numeric)::text,'valuation_amount',((input_values->>'valuation_amount')::numeric)::text);
    elsif instrument.instrument_type='cash' then
        allowed_fields := array['valuation_amount'];
        if not (input_values ? 'valuation_amount') or (input_values->>'valuation_amount')::numeric < 0 then raise exception 'Cash reconciliation requires a nonnegative valuation_amount'; end if;
        before_value := jsonb_build_object('valuation_amount',current_holding.valuation_amount::text);
        after_value := jsonb_build_object('valuation_amount',((input_values->>'valuation_amount')::numeric)::text);
    else raise exception 'This instrument type does not support reconciliation'; end if;
    if exists(select 1 from jsonb_object_keys(input_values) key where not key=any(allowed_fields)) then raise exception 'Reconciliation contains an unsupported field'; end if;
    foreach field in array coalesce(input_confirmed_fields,'{}') loop
        if not field=any(allowed_fields) then raise exception 'Confirmed field is invalid for this holding type'; end if;
    end loop;
    insert into public.holding_reconciliation_previews(user_id,holding_id,instrument_id,holding_state_version,before_snapshot,after_snapshot,reason,confirmed_fields,effective_on,expires_at)
    values(current_user_id,current_holding.id,instrument.id,current_holding.state_version,before_value,after_value,trim(input_reason),coalesce(input_confirmed_fields,'{}'),input_effective_on,clock_timestamp()+interval '15 minutes') returning * into saved;
    return jsonb_build_object('preview_id',saved.id,'expires_at',saved.expires_at,'holding_id',saved.holding_id,'instrument_id',saved.instrument_id,'instrument_type',instrument.instrument_type,'before',saved.before_snapshot,'after',saved.after_snapshot,'confirmed_fields',saved.confirmed_fields,'reason',saved.reason,'effective_on',saved.effective_on);
end; $$;

create or replace function public.app_reconcile_holding(input_preview_id uuid,input_idempotency_key uuid,input_authored_via text default 'app')
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 current_user_id uuid:=auth.uid(); preview public.holding_reconciliation_previews%rowtype; holding public.holdings%rowtype; instrument public.instruments%rowtype; saved public.holding_reconciliations%rowtype; receipt public.holding_integrity_mutation_receipts%rowtype; request jsonb; response jsonb; verification_id uuid;
begin
 if current_user_id is null then raise exception 'Authentication required'; end if;
 if input_authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
 request:=jsonb_build_object('preview_id',input_preview_id,'authored_via',input_authored_via);
 perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':reconcile:'||input_idempotency_key::text,0));
 select * into receipt from public.holding_integrity_mutation_receipts where user_id=current_user_id and idempotency_key=input_idempotency_key;
 if found then if receipt.operation<>'reconcile' or receipt.request_payload<>request then raise exception 'Idempotency key was already used with a different request'; end if; return receipt.response_payload; end if;
 select * into preview from public.holding_reconciliation_previews where id=input_preview_id and user_id=current_user_id for update;
 if not found then raise exception 'Reconciliation preview was not found or is not accessible'; end if;
 if preview.consumed_at is not null then raise exception 'Reconciliation preview was already consumed'; end if;
 if preview.expires_at<=clock_timestamp() then raise exception 'Reconciliation preview expired'; end if;
 select * into holding from public.holdings where id=preview.holding_id and user_id=current_user_id for update;
 if holding.state_version<>preview.holding_state_version then raise exception 'Reconciliation preview is stale; create a new preview'; end if;
 select * into instrument from public.instruments where id=preview.instrument_id and user_id=current_user_id;
 if instrument.instrument_type='market' then update public.holdings set ledger_quantity=(preview.after_snapshot->>'quantity')::numeric,ledger_cost_pool=case when (preview.after_snapshot->>'quantity')::numeric=0 then 0 else (preview.after_snapshot->>'quantity')::numeric*(preview.after_snapshot->>'avg_price')::numeric end,ledger_checkpoint_at=clock_timestamp(),updated_at=clock_timestamp() where id=holding.id returning * into holding;
 elsif instrument.instrument_type='valuation' then update public.holdings set purchase_amount=(preview.after_snapshot->>'purchase_amount')::numeric,valuation_amount=(preview.after_snapshot->>'valuation_amount')::numeric,ledger_checkpoint_at=clock_timestamp(),updated_at=clock_timestamp() where id=holding.id returning * into holding;
 else update public.holdings set valuation_amount=(preview.after_snapshot->>'valuation_amount')::numeric,ledger_checkpoint_at=clock_timestamp(),updated_at=clock_timestamp() where id=holding.id returning * into holding; end if;
 insert into public.holding_reconciliations(user_id,holding_id,instrument_id,preview_id,before_snapshot,after_snapshot,reason,effective_on,holding_state_version,authored_via)
 values(current_user_id,holding.id,instrument.id,preview.id,preview.before_snapshot,preview.after_snapshot,preview.reason,preview.effective_on,holding.state_version,input_authored_via) returning * into saved;
 if cardinality(preview.confirmed_fields)>0 then insert into public.holding_verifications(user_id,holding_id,instrument_id,holding_state_version,verified_fields,value_snapshot,verified_on,note,source)
 values(current_user_id,holding.id,instrument.id,holding.state_version,preview.confirmed_fields,preview.after_snapshot,preview.effective_on,'보정과 함께 실제 잔고를 확인함','reconciliation') returning id into verification_id; end if;
 update public.holding_reconciliation_previews set consumed_at=clock_timestamp() where id=preview.id;
 insert into public.activity_events(user_id,source,action_type,target_table,target_id,before_data,after_data,status) values(current_user_id,case when input_authored_via='app' then 'user' else 'agent' end,'reconcile_holding','holding_reconciliations',saved.id::text,preview.before_snapshot,preview.after_snapshot,'succeeded');
 response:=jsonb_build_object('reconciliation_id',saved.id,'holding_id',holding.id,'holding_state_version',holding.state_version,'before',saved.before_snapshot,'after',saved.after_snapshot,'verification_id',verification_id);
 insert into public.holding_integrity_mutation_receipts values(current_user_id,input_idempotency_key,'reconcile',request,response,now()); return response;
end; $$;

create or replace function public.app_verify_holding(input_holding_id bigint,input_expected_version bigint,input_fields text[],input_verified_on date,input_note text,input_idempotency_key uuid,input_source text default 'app')
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_user_id uuid:=auth.uid(); holding public.holdings%rowtype; instrument public.instruments%rowtype; allowed text[]; field text; snapshot jsonb:='{}'; saved public.holding_verifications%rowtype; receipt public.holding_integrity_mutation_receipts%rowtype; request jsonb; response jsonb;
begin
 if current_user_id is null then raise exception 'Authentication required'; end if;
 if input_source not in ('app','agent') then raise exception 'Invalid verification source'; end if;
 if input_verified_on is null or input_verified_on>current_date then raise exception 'Verification date is required and cannot be in the future'; end if;
 select * into holding from public.holdings where id=input_holding_id and user_id=current_user_id for update; if not found then raise exception 'Holding was not found or is not accessible'; end if;
 if holding.state_version<>input_expected_version then raise exception 'Holding version conflict'; end if;
 select * into instrument from public.instruments where user_id=current_user_id and ticker=holding.ticker;
 allowed:=case instrument.instrument_type when 'market' then array['quantity','avg_price'] when 'valuation' then array['purchase_amount','valuation_amount'] when 'cash' then array['valuation_amount'] else '{}' end;
 if cardinality(coalesce(input_fields,'{}'))=0 then raise exception 'At least one verified field is required'; end if;
 foreach field in array input_fields loop if not field=any(allowed) then raise exception 'Verified field is invalid for this holding type'; end if;
  snapshot:=snapshot||case field when 'quantity' then jsonb_build_object(field,holding.ledger_quantity::text) when 'avg_price' then jsonb_build_object(field,case when holding.ledger_quantity=0 then null else (holding.ledger_cost_pool/holding.ledger_quantity)::text end) when 'purchase_amount' then jsonb_build_object(field,holding.purchase_amount::text) else jsonb_build_object(field,holding.valuation_amount::text) end;
 end loop;
 request:=jsonb_build_object('holding_id',input_holding_id,'expected_version',input_expected_version,'fields',input_fields,'verified_on',input_verified_on,'note',nullif(trim(coalesce(input_note,'')),''),'source',input_source);
 perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':verify:'||input_idempotency_key::text,0));
 select * into receipt from public.holding_integrity_mutation_receipts where user_id=current_user_id and idempotency_key=input_idempotency_key; if found then if receipt.operation<>'verify' or receipt.request_payload<>request then raise exception 'Idempotency key was already used with a different request'; end if; return receipt.response_payload; end if;
 insert into public.holding_verifications(user_id,holding_id,instrument_id,holding_state_version,verified_fields,value_snapshot,verified_on,note,source) values(current_user_id,holding.id,instrument.id,holding.state_version,input_fields,snapshot,input_verified_on,nullif(trim(coalesce(input_note,'')),''),input_source) returning * into saved;
 response:=jsonb_build_object('verification_id',saved.id,'holding_id',saved.holding_id,'holding_state_version',saved.holding_state_version,'verified_fields',saved.verified_fields,'value_snapshot',saved.value_snapshot,'verified_on',saved.verified_on,'created_at',saved.created_at);
 insert into public.holding_integrity_mutation_receipts values(current_user_id,input_idempotency_key,'verify',request,response,now()); return response;
end; $$;

create or replace function public.app_get_holding_integrity(input_holding_id bigint)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('holding_id',h.id,'state_version',h.state_version,'last_reconciliation',(select jsonb_build_object('id',r.id,'effective_on',r.effective_on,'reason',r.reason,'created_at',r.created_at) from public.holding_reconciliations r where r.user_id=auth.uid() and r.holding_id=h.id order by r.created_at desc limit 1),'last_verification',(select jsonb_build_object('id',v.id,'holding_state_version',v.holding_state_version,'verified_fields',v.verified_fields,'value_snapshot',v.value_snapshot,'verified_on',v.verified_on,'created_at',v.created_at,'changed_since',v.holding_state_version<>h.state_version) from public.holding_verifications v where v.user_id=auth.uid() and v.holding_id=h.id order by v.created_at desc limit 1)) from public.holdings h where h.id=input_holding_id and h.user_id=auth.uid();
$$;

grant select on public.holding_reconciliation_previews,public.holding_reconciliations,public.holding_verifications,public.holding_integrity_mutation_receipts to authenticated;
grant execute on function public.app_preview_holding_reconciliation(bigint,jsonb,text,date,text[]) to authenticated;
grant execute on function public.app_reconcile_holding(uuid,uuid,text) to authenticated;
grant execute on function public.app_verify_holding(bigint,bigint,text[],date,text,uuid,text) to authenticated;
grant execute on function public.app_get_holding_integrity(bigint) to authenticated;
