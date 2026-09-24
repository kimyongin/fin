begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(12);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001971','authenticated','authenticated','activity-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001972','authenticated','authenticated','activity-friend@example.com','',now(),now(),now());
set local role postgres;
insert into profiles(user_id,public_name,public_name_normalized,sharing_enabled)
values('00000000-0000-0000-0000-000000001971','activity-owner','activity-owner',true);
insert into friendships(viewer_user_id,owner_user_id)
values('00000000-0000-0000-0000-000000001972','00000000-0000-0000-0000-000000001971');
insert into accounts(id,user_id,name) values(9971,'00000000-0000-0000-0000-000000001971','Private account');
insert into instruments(id,user_id,ticker,display_name,currency,instrument_type)
values(9971,'00000000-0000-0000-0000-000000001971','PRIV971','Private instrument','KRW','market');
insert into holdings(id,user_id,account_id,ticker,quantity,avg_price)
values(9971,'00000000-0000-0000-0000-000000001971',9971,'PRIV971',1,100);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001971',true);
set local role authenticated;
select public.app_create_activity('97111111-1111-4111-8111-111111111111',
  '{"title":"정기 점검","body":"확인한 공개 사실","instrument_id":9971}'::jsonb);
create temporary table activity_target as select id from activity_events where title='정기 점검';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001972',true);
select extensions.is(public.app_get_activity((select id from activity_target),
  '00000000-0000-0000-0000-000000001971'),null::jsonb,'default denial hides detail');
select extensions.is(jsonb_array_length(public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001971',input_query=>'정기 점검')->'items'),0,
  'default denial hides search');
select extensions.is(jsonb_array_length(public.app_list_action_timeline(input_owner_user_id=>'00000000-0000-0000-0000-000000001971')->'days'),0,
  'default denial hides timeline');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001971',true);
select public.app_update_sharing_policy(0,'{"activity":true,"assets":false}'::jsonb);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001972',true);
select extensions.is(public.app_get_activity((select id from activity_target),
  '00000000-0000-0000-0000-000000001971')->>'body','확인한 공개 사실','explicit grant exposes readable body');
select extensions.is(public.app_get_activity((select id from activity_target),
  '00000000-0000-0000-0000-000000001971')->>'instrument_id',null::text,'asset reference is hidden without asset grant');
select extensions.is(public.app_get_activity((select id from activity_target),
  '00000000-0000-0000-0000-000000001971')->>'instrument_summary',null::text,'asset summary is hidden without asset grant');
select extensions.is(public.app_get_activity((select id from activity_target),
  '00000000-0000-0000-0000-000000001971')->>'after_data',null::text,'internal payload is hidden');
select extensions.is(jsonb_array_length(public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001971',input_query=>'정기 점검')->'items'),1,
  'explicit grant exposes keyword search');
select extensions.is(public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001971',input_query=>'정기 점검')->'items'->0->>'holding_id',null::text,
  'search hides asset reference');
select extensions.throws_ok($$select public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001971',input_instrument_id=>9971)$$,
  'P0001','Asset access required for target filters','private asset filter cannot be used as a side channel');
select extensions.is(jsonb_array_length(public.app_list_action_timeline(input_owner_user_id=>'00000000-0000-0000-0000-000000001971')->'days'),1,
  'explicit grant exposes timeline');
select extensions.is((select count(*) from public.app_list_recent_activity(20,'00000000-0000-0000-0000-000000001971')),0::bigint,
  'legacy raw recent feed never exposes internal JSON to friend');
select * from extensions.finish();
rollback;
