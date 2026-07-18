create or replace function public.app_save_instrument(
    input_instrument_id bigint default null,
    input_ticker text default null,
    input_display_name text default null,
    input_currency text default 'KRW',
    input_instrument_type text default 'market',
    input_price numeric default null,
    input_price_date date default null,
    input_tag_id bigint default null,
    input_source text default 'user',
    input_request text default null,
    input_price_source text default 'manual',
    input_note text default null
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
    normalized_ticker text := upper(trim(coalesce(input_ticker, '')));
    normalized_type text := case lower(trim(coalesce(input_instrument_type, 'market')))
        when 'valuation' then 'valuation'
        when 'cash' then 'cash'
        when 'fx' then 'fx'
        else 'market'
    end;
    before_row jsonb;
    after_row jsonb;
    saved_instrument_id bigint;
    event_id bigint;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if normalized_source not in ('user', 'agent') then raise exception 'Invalid activity source'; end if;
    if normalized_ticker = '' then raise exception 'Ticker is required'; end if;
    if nullif(trim(coalesce(input_display_name, '')), '') is null then raise exception 'Display name is required'; end if;
    if input_price is not null and input_price <= 0 then raise exception 'Price must be greater than zero'; end if;
    if input_tag_id is not null and not exists (select 1 from public.tags t where t.id = input_tag_id and t.user_id = current_user_id) then raise exception 'Tag not found'; end if;

    if input_instrument_id is not null then
        select to_jsonb(i) into before_row from public.instruments i where i.id = input_instrument_id and i.user_id = current_user_id;
        if before_row is null then raise exception 'Instrument not found'; end if;
        update public.instruments i
        set display_name = trim(input_display_name), currency = coalesce(nullif(trim(input_currency), ''), 'KRW'),
            instrument_type = normalized_type, price_source = coalesce(nullif(trim(input_price_source), ''), 'manual'),
            note = nullif(trim(coalesce(input_note, '')), '')
        where i.id = input_instrument_id and i.user_id = current_user_id
        returning i.id, i.ticker into saved_instrument_id, normalized_ticker;
    else
        select to_jsonb(i) into before_row from public.instruments i where i.user_id = current_user_id and i.ticker = normalized_ticker;
        if before_row is null then
            insert into public.instruments (user_id, ticker, display_name, currency, instrument_type, price_source, note)
            values (current_user_id, normalized_ticker, trim(input_display_name), coalesce(nullif(trim(input_currency), ''), 'KRW'), normalized_type, coalesce(nullif(trim(input_price_source), ''), 'manual'), nullif(trim(coalesce(input_note, '')), ''))
            returning id into saved_instrument_id;
        else
            update public.instruments i
            set display_name = trim(input_display_name), currency = coalesce(nullif(trim(input_currency), ''), 'KRW'),
                instrument_type = normalized_type, price_source = coalesce(nullif(trim(input_price_source), ''), 'manual'),
                note = nullif(trim(coalesce(input_note, '')), '')
            where i.user_id = current_user_id and i.ticker = normalized_ticker
            returning i.id into saved_instrument_id;
        end if;
    end if;

    if input_price is not null then
        insert into public.holding_prices_daily (user_id, ticker, price_date, close_price, source)
        values (current_user_id, normalized_ticker, coalesce(input_price_date, current_date), input_price, coalesce(nullif(trim(input_price_source), ''), 'manual'))
        on conflict on constraint holding_prices_daily_user_id_ticker_price_date_key do update
        set close_price = excluded.close_price, source = excluded.source;
    end if;

    delete from public.instrument_tags it where it.user_id = current_user_id and it.ticker = normalized_ticker;
    if input_tag_id is not null then
        insert into public.instrument_tags (user_id, ticker, tag_id) values (current_user_id, normalized_ticker, input_tag_id);
    end if;

    select to_jsonb(i) into after_row from public.instruments i where i.id = saved_instrument_id and i.user_id = current_user_id;
    insert into public.activity_events (user_id, source, action_type, natural_language_request, target_table, target_id, before_data, after_data, status)
    values (current_user_id, normalized_source, case when before_row is null then 'create_instrument' else 'update_instrument' end,
        nullif(trim(coalesce(input_request, '')), ''), 'instruments', saved_instrument_id::text, before_row, after_row, 'succeeded')
    returning id into event_id;

    return query select (after_row ->> 'id')::bigint, after_row ->> 'ticker', after_row ->> 'display_name', after_row ->> 'currency', after_row ->> 'instrument_type', event_id;
end;
$$;
