create or replace function public.mcp_adopt_agent_token(input_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    resolved_user_id uuid;
begin
    resolved_user_id := public.mcp_touch_agent_token(input_token_hash);
    perform set_config('request.jwt.claim.sub', resolved_user_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    return resolved_user_id;
end;
$$;

create or replace function public.mcp_save_account(
    input_token_hash text,
    input_account_id bigint default null,
    input_name text default null,
    input_broker text default null,
    input_note text default null,
    input_request text default null
)
returns table (
    account_id bigint,
    name text,
    broker text,
    note text,
    is_active boolean,
    activity_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return query
    select *
    from public.app_save_account(
        input_account_id,
        input_name,
        input_broker,
        input_note,
        'agent',
        input_request
    );
end;
$$;

create or replace function public.mcp_delete_account(
    input_token_hash text,
    input_account_id bigint,
    input_request text default null
)
returns table (
    account_id bigint,
    name text,
    broker text,
    note text,
    is_active boolean,
    activity_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return query
    select *
    from public.app_delete_account(input_account_id, 'agent', input_request);
end;
$$;

create or replace function public.mcp_save_instrument(
    input_token_hash text,
    input_instrument_id bigint default null,
    input_ticker text default null,
    input_display_name text default null,
    input_currency text default 'KRW',
    input_instrument_type text default 'etf',
    input_price numeric default null,
    input_price_date date default null,
    input_tag_id bigint default null,
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
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return query
    select *
    from public.app_save_instrument(
        input_instrument_id,
        input_ticker,
        input_display_name,
        input_currency,
        input_instrument_type,
        input_price,
        input_price_date,
        input_tag_id,
        'agent',
        input_request,
        input_price_source,
        input_note
    );
end;
$$;

create or replace function public.mcp_delete_instrument(
    input_token_hash text,
    input_instrument_id bigint,
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
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return query
    select *
    from public.app_delete_instrument(input_instrument_id, 'agent', input_request);
end;
$$;

create or replace function public.mcp_save_holding(
    input_token_hash text,
    input_holding_id bigint default null,
    input_account_id bigint default null,
    input_ticker text default null,
    input_quantity numeric default null,
    input_avg_price numeric default null,
    input_note text default null,
    input_request text default null
)
returns table (
    holding_id bigint,
    account_id bigint,
    account_name text,
    ticker text,
    display_name text,
    quantity numeric,
    avg_price numeric,
    note text,
    activity_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return query
    select *
    from public.app_save_holding(
        input_holding_id,
        input_account_id,
        input_ticker,
        input_quantity,
        input_avg_price,
        input_note,
        'agent',
        input_request
    );
end;
$$;

create or replace function public.mcp_delete_holding(
    input_token_hash text,
    input_holding_id bigint,
    input_request text default null
)
returns table (
    holding_id bigint,
    account_id bigint,
    account_name text,
    ticker text,
    display_name text,
    quantity numeric,
    avg_price numeric,
    note text,
    activity_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return query
    select *
    from public.app_delete_holding(input_holding_id, 'agent', input_request);
end;
$$;

create or replace function public.mcp_save_tag(
    input_token_hash text,
    input_tag_id bigint default null,
    input_name text default null,
    input_color text default 'neutral',
    input_sort_order integer default 0,
    input_request text default null
)
returns table (
    tag_id bigint,
    name text,
    color text,
    sort_order integer,
    activity_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return query
    select *
    from public.app_save_tag(
        input_tag_id,
        input_name,
        input_color,
        input_sort_order,
        'agent',
        input_request
    );
end;
$$;

create or replace function public.mcp_get_price_sync_targets(
    input_token_hash text,
    input_tickers text[] default null
)
returns table (
    ticker text,
    source_symbol text,
    first_price_date date,
    last_price_date date
)
language sql
security definer
set search_path = public
as $$
    with current_user_ctx as (
        select public.mcp_touch_agent_token(input_token_hash) as user_id
    ),
    requested_tickers as (
        select distinct upper(trim(value)) as ticker
        from unnest(coalesce(input_tickers, array[]::text[])) as value
        where nullif(trim(value), '') is not null
    ),
    holding_tickers as (
        select distinct h.ticker
        from public.holdings h
        join current_user_ctx ctx
          on ctx.user_id = h.user_id
        where not exists (select 1 from requested_tickers)
           or h.ticker in (select rt.ticker from requested_tickers rt)
    ),
    fx_tickers as (
        select distinct i.ticker
        from public.instruments i
        join current_user_ctx ctx
          on ctx.user_id = i.user_id
        where i.instrument_type = 'fx'
          and (
            not exists (select 1 from requested_tickers)
            or i.ticker in (select rt.ticker from requested_tickers rt)
          )
    ),
    target_tickers as (
        select ticker from holding_tickers
        union
        select ticker from fx_tickers
        union
        select ticker from requested_tickers
    )
    select
        tt.ticker,
        i.source_symbol,
        min(hpd.price_date) as first_price_date,
        max(hpd.price_date) filter (where hpd.source <> 'holiday') as last_price_date
    from target_tickers tt
    join current_user_ctx ctx on true
    left join public.instruments i
      on i.user_id = ctx.user_id
     and i.ticker = tt.ticker
    left join public.holding_prices_daily hpd
      on hpd.user_id = ctx.user_id
     and hpd.ticker = tt.ticker
    group by tt.ticker, i.source_symbol
    order by tt.ticker;
$$;

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

    if normalized_ticker = '' then
        raise exception 'Ticker is required';
    end if;

    insert into public.holding_prices_daily (
        user_id,
        ticker,
        price_date,
        close_price,
        source
    )
    select
        resolved_user_id,
        normalized_ticker,
        (row_data ->> 'date')::date,
        (row_data ->> 'close')::numeric,
        'yfinance'
    from jsonb_array_elements(coalesce(input_prices, '[]'::jsonb)) as row_data
    where nullif(row_data ->> 'date', '') is not null
      and nullif(row_data ->> 'close', '') is not null
    on conflict on constraint holding_prices_daily_user_id_ticker_price_date_key do update
    set close_price = excluded.close_price,
        source = excluded.source;

    get diagnostics affected_count = row_count;

    insert into public.holding_prices_daily (
        user_id,
        ticker,
        price_date,
        close_price,
        source
    )
    select
        resolved_user_id,
        normalized_ticker,
        (row_data ->> 'date')::date,
        null,
        'holiday'
    from jsonb_array_elements(coalesce(input_holidays, '[]'::jsonb)) as row_data
    where nullif(row_data ->> 'date', '') is not null
    on conflict on constraint holding_prices_daily_user_id_ticker_price_date_key do nothing;

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
begin
    resolved_user_id := public.mcp_touch_agent_token(input_token_hash);

    insert into public.sync_runs (
        user_id,
        total_count,
        synced_count,
        failed_count,
        failed,
        started_by
    )
    values (
        resolved_user_id,
        coalesce(input_total_count, 0),
        coalesce(input_synced_count, 0),
        jsonb_array_length(coalesce(input_failed, '[]'::jsonb)),
        coalesce(input_failed, '[]'::jsonb),
        'agent'
    )
    returning id into saved_sync_run_id;

    insert into public.activity_events (
        user_id,
        source,
        action_type,
        target_table,
        target_id,
        after_data,
        status
    )
    values (
        resolved_user_id,
        'agent',
        'sync_prices',
        'holding_prices_daily',
        saved_sync_run_id::text,
        jsonb_build_object(
            'total_count', coalesce(input_total_count, 0),
            'synced_count', coalesce(input_synced_count, 0),
            'failed_count', jsonb_array_length(coalesce(input_failed, '[]'::jsonb))
        ),
        case when jsonb_array_length(coalesce(input_failed, '[]'::jsonb)) > 0 then 'partial' else 'succeeded' end
    );

    return saved_sync_run_id;
end;
$$;

grant execute on function public.mcp_adopt_agent_token(text) to anon, authenticated;
grant execute on function public.mcp_save_account(text, bigint, text, text, text, text) to anon, authenticated;
grant execute on function public.mcp_delete_account(text, bigint, text) to anon, authenticated;
grant execute on function public.mcp_save_instrument(text, bigint, text, text, text, text, numeric, date, bigint, text, text, text) to anon, authenticated;
grant execute on function public.mcp_delete_instrument(text, bigint, text) to anon, authenticated;
grant execute on function public.mcp_save_holding(text, bigint, bigint, text, numeric, numeric, text, text) to anon, authenticated;
grant execute on function public.mcp_delete_holding(text, bigint, text) to anon, authenticated;
grant execute on function public.mcp_save_tag(text, bigint, text, text, integer, text) to anon, authenticated;
grant execute on function public.mcp_get_price_sync_targets(text, text[]) to anon, authenticated;
grant execute on function public.mcp_upsert_price_rows(text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.mcp_record_sync_run(text, integer, integer, jsonb) to anon, authenticated;
