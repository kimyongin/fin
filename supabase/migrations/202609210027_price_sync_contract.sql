create or replace function public.app_get_price_sync_targets(input_tickers text[] default null)
returns table (
    ticker text,
    source_symbol text,
    last_price_date date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    return query
    with requested_tickers as (
        select distinct upper(trim(value)) as ticker
        from unnest(coalesce(input_tickers, array[]::text[])) as value
        where nullif(trim(value), '') is not null
    ),
    eligible_tickers as (
        select distinct h.ticker
        from public.holdings h
        join public.instruments i
          on i.user_id = h.user_id
         and i.ticker = h.ticker
         and i.instrument_type = 'market'
        where h.user_id = current_user_id
          and (
            not exists (select 1 from requested_tickers)
            or h.ticker in (select rt.ticker from requested_tickers rt)
          )
        union
        select i.ticker
        from public.instruments i
        where i.user_id = current_user_id
          and i.instrument_type = 'fx'
          and (
            not exists (select 1 from requested_tickers)
            or i.ticker in (select rt.ticker from requested_tickers rt)
          )
    )
    select
        i.ticker,
        i.source_symbol,
        max(hpd.price_date) as last_price_date
    from eligible_tickers et
    join public.instruments i
      on i.user_id = current_user_id
     and i.ticker = et.ticker
    left join public.holding_prices_daily hpd
      on hpd.user_id = current_user_id
     and hpd.ticker = et.ticker
    group by i.ticker, i.source_symbol
    order by i.ticker;
end;
$$;

create or replace function public.app_upsert_price_rows(
    input_ticker text,
    input_source_symbol text,
    input_prices jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_ticker text := upper(trim(coalesce(input_ticker, '')));
    normalized_source_symbol text := upper(trim(coalesce(input_source_symbol, '')));
    normalized_prices jsonb := coalesce(input_prices, '[]'::jsonb);
    affected_count integer := 0;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;
    if normalized_ticker = '' then
        raise exception 'Ticker is required';
    end if;
    if jsonb_typeof(normalized_prices) <> 'array' then
        raise exception 'Prices must be an array';
    end if;
    if jsonb_array_length(normalized_prices) > 400 then
        raise exception 'Too many price rows';
    end if;
    if not exists (
        select 1
        from public.instruments i
        where i.user_id = current_user_id
          and i.ticker = normalized_ticker
          and i.instrument_type in ('market', 'fx')
    ) then
        raise exception 'Market or FX instrument not found';
    end if;
    if exists (
        select 1
        from jsonb_array_elements(normalized_prices) row_data
        where nullif(row_data ->> 'date', '') is null
           or nullif(row_data ->> 'close', '') is null
           or (row_data ->> 'close')::numeric <= 0
    ) then
        raise exception 'Every price row requires a date and a positive close';
    end if;

    if normalized_source_symbol <> '' then
        update public.instruments i
        set source_symbol = normalized_source_symbol
        where i.user_id = current_user_id
          and i.ticker = normalized_ticker
          and i.source_symbol is distinct from normalized_source_symbol;
    end if;

    insert into public.holding_prices_daily (user_id, ticker, price_date, close_price, source)
    select
        current_user_id,
        normalized_ticker,
        (row_data ->> 'date')::date,
        (row_data ->> 'close')::numeric,
        'yfinance'
    from jsonb_array_elements(normalized_prices) row_data
    on conflict on constraint holding_prices_daily_user_id_ticker_price_date_key do update
    set close_price = excluded.close_price,
        source = excluded.source;

    get diagnostics affected_count = row_count;
    return affected_count;
end;
$$;

create or replace function public.app_record_price_sync_run(
    input_total_count integer,
    input_synced_count integer,
    input_failed jsonb default '[]'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_failed jsonb := coalesce(input_failed, '[]'::jsonb);
    failed_count integer;
    saved_sync_run_id bigint;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;
    if jsonb_typeof(normalized_failed) <> 'array' then
        raise exception 'Failed results must be an array';
    end if;

    failed_count := jsonb_array_length(normalized_failed);
    if coalesce(input_total_count, -1) < 0
       or coalesce(input_synced_count, -1) < 0
       or input_synced_count + failed_count <> input_total_count then
        raise exception 'Invalid price sync counts';
    end if;

    insert into public.sync_runs (user_id, total_count, synced_count, failed_count, failed, started_by)
    values (current_user_id, input_total_count, input_synced_count, failed_count, normalized_failed, 'web')
    returning id into saved_sync_run_id;

    insert into public.activity_events (
        user_id, source, action_type, target_table, target_id, after_data, status, error_message
    )
    values (
        current_user_id,
        'user',
        'sync_prices',
        'holding_prices_daily',
        saved_sync_run_id::text,
        jsonb_build_object(
            'total_count', input_total_count,
            'synced_count', input_synced_count,
            'failed_count', failed_count
        ),
        case when input_synced_count = 0 and failed_count > 0 then 'failed' else 'succeeded' end,
        case when input_synced_count = 0 and failed_count > 0 then 'All price targets failed' else null end
    );

    return saved_sync_run_id;
end;
$$;

revoke all on function public.app_get_price_sync_targets(text[]) from public;
revoke all on function public.app_upsert_price_rows(text, text, jsonb) from public;
revoke all on function public.app_record_price_sync_run(integer, integer, jsonb) from public;
grant execute on function public.app_get_price_sync_targets(text[]) to authenticated;
grant execute on function public.app_upsert_price_rows(text, text, jsonb) to authenticated;
grant execute on function public.app_record_price_sync_run(integer, integer, jsonb) to authenticated;

create or replace function public.mcp_upsert_price_rows(
    input_token_hash text,
    input_ticker text,
    input_prices jsonb default '[]'::jsonb,
    input_holidays jsonb default '[]'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    resolved_user_id uuid;
    normalized_ticker text := upper(trim(coalesce(input_ticker, '')));
    affected_count integer := 0;
begin
    resolved_user_id := public.mcp_touch_agent_token(input_token_hash);
    if normalized_ticker = '' then raise exception 'Ticker is required'; end if;

    insert into public.holding_prices_daily (user_id, ticker, price_date, close_price, source)
    select resolved_user_id, normalized_ticker, (row_data ->> 'date')::date,
        (row_data ->> 'close')::numeric, 'yfinance'
    from jsonb_array_elements(coalesce(input_prices, '[]'::jsonb)) row_data
    where nullif(row_data ->> 'date', '') is not null
      and nullif(row_data ->> 'close', '') is not null
      and (row_data ->> 'close')::numeric > 0
    on conflict on constraint holding_prices_daily_user_id_ticker_price_date_key do update
    set close_price = excluded.close_price, source = excluded.source;

    get diagnostics affected_count = row_count;
    return affected_count;
end;
$$;

create or replace function public.mcp_record_sync_run(
    input_token_hash text,
    input_total_count integer,
    input_synced_count integer,
    input_failed jsonb default '[]'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    resolved_user_id uuid;
    saved_sync_run_id bigint;
    failed_count integer := jsonb_array_length(coalesce(input_failed, '[]'::jsonb));
begin
    resolved_user_id := public.mcp_touch_agent_token(input_token_hash);
    insert into public.sync_runs (user_id, total_count, synced_count, failed_count, failed, started_by)
    values (resolved_user_id, coalesce(input_total_count, 0), coalesce(input_synced_count, 0),
        failed_count, coalesce(input_failed, '[]'::jsonb), 'agent')
    returning id into saved_sync_run_id;

    insert into public.activity_events (
        user_id, source, action_type, target_table, target_id, after_data, status, error_message
    )
    values (
        resolved_user_id, 'agent', 'sync_prices', 'holding_prices_daily', saved_sync_run_id::text,
        jsonb_build_object(
            'total_count', coalesce(input_total_count, 0),
            'synced_count', coalesce(input_synced_count, 0),
            'failed_count', failed_count
        ),
        case when coalesce(input_synced_count, 0) = 0 and failed_count > 0 then 'failed' else 'succeeded' end,
        case when coalesce(input_synced_count, 0) = 0 and failed_count > 0 then 'All price targets failed' else null end
    );

    return saved_sync_run_id;
end;
$$;
