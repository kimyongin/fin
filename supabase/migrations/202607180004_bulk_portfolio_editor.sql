create or replace function public.app_bulk_save_portfolio_rows(
    input_rows jsonb default '[]'::jsonb
)
returns table (
    account_count integer,
    instrument_count integer,
    holding_count integer,
    activity_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    input_row jsonb;
    existing_holding jsonb;
    normalized_account_name text;
    normalized_ticker text;
    normalized_display_name text;
    normalized_currency text;
    normalized_instrument_type text;
    resolved_account_id bigint;
    resolved_instrument_id bigint;
    resolved_tag_id bigint;
    saved_holding_id bigint;
    created_account_count integer := 0;
    created_instrument_count integer := 0;
    saved_holding_count integer := 0;
    saved_activity_id bigint;
    before_rows jsonb := '[]'::jsonb;
    after_rows jsonb := '[]'::jsonb;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    if jsonb_typeof(input_rows) <> 'array' or jsonb_array_length(input_rows) = 0 then
        raise exception 'At least one portfolio row is required';
    end if;

    if jsonb_array_length(input_rows) > 200 then
        raise exception 'A maximum of 200 rows can be saved at once';
    end if;

    for input_row in select value from jsonb_array_elements(input_rows)
    loop
        normalized_account_name := trim(coalesce(input_row ->> 'account_name', ''));
        normalized_ticker := upper(trim(coalesce(input_row ->> 'ticker', '')));
        normalized_display_name := trim(coalesce(input_row ->> 'display_name', ''));
        normalized_currency := upper(trim(coalesce(input_row ->> 'currency', 'KRW')));
        normalized_instrument_type := lower(trim(coalesce(input_row ->> 'instrument_type', 'etf')));

        if normalized_account_name = '' then
            raise exception 'Account name is required';
        end if;
        if normalized_ticker = '' then
            raise exception 'Ticker is required';
        end if;
        if normalized_display_name = '' then
            raise exception 'Display name is required';
        end if;
        if normalized_currency not in ('KRW', 'USD', 'JPY') then
            raise exception 'Currency must be KRW, USD, or JPY';
        end if;
        if normalized_instrument_type not in ('stock', 'etf', 'fund', 'cash', 'other', 'fx') then
            raise exception 'Invalid instrument type';
        end if;
        if coalesce((input_row ->> 'quantity')::numeric, -1) < 0 then
            raise exception 'Quantity must be zero or greater';
        end if;
        if coalesce((input_row ->> 'avg_price')::numeric, -1) < 0 then
            raise exception 'Average price must be zero or greater';
        end if;

        select a.id into resolved_account_id
        from public.accounts a
        where a.user_id = current_user_id
          and lower(a.name) = lower(normalized_account_name)
        order by a.id
        limit 1;

        if resolved_account_id is null then
            insert into public.accounts (user_id, name, broker, is_active)
            values (
                current_user_id,
                normalized_account_name,
                nullif(trim(coalesce(input_row ->> 'broker', '')), ''),
                true
            )
            returning id into resolved_account_id;
            created_account_count := created_account_count + 1;
        else
            update public.accounts
            set broker = nullif(trim(coalesce(input_row ->> 'broker', '')), ''),
                is_active = true
            where id = resolved_account_id
              and user_id = current_user_id;
        end if;

        resolved_tag_id := nullif(input_row ->> 'tag_id', '')::bigint;
        if resolved_tag_id is not null and not exists (
            select 1 from public.tags t where t.id = resolved_tag_id and t.user_id = current_user_id
        ) then
            raise exception 'Tag not found';
        end if;

        select i.id into resolved_instrument_id
        from public.instruments i
        where i.user_id = current_user_id and i.ticker = normalized_ticker;

        if resolved_instrument_id is null then
            insert into public.instruments (user_id, ticker, display_name, currency, instrument_type, price_source)
            values (current_user_id, normalized_ticker, normalized_display_name, normalized_currency, normalized_instrument_type, 'manual')
            returning id into resolved_instrument_id;
            created_instrument_count := created_instrument_count + 1;
        else
            update public.instruments
            set display_name = normalized_display_name,
                currency = normalized_currency,
                instrument_type = normalized_instrument_type
            where id = resolved_instrument_id and user_id = current_user_id;
        end if;

        delete from public.instrument_tags
        where user_id = current_user_id and ticker = normalized_ticker;
        if resolved_tag_id is not null then
            insert into public.instrument_tags (user_id, ticker, tag_id)
            values (current_user_id, normalized_ticker, resolved_tag_id);
        end if;

        select coalesce(to_jsonb(h), '{}'::jsonb) into existing_holding
        from public.holdings h
        where h.user_id = current_user_id
          and h.account_id = resolved_account_id
          and h.ticker = normalized_ticker;
        if existing_holding <> '{}'::jsonb then
            before_rows := before_rows || jsonb_build_array(existing_holding);
        end if;

        insert into public.holdings (user_id, account_id, ticker, quantity, avg_price, note)
        values (
            current_user_id,
            resolved_account_id,
            normalized_ticker,
            (input_row ->> 'quantity')::numeric,
            (input_row ->> 'avg_price')::numeric,
            nullif(trim(coalesce(input_row ->> 'note', '')), '')
        )
        on conflict on constraint holdings_account_id_ticker_key do update
        set quantity = excluded.quantity,
            avg_price = excluded.avg_price,
            note = excluded.note
        returning id into saved_holding_id;

        select to_jsonb(h) into existing_holding
        from public.holdings h
        where h.id = saved_holding_id and h.user_id = current_user_id;
        after_rows := after_rows || jsonb_build_array(existing_holding);
        saved_holding_count := saved_holding_count + 1;
    end loop;

    insert into public.activity_events (
        user_id, source, action_type, target_table, target_id, before_data, after_data, status
    ) values (
        current_user_id,
        'user',
        'bulk_edit_portfolio',
        'portfolio',
        null,
        jsonb_build_object('holdings', before_rows),
        jsonb_build_object('holdings', after_rows, 'row_count', saved_holding_count),
        'succeeded'
    ) returning id into saved_activity_id;

    return query select created_account_count, created_instrument_count, saved_holding_count, saved_activity_id;
end;
$$;

grant execute on function public.app_bulk_save_portfolio_rows(jsonb) to authenticated;
