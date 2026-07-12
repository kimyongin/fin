create or replace function public.app_save_instrument(
    input_instrument_id bigint default null,
    input_ticker text default null,
    input_display_name text default null,
    input_currency text default 'KRW',
    input_instrument_type text default 'etf',
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
    before_row jsonb;
    after_row jsonb;
    saved_instrument_id bigint;
    event_id bigint;
    activity_type text;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    if normalized_source not in ('user', 'agent') then
        raise exception 'Invalid activity source';
    end if;

    if normalized_ticker = '' then
        raise exception 'Ticker is required';
    end if;

    if nullif(trim(coalesce(input_display_name, '')), '') is null then
        raise exception 'Display name is required';
    end if;

    if input_price is not null and input_price <= 0 then
        raise exception 'Price must be greater than zero';
    end if;

    if input_tag_id is not null and not exists (
        select 1
        from public.tags t
        where t.id = input_tag_id
          and t.user_id = current_user_id
    ) then
        raise exception 'Tag not found';
    end if;

    if input_instrument_id is not null then
        select to_jsonb(row_data)
        into before_row
        from (
            select
                i.*,
                (
                    select it.tag_id
                    from public.instrument_tags it
                    where it.user_id = i.user_id
                      and it.ticker = i.ticker
                    limit 1
                ) as tag_id
            from public.instruments i
            where i.id = input_instrument_id
              and i.user_id = current_user_id
        ) row_data;

        if before_row is null then
            raise exception 'Instrument not found';
        end if;

        update public.instruments
        set display_name = trim(input_display_name),
            currency = coalesce(nullif(trim(input_currency), ''), 'KRW'),
            instrument_type = coalesce(nullif(trim(input_instrument_type), ''), 'etf'),
            price_source = 'yfinance',
            note = nullif(trim(coalesce(input_note, '')), '')
        where id = input_instrument_id
          and user_id = current_user_id
        returning id, ticker into saved_instrument_id, normalized_ticker;
    else
        select to_jsonb(row_data)
        into before_row
        from (
            select
                i.*,
                (
                    select it.tag_id
                    from public.instrument_tags it
                    where it.user_id = i.user_id
                      and it.ticker = i.ticker
                    limit 1
                ) as tag_id
            from public.instruments i
            where i.ticker = normalized_ticker
              and i.user_id = current_user_id
        ) row_data;

        if before_row is null then
            insert into public.instruments (
                user_id,
                ticker,
                display_name,
                currency,
                instrument_type,
                price_source,
                note
            )
            values (
                current_user_id,
                normalized_ticker,
                trim(input_display_name),
                coalesce(nullif(trim(input_currency), ''), 'KRW'),
                coalesce(nullif(trim(input_instrument_type), ''), 'etf'),
                'yfinance',
                nullif(trim(coalesce(input_note, '')), '')
            )
            returning id into saved_instrument_id;
        else
            update public.instruments i
            set display_name = trim(input_display_name),
                currency = coalesce(nullif(trim(input_currency), ''), 'KRW'),
                instrument_type = coalesce(nullif(trim(input_instrument_type), ''), 'etf'),
                price_source = 'yfinance',
                note = nullif(trim(coalesce(input_note, '')), '')
            where i.ticker = normalized_ticker
              and i.user_id = current_user_id
            returning id into saved_instrument_id;
        end if;
    end if;

    if input_price is not null then
        insert into public.holding_prices_daily (
            user_id,
            ticker,
            price_date,
            close_price,
            source
        )
        values (
            current_user_id,
            normalized_ticker,
            coalesce(input_price_date, current_date),
            input_price,
            coalesce(nullif(trim(input_price_source), ''), 'manual')
        )
        on conflict on constraint holding_prices_daily_user_id_ticker_price_date_key do update
        set close_price = excluded.close_price,
            source = excluded.source;
    end if;

    delete from public.instrument_tags it
    where it.user_id = current_user_id
      and it.ticker = normalized_ticker;

    if input_tag_id is not null then
        insert into public.instrument_tags (
            user_id,
            ticker,
            tag_id
        )
        values (
            current_user_id,
            normalized_ticker,
            input_tag_id
        );
    end if;

    select to_jsonb(row_data)
    into after_row
    from (
        select
            i.*,
            (
                select it.tag_id
                from public.instrument_tags it
                where it.user_id = i.user_id
                  and it.ticker = i.ticker
                limit 1
            ) as tag_id,
            input_price as manual_price,
            input_price_date as manual_price_date
        from public.instruments i
        where i.id = saved_instrument_id
          and i.user_id = current_user_id
    ) row_data;

    activity_type := case when before_row is null then 'create_instrument' else 'update_instrument' end;

    insert into public.activity_events (
        user_id,
        source,
        action_type,
        natural_language_request,
        target_table,
        target_id,
        before_data,
        after_data,
        status
    )
    values (
        current_user_id,
        normalized_source,
        activity_type,
        nullif(trim(coalesce(input_request, '')), ''),
        'instruments',
        saved_instrument_id::text,
        before_row,
        after_row,
        'succeeded'
    )
    returning id into event_id;

    return query
    select
        (after_row ->> 'id')::bigint,
        after_row ->> 'ticker',
        after_row ->> 'display_name',
        after_row ->> 'currency',
        after_row ->> 'instrument_type',
        event_id;
end;
$$;

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
        select 1
        from public.holdings h
        where h.user_id = current_user_id
          and h.ticker = target_ticker
    ) then
        raise exception 'Instrument has linked holdings';
    end if;

    delete from public.instrument_tags
    where user_id = current_user_id
      and ticker = target_ticker;

    delete from public.holding_prices_daily
    where user_id = current_user_id
      and ticker = target_ticker;

    delete from public.instruments
    where id = input_instrument_id
      and user_id = current_user_id;

    insert into public.activity_events (
        user_id,
        source,
        action_type,
        natural_language_request,
        target_table,
        target_id,
        before_data,
        after_data,
        status
    )
    values (
        current_user_id,
        normalized_source,
        'delete_instrument',
        nullif(trim(coalesce(input_request, '')), ''),
        'instruments',
        input_instrument_id::text,
        before_row,
        null,
        'succeeded'
    )
    returning id into event_id;

    return query
    select
        (before_row ->> 'id')::bigint,
        before_row ->> 'ticker',
        before_row ->> 'display_name',
        before_row ->> 'currency',
        before_row ->> 'instrument_type',
        event_id;
end;
$$;

grant execute on function public.app_save_instrument(bigint, text, text, text, text, numeric, date, bigint, text, text, text, text) to authenticated;
grant execute on function public.app_delete_instrument(bigint, text, text) to authenticated;
