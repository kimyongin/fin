alter function public.app_get_portfolio_state(uuid)
rename to app_get_portfolio_state_without_valuation_quality;

revoke all on function public.app_get_portfolio_state_without_valuation_quality(uuid) from public, anon, authenticated;

create function public.app_get_portfolio_valuation_quality(input_owner_user_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with requested_owner as (
    select coalesce(input_owner_user_id, auth.uid()) as user_id
  ),
  current_user_ctx as (
    select user_id
    from requested_owner
    where public.can_view_owner(user_id)
  ),
  latest_prices as (
    select distinct on (price.ticker)
      price.ticker,
      price.price_date,
      price.close_price
    from public.holding_prices_daily price
    join current_user_ctx ctx on ctx.user_id = price.user_id
    where price.source <> 'holiday'
    order by price.ticker, price.price_date desc
  ),
  position_inputs as (
    select
      holding.id as holding_id,
      holding.account_id,
      holding.ticker,
      instrument.display_name,
      instrument.instrument_type,
      instrument.currency,
      holding.quantity,
      holding.valuation_amount,
      market_price.close_price as market_price,
      market_price.price_date as market_price_date,
      case when instrument.currency <> 'KRW' then instrument.currency || 'KRW=X' end as fx_ticker,
      fx_price.close_price as fx_price,
      fx_price.price_date as fx_price_date,
      case instrument.instrument_type
        when 'market' then
          case
            when coalesce(holding.quantity, 0) = 0 then 0
            when market_price.close_price > 0 then holding.quantity * market_price.close_price
            else null
          end
        when 'valuation' then holding.valuation_amount
        when 'cash' then holding.valuation_amount
        else null
      end as native_value
    from public.holdings holding
    join current_user_ctx ctx on ctx.user_id = holding.user_id
    join public.instruments instrument
      on instrument.user_id = holding.user_id
     and instrument.ticker = holding.ticker
    left join latest_prices market_price on market_price.ticker = holding.ticker
    left join latest_prices fx_price on fx_price.ticker = instrument.currency || 'KRW=X'
    where instrument.instrument_type <> 'fx'
  ),
  valued_positions as (
    select
      input.*,
      case
        when input.native_value is null then null
        when input.native_value = 0 then 0
        when input.currency = 'KRW' then input.native_value
        when input.fx_price > 0 then input.native_value * input.fx_price
        else null
      end as value_krw,
      array_remove(array[
        case
          when input.instrument_type = 'market'
           and coalesce(input.quantity, 0) <> 0
           and coalesce(input.market_price, 0) <= 0
          then 'missing_price'
        end,
        case
          when input.instrument_type in ('valuation', 'cash')
           and input.valuation_amount is null
          then 'missing_valuation'
        end,
        case
          when input.native_value <> 0
           and input.currency <> 'KRW'
           and coalesce(input.fx_price, 0) <= 0
          then 'missing_fx'
        end,
        case
          when input.instrument_type = 'market'
           and coalesce(input.quantity, 0) <> 0
           and input.market_price > 0
           and input.market_price_date < current_date - 7
          then 'stale_price'
        end,
        case
          when input.native_value <> 0
           and input.currency <> 'KRW'
           and input.fx_price > 0
           and input.fx_price_date < current_date - 7
          then 'stale_fx'
        end
      ], null) as issues
    from position_inputs input
  ),
  classified_positions as (
    select
      valued.*,
      case
        when valued.value_krw is null then 'missing'
        when valued.issues && array['stale_price', 'stale_fx'] then 'stale'
        else 'complete'
      end as status
    from valued_positions valued
  ),
  summary as (
    select
      count(*)::integer as total_position_count,
      count(*) filter (where value_krw is not null)::integer as known_position_count,
      count(*) filter (where value_krw is null)::integer as unknown_position_count,
      count(*) filter (where status = 'stale')::integer as stale_position_count,
      coalesce(sum(value_krw) filter (where value_krw is not null), 0) as known_value_krw
    from classified_positions
  )
  select jsonb_build_object(
    'as_of', current_date,
    'stale_after_days', 7,
    'denominator', 'known_values_only',
    'is_complete', summary.unknown_position_count = 0,
    'has_stale_values', summary.stale_position_count > 0,
    'total_position_count', summary.total_position_count,
    'known_position_count', summary.known_position_count,
    'unknown_position_count', summary.unknown_position_count,
    'stale_position_count', summary.stale_position_count,
    'known_value_krw', summary.known_value_krw,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'holding_id', position.holding_id,
          'account_id', position.account_id,
          'ticker', position.ticker,
          'display_name', position.display_name,
          'instrument_type', position.instrument_type,
          'currency', position.currency,
          'status', position.status,
          'issues', to_jsonb(position.issues),
          'native_value', position.native_value,
          'value_krw', position.value_krw,
          'price_date', position.market_price_date,
          'fx_ticker', position.fx_ticker,
          'fx_price_date', position.fx_price_date
        )
        order by position.account_id, position.ticker
      )
      from classified_positions position
    ), '[]'::jsonb)
  )
  from summary;
$$;

create function public.app_get_portfolio_state(input_owner_user_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_get_portfolio_state_without_valuation_quality(input_owner_user_id), '{}'::jsonb)
    || jsonb_build_object(
      'valuation_quality', public.app_get_portfolio_valuation_quality(input_owner_user_id)
    );
$$;

revoke all on function public.app_get_portfolio_valuation_quality(uuid) from public, anon;
revoke all on function public.app_get_portfolio_state(uuid) from public, anon;
grant execute on function public.app_get_portfolio_valuation_quality(uuid) to authenticated;
grant execute on function public.app_get_portfolio_state(uuid) to authenticated;
