begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(15);

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000001401', 'authenticated', 'authenticated', 'price-sync@example.com', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000001402', 'authenticated', 'authenticated', 'price-sync-other@example.com', '', now(), now(), now());

set local role postgres;
insert into public.accounts(id, user_id, name)
values (9941, '00000000-0000-0000-0000-000000001401', 'Sync account');

insert into public.instruments(id, user_id, ticker, display_name, currency, instrument_type)
values
  (9941, '00000000-0000-0000-0000-000000001401', '360750', 'Korean ETF', 'KRW', 'market'),
  (9942, '00000000-0000-0000-0000-000000001401', 'VALUATION:PRIVATE', 'Private asset', 'KRW', 'valuation'),
  (9943, '00000000-0000-0000-0000-000000001401', 'USDKRW=X', 'USD/KRW', 'KRW', 'fx');

insert into public.holdings(user_id, account_id, ticker, quantity, avg_price, purchase_amount, valuation_amount)
values
  ('00000000-0000-0000-0000-000000001401', 9941, '360750', 10, 10000, null, null),
  ('00000000-0000-0000-0000-000000001401', 9941, 'VALUATION:PRIVATE', null, null, 10000, 12000);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001401', true);
set local role authenticated;

select extensions.is((select count(*)::integer from public.app_get_price_sync_targets()), 2, 'held market and FX instruments are sync targets');
select extensions.ok(exists(select 1 from public.app_get_price_sync_targets() where ticker = '360750'), 'held market instrument is included');
select extensions.ok(exists(select 1 from public.app_get_price_sync_targets() where ticker = 'USDKRW=X'), 'FX instrument is included');
select extensions.ok(not exists(select 1 from public.app_get_price_sync_targets() where ticker = 'VALUATION:PRIVATE'), 'valuation holding is excluded');
select extensions.is((select count(*)::integer from public.app_get_price_sync_targets(array['VALUATION:PRIVATE'])), 0, 'explicit requests cannot bypass the eligible instrument types');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001402', true);
select extensions.throws_ok(
  $$select public.app_upsert_price_rows('360750', '360750.KS', '[{"date":"2026-09-21","close":20000}]'::jsonb)$$,
  'P0001',
  'Market or FX instrument not found',
  'another user cannot write prices for the owner instrument'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001401', true);

select extensions.is(
  public.app_upsert_price_rows('360750', '360750.KS', jsonb_build_array(jsonb_build_object('date', current_date::text, 'close', 21000))),
  1,
  'the app RPC stores one validated price row'
);
select extensions.is((select close_price from public.holding_prices_daily where user_id = auth.uid() and ticker = '360750' and price_date = current_date), 21000::real, 'stored price is readable through RLS');
select extensions.is((select source_symbol from public.instruments where user_id = auth.uid() and ticker = '360750'), '360750.KS', 'resolved Yahoo symbol is retained');
select extensions.throws_ok(
  $$select public.app_upsert_price_rows('VALUATION:PRIVATE', 'VALUATION:PRIVATE', '[{"date":"2026-09-21","close":1}]'::jsonb)$$,
  'P0001',
  'Market or FX instrument not found',
  'non-market instruments cannot receive synchronized prices'
);

select extensions.ok(
  public.app_record_price_sync_run(2, 1, '[{"ticker":"UNKNOWN","error":"not found"}]'::jsonb) is not null,
  'a partial web sync is recorded'
);
select extensions.is((select failed_count from public.sync_runs where user_id = auth.uid() order by id desc limit 1), 1, 'sync run preserves its failure count');
select extensions.is((select (after_data ->> 'failed_count')::integer from public.activity_events where user_id = auth.uid() and action_type = 'sync_prices' order by id desc limit 1), 1, 'activity contains the partial outcome');

select public.app_record_price_sync_run(1, 0, '[{"ticker":"UNKNOWN","error":"not found"}]'::jsonb);
select extensions.is((select status from public.activity_events where user_id = auth.uid() and action_type = 'sync_prices' order by id desc limit 1), 'failed', 'an all-failed run is visibly failed');

select set_config('request.jwt.claim.sub', '', true);
select extensions.throws_ok(
  $$select * from public.app_get_price_sync_targets()$$,
  'P0001',
  'Authentication required',
  'price sync targets require an authenticated owner'
);

select * from extensions.finish();
rollback;
