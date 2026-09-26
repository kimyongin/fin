begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(8);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000009531','authenticated','authenticated','holding-delete-owner@example.com','',now(),now(),now()),
       ('00000000-0000-0000-0000-000000009532','authenticated','authenticated','holding-delete-other@example.com','',now(),now(),now());
set local role postgres;
insert into public.accounts(id,user_id,name) values(9531,'00000000-0000-0000-0000-000000009531','Account');
insert into public.instruments(id,user_id,ticker,display_name,currency,instrument_type)
values(9531,'00000000-0000-0000-0000-000000009531','DEL-9531','Delete fixture','KRW','market');
insert into public.holdings(id,user_id,account_id,ticker,quantity,avg_price)
values(9531,'00000000-0000-0000-0000-000000009531',9531,'DEL-9531',1,100);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009531',true);
set local role authenticated;
select extensions.throws_ok($$select public.app_delete_holding_checked(9531,2,'95300000-0000-0000-0000-000000000001')$$,
  'P0001','Holding changed; reload before deleting','stale holding cannot be deleted');
select extensions.is(public.app_delete_holding_checked(9531,1,'95300000-0000-0000-0000-000000000001')->>'holding_id',
  '9531','deletes current holding');
select extensions.is((select count(*)::integer from public.holdings where id=9531),0,'holding row removed');
select extensions.is((select count(*)::integer from public.instruments where id=9531),1,'instrument remains');
select extensions.is((select count(*)::integer from public.activity_events where target_table='holdings' and target_id='9531' and action_type='delete_holding'),1,'one deletion activity');
select extensions.is(public.app_delete_holding_checked(9531,1,'95300000-0000-0000-0000-000000000001')->>'holding_id',
  '9531','lost response retry returns original result');
select extensions.is((select count(*)::integer from public.activity_events where target_table='holdings' and target_id='9531' and action_type='delete_holding'),1,'retry does not duplicate activity');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009532',true);
select extensions.throws_ok($$select public.app_delete_holding_checked(9531,1,'95300000-0000-0000-0000-000000000002')$$,
  'P0001','Holding not found','another owner cannot delete the holding');
select * from extensions.finish();
rollback;
