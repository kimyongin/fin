begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(7);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values
('00000000-0000-0000-0000-000000000971','authenticated','authenticated','activity-ref-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000000972','authenticated','authenticated','activity-ref-other@example.com','',now(),now(),now());
set local role postgres;
insert into public.accounts(id,user_id,name) values(9971,'00000000-0000-0000-0000-000000000971','Referenced account');
insert into public.instruments(id,user_id,ticker,display_name,currency,instrument_type)
values(9971,'00000000-0000-0000-0000-000000000971','REF971','Referenced instrument','KRW','market');
insert into public.holdings(id,user_id,account_id,ticker,quantity,avg_price)
values(9971,'00000000-0000-0000-0000-000000000971',9971,'REF971',1,100);
insert into public.activity_events(user_id,source,action_type,target_table,target_id,note,result,status)
values('00000000-0000-0000-0000-000000000971','user','update_holding','holdings','9971','Note','Result','succeeded');
select extensions.is((select holding_id from public.activity_events where target_id='9971' and action_type='update_holding'),9971::bigint,'holding target is linked on insert');
select extensions.is((select body from public.activity_events where target_id='9971' and action_type='update_holding'),'기록','automatic records do not publish private notes or result payloads');
insert into public.activity_events(user_id,source,action_type,target_table,target_id,title,before_data,after_data,status)
values('00000000-0000-0000-0000-000000000971','user','log_completed_trade','holdings','9971','Referenced instrument 매수',
  '{"quantity":"1"}'::jsonb,'{"side":"buy","trade_quantity":"2","unit_price":"90","quantity":"3"}'::jsonb,'succeeded');
select extensions.is((select body from public.activity_events where target_id='9971' and action_type='log_completed_trade'),
  '매수 2주 · 체결가 90 · 보유 1→3주','trade body includes saved execution-time values');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000971',true);
set local role authenticated;
select extensions.is(public.app_get_activity((select id from public.activity_events where action_type='log_completed_trade' and target_id='9971'),null)
  ->'holding_summary'->>'account_name','Referenced account','owner detail names the precise account-specific holding');
set local role postgres;
select extensions.throws_ok($$insert into public.activity_events(user_id,source,action_type,target_table,target_id,holding_id,status)
values('00000000-0000-0000-0000-000000000972','user','record_manual_activity','manual_activities',null,9971,'succeeded')$$,
  'P0001','Holding reference not found for activity owner','other owner cannot point at private holding');
delete from public.holdings where id=9971;
select extensions.is((select holding_id from public.activity_events where target_id='9971' and action_type='update_holding'),null::bigint,'deleting holding clears reference');
select extensions.is((select count(*) from public.activity_events where target_id='9971' and action_type='update_holding'),1::bigint,'deleting holding preserves historical activity');
select * from extensions.finish();
rollback;
