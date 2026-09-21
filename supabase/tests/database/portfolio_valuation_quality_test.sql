begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(18);

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000001301', 'authenticated', 'authenticated', 'valuation-quality@example.com', '', now(), now(), now());

set local role postgres;
insert into public.accounts(id, user_id, name)
values (9931, '00000000-0000-0000-0000-000000001301', 'Quality');

insert into public.instruments(id, user_id, ticker, display_name, currency, instrument_type)
values
  (9931, '00000000-0000-0000-0000-000000001301', 'USD-MARKET', 'US market', 'USD', 'market'),
  (9932, '00000000-0000-0000-0000-000000001301', 'KRW-STALE', 'Stale market', 'KRW', 'market'),
  (9933, '00000000-0000-0000-0000-000000001301', 'JPY-VALUE', 'Japan valuation', 'JPY', 'valuation'),
  (9934, '00000000-0000-0000-0000-000000001301', 'KRW-ZERO', 'Zero position', 'KRW', 'market');

insert into public.holdings(user_id, account_id, ticker, quantity, avg_price, purchase_amount, valuation_amount)
values
  ('00000000-0000-0000-0000-000000001301', 9931, 'USD-MARKET', 10, 80, null, null),
  ('00000000-0000-0000-0000-000000001301', 9931, 'KRW-STALE', 2, 100, null, null),
  ('00000000-0000-0000-0000-000000001301', 9931, 'JPY-VALUE', null, null, 9000, 10000),
  ('00000000-0000-0000-0000-000000001301', 9931, 'KRW-ZERO', 0, 0, null, null);

insert into public.holding_prices_daily(user_id, ticker, price_date, close_price, source)
values
  ('00000000-0000-0000-0000-000000001301', 'KRW-STALE', current_date - 8, 150, 'manual'),
  ('00000000-0000-0000-0000-000000001301', 'USDKRW=X', current_date, 0, 'manual');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001301', true);
set local role authenticated;

select extensions.is((public.app_get_portfolio_valuation_quality()->>'total_position_count')::integer, 4, 'counts all holdings including a true zero position');
select extensions.is((public.app_get_portfolio_valuation_quality()->>'known_position_count')::integer, 2, 'counts stale and true zero positions as known');
select extensions.is((public.app_get_portfolio_valuation_quality()->>'unknown_position_count')::integer, 2, 'counts missing market price and missing FX as unknown');
select extensions.is((public.app_get_portfolio_valuation_quality()->>'stale_position_count')::integer, 1, 'reports an older-than-seven-days price as stale');
select extensions.is((public.app_get_portfolio_valuation_quality()->>'known_value_krw')::numeric, 300::numeric, 'known subtotal excludes unknown holdings');
select extensions.is((public.app_get_portfolio_valuation_quality()->>'is_complete')::boolean, false, 'incomplete valuation is explicit');
select extensions.ok((select item->'issues' ? 'missing_price' from jsonb_array_elements(public.app_get_portfolio_valuation_quality()->'items') item where item->>'ticker' = 'USD-MARKET'), 'missing market price has a machine-readable issue');
select extensions.ok((select item->'issues' ? 'missing_fx' from jsonb_array_elements(public.app_get_portfolio_valuation_quality()->'items') item where item->>'ticker' = 'JPY-VALUE'), 'missing JPY FX has a machine-readable issue');
select extensions.is((select (item->>'value_krw')::numeric from jsonb_array_elements(public.app_get_portfolio_valuation_quality()->'items') item where item->>'ticker' = 'KRW-ZERO'), 0::numeric, 'a genuine zero quantity remains a known zero value');
select extensions.is((public.app_get_portfolio_state()->'valuation_quality'->>'unknown_position_count')::integer, 2, 'portfolio state exposes the same valuation quality contract');

set local role postgres;
update public.holdings
set quantity = 1
where user_id = '00000000-0000-0000-0000-000000001301'
  and ticker = 'KRW-ZERO';
delete from public.holding_prices_daily
where user_id = '00000000-0000-0000-0000-000000001301'
  and ticker = 'KRW-STALE';
set local role authenticated;

select extensions.is((public.app_get_portfolio_valuation_quality()->>'known_position_count')::integer, 0, 'an entirely unpriced portfolio has no known positions');
select extensions.is((public.app_get_portfolio_valuation_quality()->>'unknown_position_count')::integer, 4, 'an entirely unpriced portfolio keeps every position unknown');
select extensions.is((public.app_get_portfolio_valuation_quality()->>'known_value_krw')::numeric, 0::numeric, 'an entirely unpriced portfolio reports a zero known subtotal without claiming zero total value');

set local role postgres;
update public.holdings
set quantity = 0
where user_id = '00000000-0000-0000-0000-000000001301'
  and ticker = 'KRW-ZERO';
insert into public.holding_prices_daily(user_id, ticker, price_date, close_price, source)
values
  ('00000000-0000-0000-0000-000000001301', 'USD-MARKET', current_date, 100, 'manual'),
  ('00000000-0000-0000-0000-000000001301', 'KRW-STALE', current_date - 8, 150, 'manual'),
  ('00000000-0000-0000-0000-000000001301', 'USDKRW=X', current_date, 1400, 'manual'),
  ('00000000-0000-0000-0000-000000001301', 'JPYKRW=X', current_date, 9, 'manual')
on conflict (user_id, ticker, price_date) do update
set close_price = excluded.close_price,
    source = excluded.source;
set local role authenticated;

select extensions.is((public.app_get_portfolio_valuation_quality()->>'known_position_count')::integer, 4, 'valid market and FX prices make every position known');
select extensions.is((public.app_get_portfolio_valuation_quality()->>'unknown_position_count')::integer, 0, 'no unknown positions remain');
select extensions.is((public.app_get_portfolio_valuation_quality()->>'is_complete')::boolean, true, 'complete valuation is explicit');
select extensions.is((public.app_get_portfolio_valuation_quality()->>'known_value_krw')::numeric, 1490300::numeric, 'KRW, USD, JPY, and zero values share one known subtotal');
select extensions.is((public.app_get_portfolio_valuation_quality()->>'stale_position_count')::integer, 1, 'stale data remains a warning while still contributing to value');

select * from extensions.finish();
rollback;
