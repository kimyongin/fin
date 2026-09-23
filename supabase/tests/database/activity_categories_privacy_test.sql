begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(25);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001971','authenticated','authenticated','category-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001972','authenticated','authenticated','category-friend@example.com','',now(),now(),now());
set local role postgres;
insert into public.profiles(user_id,public_name,public_name_normalized,sharing_enabled)
values('00000000-0000-0000-0000-000000001971','category-owner','category-owner',true);
insert into public.friendships(viewer_user_id,owner_user_id)
values('00000000-0000-0000-0000-000000001972','00000000-0000-0000-0000-000000001971');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001971',true);
set local role authenticated;

select public.app_create_activity('97111111-1111-4111-8111-111111111111',jsonb_build_object(
  'title','비공개 조사','category','research','timezone','Asia/Seoul','authored_via','agent',
  'context',jsonb_build_object('scope','보유 종목','sources',jsonb_build_array(jsonb_build_object('title','공시','url','https://example.com/filing')))));
select public.app_create_activity('97222222-2222-4222-8222-222222222222',jsonb_build_object(
  'title','공개 일반 활동','timezone','Asia/Seoul','authored_via','app'));

select extensions.is((select record_kind from public.activity_events where title='비공개 조사'),'research','research category is stored on the activity');
select extensions.is((public.app_get_activity((select id from public.activity_events where title='비공개 조사'),null)#>>'{after_data,context,scope}'),'보유 종목','activity retains structured source scope');
select extensions.is((select record_kind from public.activity_events where title='공개 일반 활동'),'general','omitted category defaults to general');
select extensions.throws_ok(
  $$select public.app_create_activity('97333333-3333-4333-8333-333333333333','{"title":"가짜 매매","category":"trade"}'::jsonb)$$,
  'P0001','Invalid manual activity category','manual work cannot claim a financial category');
select extensions.is(jsonb_array_length(public.app_search_activities(input_query=>'비공개 조사')->'items'),1,'owner searches private research');
select extensions.is(jsonb_array_length(public.app_list_action_timeline(input_filter=>'done')->'days'),1,'owner timeline includes activities');
select extensions.is((public.app_update_activity(
  (select id from public.activity_events where title='비공개 조사'),1,'97444444-4444-4444-8444-444444444444',
  '{"record_kind":"review","context":{"scope":"변경 후 점검","sources":[{"title":"새 공시","url":"https://example.com/new"}]}}'::jsonb,'agent'
)#>>'{record_kind}'),'review','manual category can be corrected on the same record');
select extensions.is((public.app_get_activity((select id from public.activity_events where title='비공개 조사'),null)#>>'{after_data,context,scope}'),'변경 후 점검','corrected source scope is returned');
select extensions.throws_ok(
  $$select public.app_update_activity((select id from public.activity_events where title='비공개 조사'),2,'97555555-5555-4555-8555-555555555555','{"record_kind":"trade"}'::jsonb,'agent')$$,
  'P0001','Manual activity cannot claim a financial or task action','editing cannot spoof a trade classification');
select extensions.throws_ok(
  $$select public.app_update_activity((select id from public.activity_events where title='비공개 조사'),2,'97666666-6666-4666-8666-666666666666','{"context":{"sources":[{"title":"bad","url":"file:///secret"}]}}'::jsonb,'agent')$$,
  'P0001','Invalid activity source','invalid source URLs are rejected on edit');

set local role postgres;
insert into public.activity_events(user_id,source,action_type,title,before_data,after_data,status)
values('00000000-0000-0000-0000-000000001971','user','log_completed_trade','비공개 매매',
  '{"quantity":"1"}'::jsonb,'{"side":"buy","trade_quantity":"1","unit_price":"100"}'::jsonb,'succeeded');
insert into public.activity_events(user_id,source,action_type,title,before_data,after_data,status)
values('00000000-0000-0000-0000-000000001971','user','reconcile_holding','비공개 보정',
  '{"quantity":"1"}'::jsonb,'{"quantity":"2","reason":"증권사 확인"}'::jsonb,'succeeded');
set local role authenticated;
select extensions.is(jsonb_array_length(public.app_search_activities(input_query=>'비공개 매매')->'items'),1,
  'owner can search own automatic trade activity');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001972',true);
select extensions.ok(public.can_view_feature('00000000-0000-0000-0000-000000001971','activity'),'friend has legacy activity grant');
select extensions.is(public.app_get_activity((select id from public.activity_events where title='비공개 조사'),'00000000-0000-0000-0000-000000001971'::uuid),null::jsonb,'friend cannot read private research detail');
select extensions.is(jsonb_array_length(public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001971',input_query=>'비공개 조사')->'items'),0,'friend cannot keyword-search private research');
select extensions.is(jsonb_array_length(public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001971',input_query=>'공개 일반 활동')->'items'),1,'friend still searches general activity');
select extensions.is((select count(*) from public.app_list_recent_activity(20,'00000000-0000-0000-0000-000000001971') where action_type='record_manual_activity'),1::bigint,'recent activity excludes private research before limiting');
select extensions.is((select count(*) from jsonb_array_elements(public.app_list_action_timeline(input_owner_user_id=>'00000000-0000-0000-0000-000000001971',input_filter=>'done')->'days') day, jsonb_array_elements(day->'items') item where item->>'title'='비공개 조사'),0::bigint,'friend timeline excludes private research');
select extensions.is(public.app_get_activity((select id from public.activity_events where title='비공개 매매'),'00000000-0000-0000-0000-000000001971'::uuid),null::jsonb,
  'friend cannot read trade execution details');
select extensions.is(jsonb_array_length(public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001971',input_query=>'비공개 매매')->'items'),0,
  'friend cannot search trade execution details');
select extensions.is((select count(*) from public.app_list_recent_activity(20,'00000000-0000-0000-0000-000000001971') where action_type='log_completed_trade'),0::bigint,
  'friend recent activity omits private trade details');
select extensions.is((select count(*) from jsonb_array_elements(public.app_list_action_timeline(input_owner_user_id=>'00000000-0000-0000-0000-000000001971',input_filter=>'done')->'days') day, jsonb_array_elements(day->'items') item where item->'after_data' ? 'trade_quantity'),0::bigint,
  'friend timeline omits private trade details before pagination');
select extensions.is(public.app_get_activity((select id from public.activity_events where title='비공개 보정'),'00000000-0000-0000-0000-000000001971'::uuid),null::jsonb,
  'friend cannot read correction reason and values');
select extensions.is(jsonb_array_length(public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001971',input_query=>'비공개 보정')->'items'),0,
  'friend cannot search correction activity');
select extensions.is((select count(*) from public.app_list_recent_activity(20,'00000000-0000-0000-0000-000000001971') where action_type='reconcile_holding'),0::bigint,
  'friend recent activity omits correction details');
select extensions.is((select count(*) from jsonb_array_elements(public.app_list_action_timeline(input_owner_user_id=>'00000000-0000-0000-0000-000000001971',input_filter=>'done')->'days') day, jsonb_array_elements(day->'items') item where item->'after_data' ? 'reason'),0::bigint,
  'friend timeline omits correction reasons');

select * from extensions.finish();
rollback;
