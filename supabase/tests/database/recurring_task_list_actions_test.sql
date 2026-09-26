begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(13);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000009443','authenticated','authenticated','repeat-list-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000009444','authenticated','authenticated','repeat-list-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009443',true);
set local role authenticated;

select public.app_save_general_task(null,null,'94411111-1111-4111-8111-111111111111',jsonb_build_object(
  'title','반복 목록 점검','subject',jsonb_build_object('kind','portfolio'),'timezone','Asia/Seoul',
  'recurrence_kind','daily','recurrence_start_on',((clock_timestamp() at time zone 'Asia/Seoul')::date-2)::text,'authored_via','app'));
select public.app_save_general_task(null,null,'94422222-2222-4222-8222-222222222222',jsonb_build_object(
  'title','미래 반복 점검','subject',jsonb_build_object('kind','portfolio'),'timezone','Asia/Seoul',
  'recurrence_kind','daily','recurrence_start_on',((clock_timestamp() at time zone 'Asia/Seoul')::date+2)::text,'authored_via','app'));

select extensions.is((select item->>'status' from jsonb_array_elements(public.app_list_action_timeline()->'pending') item
  where item->>'title'='반복 목록 점검'),'open','due recurring task is open in the web list');
select extensions.is((select item->>'status' from jsonb_array_elements(public.app_list_action_timeline()->'pending') item
  where item->>'title'='미래 반복 점검'),'not_scheduled','future recurring task remains stoppable in the web list');
select extensions.is((select item->>'task_status' from jsonb_array_elements(public.app_search_activities(input_query=>'미래 반복 점검')->'items') item
  where item->>'record_type'='task'),'not_scheduled','search includes the future recurring task state');
select extensions.is(jsonb_array_length(public.app_list_due_general_tasks()->'items'),1,'agent queue excludes future recurring task');

select public.app_transition_general_task((select id from portfolio_tasks where title='반복 목록 점검'),1,'complete',null,null,
  (clock_timestamp() at time zone 'Asia/Seoul')::date,'94433333-3333-4333-8333-333333333333','app');
select extensions.is((select item->>'status' from jsonb_array_elements(public.app_list_action_timeline()->'pending') item
  where item->>'title'='반복 목록 점검'),'done','completed occurrence keeps recurring definition visible');
select extensions.is((select item->>'task_status' from jsonb_array_elements(public.app_search_activities(input_query=>'반복 목록 점검')->'items') item
  where item->>'record_type'='task'),'done','search keeps the completed recurring definition visible');
select extensions.is((select count(*)::integer from jsonb_array_elements(public.app_search_activities(input_query=>'반복 목록 점검')->'items') item
  where item->>'record_type'='task'),1,'one active recurring definition appears once in search');
select extensions.is(jsonb_array_length(public.app_list_due_general_tasks()->'items'),0,'agent queue still excludes completed occurrence');
select extensions.is((select count(*)::integer from activity_events where title='반복 목록 점검' and action_type='complete_general_task'),1,
  'completed occurrence has one activity record');

select public.app_transition_general_task((select id from portfolio_tasks where title='반복 목록 점검'),2,'cancel',null,'사용자가 반복 중단',null,
  '94444444-4444-4444-8444-444444444444','app');
select extensions.is((select count(*)::integer from jsonb_array_elements(public.app_list_action_timeline()->'pending') item
  where item->>'title'='반복 목록 점검'),0,'stopped recurring task leaves the web list');
select extensions.is((select count(*)::integer from jsonb_array_elements(public.app_search_activities(input_query=>'반복 목록 점검')->'items') item
  where item->>'record_type'='task'),0,'stopped recurring task leaves todo search');
select extensions.is((select count(*)::integer from activity_events where title='반복 목록 점검' and action_type='complete_general_task'),1,
  'stopping preserves the completed record');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009444',true);
select extensions.is(jsonb_array_length(public.app_list_action_timeline(input_owner_user_id=>'00000000-0000-0000-0000-000000009443')->'pending'),0,
  'unshared recurring tasks remain private');

select * from extensions.finish();
rollback;
