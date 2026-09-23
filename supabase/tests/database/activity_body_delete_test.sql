begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(6);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values('00000000-0000-0000-0000-000000000961','authenticated','authenticated','activity-delete-owner@example.com','',now(),now(),now());
set local role postgres;
insert into public.accounts(id,user_id,name) values(9961,'00000000-0000-0000-0000-000000000961','Delete account');
insert into public.instruments(id,user_id,ticker,display_name,currency,instrument_type)
values(9961,'00000000-0000-0000-0000-000000000961','DEL961','Delete instrument','KRW','market');
insert into public.holdings(id,user_id,account_id,ticker,quantity,avg_price)
values(9961,'00000000-0000-0000-0000-000000000961',9961,'DEL961',3,100);
insert into public.activity_events(user_id,source,action_type,target_table,target_id,status,title,body)
values('00000000-0000-0000-0000-000000000961','user','log_completed_trade','holdings','9961','succeeded','3주 매수','3주 보유');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000961',true);
set local role authenticated;
select extensions.is((select body from public.activity_events where target_id='9961'), '3주 보유', 'automatic record has readable body');
select extensions.is((public.app_update_activity(
  (select id from public.activity_events where target_id='9961'),1,
  '00000000-0000-0000-0000-000000009961','{"body":"수정한 기록"}'::jsonb,'app')->>'body'),
  '수정한 기록','owner may correct an automatic record body');
select extensions.is((public.app_delete_activity(
  (select id from public.activity_events where target_id='9961'),2)->>'deleted')::boolean,true,
  'owner may remove readable automatic record');
select extensions.is((select quantity from public.holdings where id=9961),3::real,'record deletion does not change actual holding');
select extensions.is((select public.app_get_activity(id,null) from public.activity_events where target_id='9961'),null::jsonb,
  'deleted activity is absent from detail');
select extensions.is((select count(*) from public.activity_events where target_id='9961' and status='deleted'),1::bigint,
  'event identity remains for references and retry receipts');
select * from extensions.finish();
rollback;
