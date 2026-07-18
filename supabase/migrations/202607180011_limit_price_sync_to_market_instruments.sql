create or replace function public.mcp_get_price_sync_targets(
    input_token_hash text,
    input_tickers text[] default null
)
returns table (ticker text, source_symbol text, first_price_date date, last_price_date date)
language sql security definer set search_path = public as $$
  with current_user_ctx as (select public.mcp_touch_agent_token(input_token_hash) as user_id),
  requested_tickers as (
    select distinct upper(trim(value)) as ticker from unnest(coalesce(input_tickers, array[]::text[])) as value
    where nullif(trim(value), '') is not null
  ),
  holding_tickers as (
    select distinct h.ticker from public.holdings h join current_user_ctx ctx on ctx.user_id = h.user_id
    join public.instruments i on i.user_id = h.user_id and i.ticker = h.ticker and i.instrument_type = 'market'
    where not exists (select 1 from requested_tickers) or h.ticker in (select ticker from requested_tickers)
  ),
  fx_tickers as (
    select distinct i.ticker from public.instruments i join current_user_ctx ctx on ctx.user_id = i.user_id
    where i.instrument_type = 'fx' and (not exists (select 1 from requested_tickers) or i.ticker in (select ticker from requested_tickers))
  ),
  target_tickers as (select ticker from holding_tickers union select ticker from fx_tickers union select ticker from requested_tickers)
  select tt.ticker, i.source_symbol, min(hpd.price_date) as first_price_date,
    max(hpd.price_date) filter (where hpd.source <> 'holiday') as last_price_date
  from target_tickers tt join current_user_ctx ctx on true
  left join public.instruments i on i.user_id = ctx.user_id and i.ticker = tt.ticker
  left join public.holding_prices_daily hpd on hpd.user_id = ctx.user_id and hpd.ticker = tt.ticker
  where i.instrument_type in ('market', 'fx')
  group by tt.ticker, i.source_symbol order by tt.ticker;
$$;
