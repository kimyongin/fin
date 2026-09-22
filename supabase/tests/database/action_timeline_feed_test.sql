begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(12);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001801','authenticated','authenticated','timeline-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001802','authenticated','authenticated','timeline-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001801',true);
set local role authenticated;

select public.app_save_general_task(null,null,'18111111-1111-4111-8111-111111111111',jsonb_build_object(
  'title','미완료 일반 과제','subject',jsonb_build_object('kind','portfolio'),'timezone','Asia/Seoul','authored_via','app'));
select public.app_save_general_task(null,null,'18222222-2222-4222-8222-222222222222',jsonb_build_object(
  'title','완료할 일반 과제','subject',jsonb_build_object('kind','portfolio'),'timezone','Asia/Seoul','authored_via','app'));
select public.app_transition_general_task((select id from portfolio_tasks where title='완료할 일반 과제'),1,'complete','끝냄',null,current_date,
  '18333333-3333-4333-8333-333333333333','app');
select public.app_record_manual_activity('앱 밖 행동','결과',clock_timestamp()-interval '1 day','Asia/Seoul',
  '18444444-4444-4444-8444-444444444444','app');

select extensions.is(jsonb_array_length(public.app_list_action_timeline(null,'all',null,null,30,null,'Asia/Seoul')->'pending'),1,'all view keeps only unfinished general work in pending');
select extensions.is((public.app_list_action_timeline(null,'all',null,null,30,null,'Asia/Seoul') #>> '{pending,0,title}'),'미완료 일반 과제','pending work is ordered and named');
select extensions.is((select count(*)::integer from jsonb_array_elements(public.app_list_action_timeline(null,'all',null,null,30,null,'Asia/Seoul')->'days') day, jsonb_array_elements(day->'items') item where item->>'action_type'='complete_general_task'),1,'task completion has one representative event');
select extensions.is((select count(*)::integer from jsonb_array_elements(public.app_list_action_timeline(null,'all',null,null,30,null,'Asia/Seoul')->'days') day, jsonb_array_elements(day->'items') item where item->>'action_type' in ('create_general_task','update_general_task')),0,'task setup events do not duplicate the top-level feed');
select extensions.is(jsonb_array_length(public.app_list_action_timeline(null,'pending',null,null,30,null,'Asia/Seoul')->'days'),0,'pending filter omits performed events');
select extensions.is(jsonb_array_length(public.app_list_action_timeline(null,'done',null,null,30,null,'Asia/Seoul')->'pending'),0,'done filter omits pending work');
select extensions.is(jsonb_array_length(public.app_list_action_timeline(null,'done',current_date,current_date,30,null,'Asia/Seoul')->'days'),1,'date range is applied before grouping');
select extensions.is((select item->>'category' from jsonb_array_elements(public.app_list_action_timeline(null,'done',current_date,current_date,30,null,'Asia/Seoul')->'days') day, jsonb_array_elements(day->'items') item where item->>'action_type'='complete_general_task'),'완료','completion has an explicit text category');
select extensions.ok((public.app_list_action_timeline(null,'all',null,null,1,null,'Asia/Seoul')->'next_cursor') is not null,'bounded event page returns a cursor');
select extensions.throws_ok($$select public.app_list_action_timeline(null,'all',null,null,30,'{"id":"bad"}'::jsonb,'Asia/Seoul')$$,'P0001','Invalid action timeline cursor','malformed cursor fails closed');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001802',true);
select extensions.is(jsonb_array_length(public.app_list_action_timeline('00000000-0000-0000-0000-000000001801','all',null,null,30,null,'Asia/Seoul')->'pending'),0,'unshared tasks stay private');
select extensions.is(jsonb_array_length(public.app_list_action_timeline('00000000-0000-0000-0000-000000001801','all',null,null,30,null,'Asia/Seoul')->'days'),0,'unshared activity stays private');

select * from extensions.finish();
rollback;
