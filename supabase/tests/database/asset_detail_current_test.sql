begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(11);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000991','authenticated','authenticated','current-asset-owner@example.com','',now(),now(),now());
set local role postgres;
insert into public.accounts(id,user_id,name) values
(9991,'00000000-0000-0000-0000-000000000991','First'),
(9992,'00000000-0000-0000-0000-000000000991','Second');
insert into public.instruments(id,user_id,ticker,display_name,currency,instrument_type,note,private_note)
values(9991,'00000000-0000-0000-0000-000000000991','CURRENT','Original','KRW','market','public note','private reason');
insert into public.holdings(user_id,account_id,ticker,quantity,avg_price,note,private_note)
values('00000000-0000-0000-0000-000000000991',9991,'CURRENT',2,100,'old note','private holding');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000991',true);
set local role authenticated;
create temp table current_fixture(expected jsonb,instrument jsonb,holdings jsonb,response jsonb) on commit drop;
grant select,insert,update on current_fixture to authenticated;
insert into current_fixture(expected,instrument,holdings)
select jsonb_build_object('display_name','Original','currency','KRW','instrument_type','market',
  'note','public note','private_note','private reason','tag_id',null),
  jsonb_build_object('display_name','Updated','currency','KRW','instrument_type','market','note','public note','tag_id',null),
  jsonb_build_array(jsonb_build_object('id',h.id,'account_id',9991,'expected_account_id',9991,
    'expected_state_version',h.state_version,'expected_note','old note','expected_private_note','private holding',
    'quantity',3,'avg_price',120),
    jsonb_build_object('id',null,'account_id',9992,'quantity',1,'avg_price',90))
from public.holdings h where h.ticker='CURRENT';
update current_fixture set response=public.app_save_asset_detail_current(9991,expected,instrument,holdings,
  '00000000-0000-0000-0000-000000009991','증권사 앱 확인');
select extensions.is((select response->'instrument'->>'display_name' from current_fixture),'Updated','instrument saved');
select extensions.is((select count(*) from public.holdings where ticker='CURRENT'),2::bigint,'two holdings saved');
select extensions.is((select private_note from public.instruments where id=9991),'private reason','private instrument note unchanged');
select extensions.is((select private_note from public.holdings where ticker='CURRENT' and account_id=9991),'private holding','private holding note unchanged');
select extensions.is((select count(*) from public.activity_events where user_id='00000000-0000-0000-0000-000000000991' and action_type='save_asset_detail'),1::bigint,'one activity for multi-account save');
select extensions.ok((select body like '%증권사 앱 확인%' and body like '%First%' and body like '%Second%'
  from public.activity_events where action_type='save_asset_detail' and user_id='00000000-0000-0000-0000-000000000991'),
  'activity includes reason and both accounts');
select extensions.is((select response from current_fixture),
  (select public.app_save_asset_detail_current(9991,expected,instrument,holdings,
    '00000000-0000-0000-0000-000000009991','증권사 앱 확인') from current_fixture),
  'response-loss retry reuses receipt');
select extensions.is((select count(*) from public.activity_events where user_id='00000000-0000-0000-0000-000000000991' and action_type='save_asset_detail'),1::bigint,'retry creates no activity');
create temp table current_price_result(payload jsonb) on commit drop;
grant insert on current_price_result to authenticated;
insert into current_price_result select public.app_save_asset_detail_current(9991,(select (response->'instrument')-'id' from current_fixture),
  '{"display_name":"Updated","currency":"KRW","instrument_type":"market","note":"public note","tag_id":null,"manual_price":150,"manual_price_date":"2026-09-24"}'::jsonb,
  '[]'::jsonb,'00000000-0000-0000-0000-000000009992',null);
select extensions.is((select close_price::numeric from public.holding_prices_daily where ticker='CURRENT' and price_date='2026-09-24'),150::numeric,'price-only edit is saved');
select extensions.is((select count(*) from public.activity_events where user_id='00000000-0000-0000-0000-000000000991' and action_type='save_asset_detail'),2::bigint,'price-only edit creates one activity');
insert into current_price_result select public.app_save_asset_detail_current(9991,(select (response->'instrument')-'id' from current_fixture),
  '{"display_name":"Updated","currency":"KRW","instrument_type":"market","note":"public note","tag_id":null}'::jsonb,
  '[]'::jsonb,'00000000-0000-0000-0000-000000009993',null);
select extensions.is((select count(*) from public.activity_events where user_id='00000000-0000-0000-0000-000000000991' and action_type='save_asset_detail'),2::bigint,'unchanged edit creates no activity');
select * from extensions.finish();
rollback;
