begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(12);

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

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001972',true);
select extensions.ok(public.can_view_feature('00000000-0000-0000-0000-000000001971','activity'),'friend has legacy activity grant');
select extensions.is(public.app_get_activity((select id from public.activity_events where title='비공개 조사'),'00000000-0000-0000-0000-000000001971'::uuid),null::jsonb,'friend cannot read private research detail');
select extensions.is(jsonb_array_length(public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001971',input_query=>'비공개 조사')->'items'),0,'friend cannot keyword-search private research');
select extensions.is(jsonb_array_length(public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001971',input_query=>'공개 일반 활동')->'items'),1,'friend still searches general activity');
select extensions.is((select count(*) from public.app_list_recent_activity(20,'00000000-0000-0000-0000-000000001971') where action_type='record_manual_activity'),1::bigint,'recent activity excludes private research before limiting');
select extensions.is((select count(*) from jsonb_array_elements(public.app_list_action_timeline(input_owner_user_id=>'00000000-0000-0000-0000-000000001971',input_filter=>'done')->'days') day, jsonb_array_elements(day->'items') item where item->>'title'='비공개 조사'),0::bigint,'friend timeline excludes private research');

select * from extensions.finish();
rollback;
