create table public.entity_note_mutation_receipts (
    user_id uuid not null references auth.users(id) on delete cascade,
    idempotency_key uuid not null,
    request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
    response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
    created_at timestamptz not null default now(),
    primary key (user_id, idempotency_key)
);

alter table public.holding_verifications alter column created_at set default clock_timestamp();

alter table public.entity_note_mutation_receipts enable row level security;
create policy entity_note_mutation_receipts_select_own
    on public.entity_note_mutation_receipts for select to authenticated
    using ((select auth.uid()) = user_id);

revoke all on public.entity_note_mutation_receipts from public, anon, authenticated;
grant select on public.entity_note_mutation_receipts to authenticated;

create or replace function public.app_update_entity_note(
    input_entity_type text,
    input_entity_id bigint,
    input_expected_note text,
    input_note text,
    input_idempotency_key uuid,
    input_source text default 'app'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_expected text := nullif(trim(coalesce(input_expected_note, '')), '');
    normalized_note text := nullif(trim(coalesce(input_note, '')), '');
    current_note text;
    request jsonb;
    response jsonb;
    receipt public.entity_note_mutation_receipts%rowtype;
    target_table text;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_source not in ('app', 'agent') then raise exception 'Invalid note source'; end if;
    if input_entity_type not in ('account', 'instrument', 'holding') then raise exception 'Invalid note entity type'; end if;
    if input_entity_id is null or input_entity_id <= 0 then raise exception 'Entity id must be positive'; end if;
    if normalized_note is not null and char_length(normalized_note) > 4000 then raise exception 'Entity note is too long'; end if;

    request := jsonb_build_object(
        'entity_type', input_entity_type,
        'entity_id', input_entity_id,
        'expected_note', normalized_expected,
        'note', normalized_note,
        'source', input_source
    );

    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':entity-note:' || input_idempotency_key::text, 0));
    select * into receipt
    from public.entity_note_mutation_receipts
    where user_id = current_user_id and idempotency_key = input_idempotency_key;
    if found then
        if receipt.request_payload <> request then raise exception 'Idempotency key was already used with a different request'; end if;
        return receipt.response_payload;
    end if;

    if input_entity_type = 'account' then
        select note into current_note from public.accounts where id = input_entity_id and user_id = current_user_id for update;
        target_table := 'accounts';
    elsif input_entity_type = 'instrument' then
        select note into current_note from public.instruments where id = input_entity_id and user_id = current_user_id for update;
        target_table := 'instruments';
    else
        select note into current_note from public.holdings where id = input_entity_id and user_id = current_user_id for update;
        target_table := 'holdings';
    end if;
    if not found then raise exception 'Entity was not found or is not accessible'; end if;
    current_note := nullif(trim(coalesce(current_note, '')), '');
    if current_note is distinct from normalized_expected then raise exception 'Entity note conflict'; end if;

    if input_entity_type = 'account' then update public.accounts set note = normalized_note where id = input_entity_id and user_id = current_user_id;
    elsif input_entity_type = 'instrument' then update public.instruments set note = normalized_note where id = input_entity_id and user_id = current_user_id;
    else update public.holdings set note = normalized_note where id = input_entity_id and user_id = current_user_id;
    end if;

    response := jsonb_build_object('entity_type', input_entity_type, 'entity_id', input_entity_id, 'note', normalized_note);
    insert into public.activity_events(user_id, source, action_type, target_table, target_id, before_data, after_data, status)
    values(current_user_id, case when input_source = 'app' then 'user' else 'agent' end, 'update_entity_note', target_table,
        input_entity_id::text, jsonb_build_object('note', current_note), jsonb_build_object('note', normalized_note), 'succeeded');
    insert into public.entity_note_mutation_receipts(user_id, idempotency_key, request_payload, response_payload)
    values(current_user_id, input_idempotency_key, request, response);
    return response;
end;
$$;

create or replace function public.app_get_holding_integrity(input_holding_id bigint)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('holding_id',h.id,'state_version',h.state_version,'last_reconciliation',(select jsonb_build_object('id',r.id,'effective_on',r.effective_on,'reason',r.reason,'created_at',r.created_at) from public.holding_reconciliations r where r.user_id=auth.uid() and r.holding_id=h.id order by r.created_at desc,r.id desc limit 1),'last_verification',(select jsonb_build_object('id',v.id,'holding_state_version',v.holding_state_version,'verified_fields',v.verified_fields,'value_snapshot',v.value_snapshot,'verified_on',v.verified_on,'note',v.note,'source',v.source,'created_at',v.created_at,'changed_since',v.holding_state_version<>h.state_version) from public.holding_verifications v where v.user_id=auth.uid() and v.holding_id=h.id order by v.created_at desc,v.id desc limit 1)) from public.holdings h where h.id=input_holding_id and h.user_id=auth.uid();
$$;

