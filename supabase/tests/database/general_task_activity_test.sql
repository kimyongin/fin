begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(20);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001701','authenticated','authenticated','action-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001702','authenticated','authenticated','action-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001701',true);
set local role authenticated;

select extensions.is(public.app_save_general_task(null,null,'17111111-1111-4111-8111-111111111111',jsonb_build_object(
  'title','주간 기록 확인','subject',jsonb_build_object('kind','portfolio'),'due_date',current_date::text,
  'timezone','Asia/Seoul','trigger_text','퇴근 전','authored_via','app')) #>> '{kind}','general','creates a general task');
select extensions.is(public.app_get_general_task((select id from portfolio_tasks where title='주간 기록 확인')) #>> '{status}','open','new general task is open');
select extensions.is((select count(*) from activity_events where action_type='create_general_task'),1::bigint,'task creation records one action event');
select extensions.is(public.app_save_general_task(null,null,'17111111-1111-4111-8111-111111111111',jsonb_build_object(
  'title','주간 기록 확인','subject',jsonb_build_object('kind','portfolio'),'due_date',current_date::text,
  'timezone','Asia/Seoul','trigger_text','퇴근 전','authored_via','app')) #>> '{version}','1','identical task creation retry returns the stored response');
select extensions.is((select count(*) from activity_events where action_type='create_general_task'),1::bigint,'task retry does not duplicate its event');

select extensions.is(public.app_transition_general_task((select id from portfolio_tasks where title='주간 기록 확인'),1,
  'complete','확인 완료',null,current_date,'17222222-2222-4222-8222-222222222222','app') #>> '{status}','done','open task can be completed');
select extensions.is((select count(*) from activity_events where action_type='complete_general_task' and task_id=(select id from portfolio_tasks where title='주간 기록 확인')),1::bigint,'completion has one linked event');
select extensions.is(public.app_transition_general_task((select id from portfolio_tasks where title='주간 기록 확인'),1,
  'complete','확인 완료',null,current_date,'17222222-2222-4222-8222-222222222222','app') #>> '{version}','2','completion retry returns its original response');
select extensions.is((select count(*) from activity_events where action_type='complete_general_task'),1::bigint,'completion retry is not duplicated');
select extensions.throws_ok($$select public.app_transition_general_task((select id from portfolio_tasks where title='주간 기록 확인'),1,
  'reopen',null,'다시 확인','2026-09-22','17333333-3333-4333-8333-333333333333','app')$$,
  'P0001','General task version conflict','stale task transition is rejected');
select extensions.is(public.app_transition_general_task((select id from portfolio_tasks where title='주간 기록 확인'),2,
  'reopen',null,'새 자료가 생김',current_date,'17444444-4444-4444-8444-444444444444','agent') #>> '{status}','open','a completed task can reopen without deleting completion history');
select extensions.is(jsonb_array_length(public.app_get_general_task((select id from portfolio_tasks where title='주간 기록 확인'))->'events'),3,'task detail retains create complete and reopen events');
select extensions.is(jsonb_array_length(public.app_list_general_task_page('active',20,null)->'items'),1,'active task page includes the reopened task');

select extensions.is(public.app_record_manual_activity('증권사에 문의','수수료 기준 확인',current_date::timestamptz-interval '1 day','Asia/Seoul',
  '17555555-5555-4555-8555-555555555555','agent')->>'action_type','record_manual_activity','manual off-app work can be recorded');
select extensions.is((select after_data->>'reported' from activity_events where action_type='record_manual_activity'),true::text,'manual activity remains explicitly reported');
select extensions.is(public.app_record_manual_activity('증권사에 문의','수수료 기준 확인',current_date::timestamptz-interval '1 day','Asia/Seoul',
  '17555555-5555-4555-8555-555555555555','agent')->>'action_type','record_manual_activity','manual activity retry returns the saved event');
select extensions.is((select count(*) from activity_events where action_type='record_manual_activity'),1::bigint,'manual activity retry does not duplicate the event');
select extensions.throws_ok($$select public.app_record_manual_activity('미래 행동',null,clock_timestamp()+interval '1 hour','Asia/Seoul',
  '17666666-6666-4666-8666-666666666666','app')$$,'P0001','Manual activity cannot be in the future','future manual activity is rejected');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001702',true);
select extensions.is(public.app_get_general_task((select id from portfolio_tasks where title='주간 기록 확인')),null,'another user cannot read a general task');
select extensions.is((select count(*) from activity_events),0::bigint,'another user cannot read owner events');

select * from extensions.finish();
rollback;
