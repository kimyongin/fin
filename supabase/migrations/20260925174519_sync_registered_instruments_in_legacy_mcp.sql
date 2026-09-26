-- The compatibility MCP endpoint uses a token instead of auth.uid(), but has the same scope.
create or replace function public.mcp_get_price_sync_targets(
  input_token_hash text, input_tickers text[] default null
) returns table (ticker text, source_symbol text, first_price_date date, last_price_date date)
language sql security definer set search_path = public as $$
  with owner_ctx as (select public.mcp_touch_agent_token(input_token_hash) as user_id),
  requested as (
    select distinct upper(trim(value)) as ticker
    from unnest(coalesce(input_tickers, array[]::text[])) as value
    where nullif(trim(value), '') is not null
  )
  select i.ticker, i.source_symbol, min(p.price_date),
    max(p.price_date) filter (where p.source <> 'holiday')
  from owner_ctx ctx
  join public.instruments i on i.user_id = ctx.user_id and i.instrument_type in ('market','fx')
  left join public.holding_prices_daily p on p.user_id = ctx.user_id and p.ticker = i.ticker
  where not exists(select 1 from requested) or i.ticker in (select r.ticker from requested r)
  group by i.ticker, i.source_symbol
  order by i.ticker;
$$;
