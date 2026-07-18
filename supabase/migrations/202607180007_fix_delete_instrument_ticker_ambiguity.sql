create or replace function public.app_delete_instrument(
    input_instrument_id bigint,
    input_source text default 'user',
    input_request text default null
)
returns table (
    instrument_id bigint,
    ticker text,
    display_name text,
    currency text,
    instrument_type text,
    activity_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_source text := coalesce(nullif(trim(input_source), ''), 'user');
    before_row jsonb;
    target_ticker text;
    event_id bigint;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;
    if normalized_source not in ('user', 'agent') then
        raise exception 'Invalid activity source';
    end if;
    if input_instrument_id is null then
        raise exception 'Instrument id is required';
    end if;

    select to_jsonb(i), i.ticker
    into before_row, target_ticker
    from public.instruments i
    where i.id = input_instrument_id
      and i.user_id = current_user_id;

    if before_row is null then
        raise exception 'Instrument not found';
    end if;
    if exists (
        select 1 from public.holdings h
        where h.user_id = current_user_id and h.ticker = target_ticker
    ) then
        raise exception 'Instrument has linked holdings';
    end if;

    delete from public.instrument_tags it
    where it.user_id = current_user_id and it.ticker = target_ticker;
    delete from public.holding_prices_daily hp
    where hp.user_id = current_user_id and hp.ticker = target_ticker;
    delete from public.instruments i
    where i.id = input_instrument_id and i.user_id = current_user_id;

    insert into public.activity_events (
        user_id, source, action_type, natural_language_request, target_table, target_id, before_data, after_data, status
    ) values (
        current_user_id, normalized_source, 'delete_instrument', nullif(trim(coalesce(input_request, '')), ''),
        'instruments', input_instrument_id::text, before_row, null, 'succeeded'
    ) returning id into event_id;

    return query select
        (before_row ->> 'id')::bigint,
        before_row ->> 'ticker',
        before_row ->> 'display_name',
        before_row ->> 'currency',
        before_row ->> 'instrument_type',
        event_id;
end;
$$;
