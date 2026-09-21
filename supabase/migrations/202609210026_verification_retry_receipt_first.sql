create or replace function public.app_verify_holding(
    input_holding_id bigint,
    input_expected_version bigint,
    input_fields text[],
    input_verified_on date,
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
    holding public.holdings%rowtype;
    instrument public.instruments%rowtype;
    allowed text[];
    field text;
    snapshot jsonb := '{}';
    saved public.holding_verifications%rowtype;
    receipt public.holding_integrity_mutation_receipts%rowtype;
    request jsonb;
    response jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_source not in ('app', 'agent') then raise exception 'Invalid verification source'; end if;
    if input_verified_on is null or input_verified_on > current_date then
        raise exception 'Verification date is required and cannot be in the future';
    end if;

    request := jsonb_build_object(
        'holding_id', input_holding_id,
        'expected_version', input_expected_version,
        'fields', input_fields,
        'verified_on', input_verified_on,
        'note', nullif(trim(coalesce(input_note, '')), ''),
        'source', input_source
    );

    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':verify:' || input_idempotency_key::text, 0));
    select * into receipt
    from public.holding_integrity_mutation_receipts
    where user_id = current_user_id and idempotency_key = input_idempotency_key;
    if found then
        if receipt.operation <> 'verify' or receipt.request_payload <> request then
            raise exception 'Idempotency key was already used with a different request';
        end if;
        return receipt.response_payload;
    end if;

    select * into holding
    from public.holdings
    where id = input_holding_id and user_id = current_user_id
    for update;
    if not found then raise exception 'Holding was not found or is not accessible'; end if;
    if holding.state_version <> input_expected_version then raise exception 'Holding version conflict'; end if;

    select * into instrument
    from public.instruments
    where user_id = current_user_id and ticker = holding.ticker;
    allowed := case instrument.instrument_type
        when 'market' then array['quantity', 'avg_price']
        when 'valuation' then array['purchase_amount', 'valuation_amount']
        when 'cash' then array['valuation_amount']
        else '{}'
    end;
    if cardinality(coalesce(input_fields, '{}')) = 0 then raise exception 'At least one verified field is required'; end if;
    foreach field in array input_fields loop
        if not field = any(allowed) then raise exception 'Verified field is invalid for this holding type'; end if;
        snapshot := snapshot || case field
            when 'quantity' then jsonb_build_object(field, holding.ledger_quantity::text)
            when 'avg_price' then jsonb_build_object(field, case when holding.ledger_quantity = 0 then null else (holding.ledger_cost_pool / holding.ledger_quantity)::text end)
            when 'purchase_amount' then jsonb_build_object(field, holding.purchase_amount::text)
            else jsonb_build_object(field, holding.valuation_amount::text)
        end;
    end loop;

    insert into public.holding_verifications(
        user_id, holding_id, instrument_id, holding_state_version, verified_fields,
        value_snapshot, verified_on, note, source
    ) values (
        current_user_id, holding.id, instrument.id, holding.state_version, input_fields,
        snapshot, input_verified_on, nullif(trim(coalesce(input_note, '')), ''), input_source
    ) returning * into saved;

    response := jsonb_build_object(
        'verification_id', saved.id,
        'holding_id', saved.holding_id,
        'holding_state_version', saved.holding_state_version,
        'verified_fields', saved.verified_fields,
        'value_snapshot', saved.value_snapshot,
        'verified_on', saved.verified_on,
        'created_at', saved.created_at
    );
    insert into public.holding_integrity_mutation_receipts
    values(current_user_id, input_idempotency_key, 'verify', request, response, now());
    return response;
end;
$$;

