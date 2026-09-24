begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(12);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values
('00000000-0000-0000-0000-000000000981','authenticated','authenticated','body-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000000982','authenticated','authenticated','body-friend@example.com','',now(),now(),now());
set local role postgres;
insert into public.profiles(user_id,public_name,public_name_normalized,sharing_enabled)
values('00000000-0000-0000-0000-000000000981','body-owner','body-owner',true);
insert into public.friendships(viewer_user_id,owner_user_id)
values('00000000-0000-0000-0000-000000000982','00000000-0000-0000-0000-000000000981');
insert into public.accounts(id,user_id,name) values(9981,'00000000-0000-0000-0000-000000000981','Body account');
insert into public.instruments(id,user_id,ticker,display_name,currency,instrument_type)
values(9981,'00000000-0000-0000-0000-000000000981','BODY981','Body instrument','KRW','market');
insert into public.holdings(id,user_id,account_id,ticker,quantity,avg_price)
values(9981,'00000000-0000-0000-0000-000000000981',9981,'BODY981',1,100);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000981',true);
set local role authenticated;
create temp table body_api_record(response jsonb) on commit drop;
grant select,insert,update on body_api_record to authenticated;
insert into body_api_record select public.app_create_activity_with_tags(
  '00000000-0000-0000-0000-000000009981',
  '{"title":"분기 점검","body":"확인한 사실과 출처\n\n다음 행동은 보류","instrument_id":9981,"authored_via":"app"}'::jsonb,
  array[]::uuid[]);
select extensions.is((select response->>'body' from body_api_record),E'확인한 사실과 출처\n\n다음 행동은 보류','new activity stores one body');
select extensions.is((select (response->>'instrument_id')::bigint from body_api_record),9981::bigint,'instrument reference is returned');
select extensions.is((select response->'instrument_summary'->>'ticker' from body_api_record),'BODY981','instrument summary identifies the stock without an account');
select extensions.throws_ok($$select public.app_create_activity('00000000-0000-0000-0000-000000009982',
  '{"title":"old","category":"review"}'::jsonb)$$,'P0001','Unsupported activity field; update your tool contract','old category is not silently ignored');
select extensions.throws_ok($$select public.app_create_activity('00000000-0000-0000-0000-000000009983',
  '{"title":"bad reference","instrument_id":999999}'::jsonb)$$,'P0001','Instrument reference not found','invalid instrument link is rejected');
select extensions.throws_ok($$select public.app_create_activity('00000000-0000-0000-0000-000000009985',
  '{"title":"old holding reference","holding_id":9981}'::jsonb)$$,'P0001','Unsupported activity field; update your tool contract','old holding reference is rejected rather than silently mapped');
select extensions.throws_ok($$select public.app_update_activity((select (response->>'id')::bigint from body_api_record),
  (select (response->>'version')::integer from body_api_record),'00000000-0000-0000-0000-000000009986',
  '{"account_id":9981}'::jsonb,'app')$$,'P0001','Unsupported activity field; update your tool contract','old account reference patch is rejected');
update body_api_record set response=public.app_update_activity((response->>'id')::bigint,(response->>'version')::integer,
  '00000000-0000-0000-0000-000000009984','{"body":"수정된 본문"}'::jsonb,'app');
select extensions.is((select response->>'body' from body_api_record),'수정된 본문','one body can be edited in place');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000982',true);
select extensions.is((select public.app_get_activity((response->>'id')::bigint,'00000000-0000-0000-0000-000000000981') from body_api_record),null::jsonb,'new wider activity sharing defaults to deny');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000981',true);
select extensions.is((public.app_update_sharing_policy(0,'{"activity":true}'::jsonb)->'grants'->>'activity')::boolean,true,
  'owner explicitly enables the new activity grant');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000982',true);
select extensions.is((select public.app_get_activity((response->>'id')::bigint,'00000000-0000-0000-0000-000000000981')->>'body' from body_api_record),
  '수정된 본문','explicit activity grant shares readable body');
select extensions.is((select public.app_get_activity((response->>'id')::bigint,'00000000-0000-0000-0000-000000000981')->>'after_data' from body_api_record),
  null::text,'shared detail omits internal payload');
select * from extensions.finish();
rollback;