create or replace function public.app_verify_holding(
    input_holding_id bigint,
    input_expected_version bigint,
    input_fields text[],
    input_verified_on date,
    input_note text,
    input_idempotency_key uuid,
    input_source text default 'app'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_user_id uuid:=auth.uid(); holding public.holdings%rowtype; instrument public.instruments%rowtype; allowed text[]; field text; snapshot jsonb:='{}'; saved public.holding_verifications%rowtype; receipt public.holding_integrity_mutation_receipts%rowtype; request jsonb; response jsonb;
begin
 if current_user_id is null then raise exception 'Authentication required'; end if; if input_source not in ('app','agent') then raise exception 'Invalid verification source'; end if; if input_verified_on is null or input_verified_on>current_date then raise exception 'Verification date is required and cannot be in the future'; end if;
 request:=jsonb_build_object('holding_id',input_holding_id,'expected_version',input_expected_version,'fields',input_fields,'verified_on',input_verified_on,'note',nullif(trim(coalesce(input_note,'')),''),'source',input_source);
 perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':verify:'||input_idempotency_key::text,0)); select * into receipt from public.holding_integrity_mutation_receipts where user_id=current_user_id and idempotency_key=input_idempotency_key;
 if found then if receipt.operation<>'verify' or receipt.request_payload<>request then raise exception 'Idempotency key was already used with a different request'; end if; return receipt.response_payload; end if;
 select * into holding from public.holdings where id=input_holding_id and user_id=current_user_id for update; if not found then raise exception 'Holding was not found or is not accessible'; end if; if holding.state_version<>input_expected_version then raise exception 'Holding version conflict'; end if;
 select * into instrument from public.instruments where user_id=current_user_id and ticker=holding.ticker; allowed:=case instrument.instrument_type when 'market' then array['quantity','avg_price'] when 'valuation' then array['purchase_amount','valuation_amount'] when 'cash' then array['valuation_amount'] else '{}' end;
 if cardinality(coalesce(input_fields,'{}'))=0 then raise exception 'At least one verified field is required'; end if; foreach field in array input_fields loop if not field=any(allowed) then raise exception 'Verified field is invalid for this holding type'; end if; snapshot:=snapshot||case field when 'quantity' then jsonb_build_object(field,holding.ledger_quantity::text) when 'avg_price' then jsonb_build_object(field,case when holding.ledger_quantity=0 then null else (holding.ledger_cost_pool/holding.ledger_quantity)::text end) when 'purchase_amount' then jsonb_build_object(field,holding.purchase_amount::text) else jsonb_build_object(field,holding.valuation_amount::text) end; end loop;
 insert into public.holding_verifications(user_id,holding_id,instrument_id,holding_state_version,verified_fields,value_snapshot,verified_on,note,source) values(current_user_id,holding.id,instrument.id,holding.state_version,input_fields,snapshot,input_verified_on,nullif(trim(coalesce(input_note,'')),''),input_source) returning * into saved;
 response:=jsonb_build_object('verification_id',saved.id,'holding_id',saved.holding_id,'holding_state_version',saved.holding_state_version,'verified_fields',saved.verified_fields,'value_snapshot',saved.value_snapshot,'verified_on',saved.verified_on,'note',saved.note,'source',saved.source,'created_at',saved.created_at);
 insert into public.holding_integrity_mutation_receipts values(current_user_id,input_idempotency_key,'verify',request,response,now()); return response;
end; $$;

revoke all on function public.app_update_entity_note(text,bigint,text,text,uuid,text) from public, anon;
grant execute on function public.app_update_entity_note(text,bigint,text,text,uuid,text) to authenticated;
revoke all on function public.app_get_holding_integrity(bigint) from public, anon;
grant execute on function public.app_get_holding_integrity(bigint) to authenticated;
revoke all on function public.app_verify_holding(bigint,bigint,text[],date,text,uuid,text) from public, anon;
grant execute on function public.app_verify_holding(bigint,bigint,text[],date,text,uuid,text) to authenticated;
