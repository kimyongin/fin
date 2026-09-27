begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(12);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values('00000000-0000-0000-0000-000000016001','authenticated','authenticated','allocation-inclusion@example.com','',now(),now(),now());
set local role postgres;
insert into public.accounts(id,user_id,name) values
  (160001,'00000000-0000-0000-0000-000000016001','투자'),
  (160002,'00000000-0000-0000-0000-000000016001','비상금');
insert into public.instruments(id,user_id,ticker,display_name,currency,instrument_type) values
  (160001,'00000000-0000-0000-0000-000000016001','STOCK160','주식','KRW','valuation'),
  (160002,'00000000-0000-0000-0000-000000016001','CASH160','현금','KRW','cash');
insert into public.holdings(user_id,account_id,ticker,purchase_amount,valuation_amount) values
  ('00000000-0000-0000-0000-000000016001',160001,'STOCK160',50,60),
  ('00000000-0000-0000-0000-000000016001',160001,'CASH160',null,20),
  ('00000000-0000-0000-0000-000000016001',160002,'CASH160',null,20);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000016001',true);
set local role authenticated;

select extensions.ok((select bool_and(include_in_allocation) from public.holdings where user_id=auth.uid()),'existing and new rows default to included');
create temp table inclusion_fixture(holding_id bigint, before_version integer, response jsonb) on commit drop;
grant select,insert,update on inclusion_fixture to authenticated;
insert into inclusion_fixture(holding_id,before_version)
select id,state_version from public.holdings where user_id=auth.uid() and account_id=160002;
update inclusion_fixture set response=public.app_save_asset_detail_with_activity(
  160002,
  '{"display_name":"현금","currency":"KRW","instrument_type":"cash","note":null,"tag_id":null}'::jsonb,
  '{"display_name":"현금","currency":"KRW","instrument_type":"cash","note":null,"tag_id":null}'::jsonb,
  jsonb_build_array(jsonb_build_object('id',holding_id,'account_id',160002,'expected_account_id',160002,
    'expected_state_version',before_version,'valuation_amount',20,'include_in_allocation',false)),
  '00000000-0000-0000-0000-000000016001','비상금 제외','{}'::uuid[]);

select extensions.is((select include_in_allocation from public.holdings where account_id=160002),false,'one account holding excluded');
select extensions.is((select include_in_allocation from public.holdings where account_id=160001 and ticker='CASH160'),true,'same ticker in another account stays included');
select extensions.is((select state_version from public.holdings where account_id=160002),(select before_version+1::bigint from inclusion_fixture),'flag-only edit increments conflict version');
select extensions.is((public.app_get_portfolio_state(null)->'allocation'->>'known_total_krw')::numeric,100::numeric,'total assets retain excluded balance');
select extensions.is((public.app_get_portfolio_state(null)->'allocation'->>'known_included_krw')::numeric,80::numeric,'allocation denominator uses included balances');
select extensions.is((public.app_get_portfolio_state(null)->'allocation'->>'known_excluded_krw')::numeric,20::numeric,'excluded balance reported separately');
select extensions.is((public.app_get_portfolio_state(null)->'allocation'->>'included_is_complete'),'true','included valuation quality is independent');
select extensions.is((select count(*) from public.activity_events where user_id=auth.uid() and action_type='save_asset_detail'),1::bigint,'one activity for flag-only edit');
select extensions.is((select response from inclusion_fixture),
  (select public.app_save_asset_detail_with_activity(160002,
    '{"display_name":"현금","currency":"KRW","instrument_type":"cash","note":null,"tag_id":null}'::jsonb,
    '{"display_name":"현금","currency":"KRW","instrument_type":"cash","note":null,"tag_id":null}'::jsonb,
    jsonb_build_array(jsonb_build_object('id',holding_id,'account_id',160002,'expected_account_id',160002,
      'expected_state_version',before_version,'valuation_amount',20,'include_in_allocation',false)),
    '00000000-0000-0000-0000-000000016001','비상금 제외','{}'::uuid[]) from inclusion_fixture),
  'same-key retry returns the receipt');
select extensions.is((select count(*) from public.activity_events where user_id=auth.uid() and action_type='save_asset_detail'),1::bigint,'retry adds no activity');
select public.app_bulk_save_portfolio_rows('[{"account_name":"비상금","display_name":"현금","instrument_type":"cash","ticker":"CASH160","currency":"KRW","valuation_amount":25}]'::jsonb);
select extensions.is((select include_in_allocation from public.holdings where account_id=160002),false,'bulk edit preserves exclusion when field is omitted');

select * from extensions.finish();
rollback;
