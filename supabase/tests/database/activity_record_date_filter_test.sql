begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(7);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000009311','authenticated','authenticated','date-filter-owner@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009311',true);
set local role authenticated;
select public.app_save_general_task(null,null,'93111111-1111-4111-8111-111111111111',jsonb_build_object(
  'title','미래 할 일','subject',jsonb_build_object('kind','portfolio'),
  'due_date',((clock_timestamp() at time zone 'Asia/Seoul')::date+45)::text,
  'timezone','Asia/Seoul','authored_via','app'));
select public.app_save_general_task(null,null,'93122222-2222-4222-8222-222222222222',jsonb_build_object(
  'title','날짜 없는 할 일','subject',jsonb_build_object('kind','portfolio'),
  'timezone','Asia/Seoul','authored_via','app'));
select public.app_record_manual_activity('오래된 기록','과거 자료',
  clock_timestamp()-interval '45 days','Asia/Seoul','93133333-3333-4333-8333-333333333333','app');
select public.app_record_manual_activity('최근 기록','오늘 자료',
  clock_timestamp(),'Asia/Seoul','93144444-4444-4444-8444-444444444444','app');

select extensions.is((select count(*)::integer from jsonb_array_elements(public.app_search_activities(
  input_from:=(clock_timestamp() at time zone 'Asia/Seoul')::date-29,
  input_to:=(clock_timestamp() at time zone 'Asia/Seoul')::date)->'items') item where item->>'record_state'='todo'),
  2,'record window does not hide future or undated open tasks');
select extensions.is((select count(*)::integer from jsonb_array_elements(public.app_search_activities(
  input_from:=(clock_timestamp() at time zone 'Asia/Seoul')::date-29,
  input_to:=(clock_timestamp() at time zone 'Asia/Seoul')::date)->'items') item where item->>'record_state'='done'),
  1,'record window includes only recent performed facts');
select extensions.is((select count(*)::integer from jsonb_array_elements(public.app_search_activities(
  input_from:=null,input_to:=null)->'items') item where item->>'record_state'='done'),
  2,'whole period includes old performed facts');
select extensions.is(jsonb_array_length(public.app_list_action_timeline(null,'all',
  (clock_timestamp() at time zone 'Asia/Seoul')::date-29,
  (clock_timestamp() at time zone 'Asia/Seoul')::date,30,null,'Asia/Seoul')->'pending'),
  2,'timeline keeps both pending tasks across record date window');
select extensions.is((select count(*)::integer from jsonb_array_elements(public.app_list_action_timeline(null,'all',
  (clock_timestamp() at time zone 'Asia/Seoul')::date-29,
  (clock_timestamp() at time zone 'Asia/Seoul')::date,30,null,'Asia/Seoul')->'days') day,
  jsonb_array_elements(day->'items') item where item->>'title'='오래된 기록'),0,'timeline excludes old record');
select extensions.throws_ok($$select public.app_search_activities(
  input_from:=date '2026-09-25',input_to:=date '2026-09-24')$$,
  'P0001','Invalid activity search date range','invalid range fails before searching');
select extensions.is((select count(*)::integer from jsonb_array_elements(public.app_search_activities(
  input_query:='할 일',input_from:=(clock_timestamp() at time zone 'Asia/Seoul')::date-29,
  input_to:=(clock_timestamp() at time zone 'Asia/Seoul')::date)->'items') item where item->>'record_state'='todo'),
  2,'keyword still matches tasks independent of record period');
select * from extensions.finish();
rollback;
