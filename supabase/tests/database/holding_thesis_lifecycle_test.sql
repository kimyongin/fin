begin; create extension if not exists pgtap with schema extensions; set local search_path=public,extensions; select extensions.plan(6);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values('00000000-0000-0000-0000-000000001101','authenticated','authenticated','thesis-life@example.com','',now(),now(),now());
set local role postgres; insert into accounts(id,user_id,name) values(9911,'00000000-0000-0000-0000-000000001101','Account');
insert into instruments(id,user_id,ticker,display_name,currency,instrument_type) values(9911,'00000000-0000-0000-0000-000000001101','LIFE','Lifecycle','KRW','market');
insert into holdings(user_id,account_id,ticker,quantity,avg_price) values('00000000-0000-0000-0000-000000001101',9911,'LIFE',10,100);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001101',true); set local role authenticated;
select extensions.lives_ok($$select public.app_save_holding_thesis(9911,null,null,'11111111-1111-4111-8111-111111111111','{"reason_text":"old base"}'::jsonb,'initial','app')$$,'saves base thesis');
select extensions.lives_ok($$select public.app_save_holding_thesis(9911,9911,null,'22222222-2222-4222-8222-222222222222','{"reason_text":"old account"}'::jsonb,'initial','app')$$,'saves account thesis');
select extensions.lives_ok($$select public.app_log_completed_trade((public.app_preview_trade_entry(9911,9911,'sell',10,110,current_date)->>'preview_id')::uuid,'33333333-3333-4333-8333-333333333333','app')$$,'records full liquidation');
select extensions.is((select count(*) from holding_theses where is_active),0::bigint,'full liquidation deactivates base and account theses');
select extensions.lives_ok($$select public.app_log_completed_trade((public.app_preview_trade_entry(9911,9911,'buy',5,120,current_date)->>'preview_id')::uuid,'44444444-4444-4444-8444-444444444444','app')$$,'records a later repurchase');
select extensions.is((select count(*) from holding_theses where is_active),0::bigint,'repurchase does not silently reactivate old theses');
select * from extensions.finish(); rollback;
