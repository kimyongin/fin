begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(21);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001711','authenticated','authenticated','recurring-owner@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001711',true);
set local role authenticated;

select extensions.is(public.app_save_general_task(null,null,'18111111-1111-4111-8111-111111111111',jsonb_build_object(
  'title','매일 잔고 확인','subject',jsonb_build_object('kind','portfolio'),'timezone','Asia/Seoul',
  'recurrence_kind','daily','recurrence_start_on',((clock_timestamp() at time zone 'Asia/Seoul')::date-1)::text,'authored_via','app')) #>> '{recurrence_kind}',
  'daily','creates one daily recurring task row');
select extensions.is((select count(*) from portfolio_tasks where title='매일 잔고 확인'),1::bigint,'recurrence does not materialize occurrence rows');
select extensions.is(public.app_get_general_task((select id from portfolio_tasks where title='매일 잔고 확인')) #>> '{status}','open','today starts open');
select extensions.is(public.app_get_general_task((select id from portfolio_tasks where title='매일 잔고 확인')) #>> '{occurrence_on}',
  ((clock_timestamp() at time zone 'Asia/Seoul')::date)::text,'detail returns the user-local occurrence date');

select extensions.is(public.app_transition_general_task((select id from portfolio_tasks where title='매일 잔고 확인'),1,'complete','어제 확인',null,
  (clock_timestamp() at time zone 'Asia/Seoul')::date-1,'18222222-2222-4222-8222-222222222222','app') #>> '{status}','open',
  'late completion of yesterday leaves today open');
select extensions.is((select status from general_task_occurrence_states where task_id=(select id from portfolio_tasks where title='매일 잔고 확인')
  and occurrence_on=(clock_timestamp() at time zone 'Asia/Seoul')::date-1),'done','yesterday occurrence is done');
select extensions.is((select count(*) from activity_events where action_type='complete_general_task' and occurrence_on=(clock_timestamp() at time zone 'Asia/Seoul')::date-1),1::bigint,
  'late completion has one dated event');

select extensions.is(public.app_transition_general_task((select id from portfolio_tasks where title='매일 잔고 확인'),2,'complete','오늘 확인',null,
  null,'18333333-3333-4333-8333-333333333333','agent') #>> '{status}','done','today can be completed');
select extensions.is(coalesce((select status from general_task_occurrence_states where task_id=(select id from portfolio_tasks where title='매일 잔고 확인')
  and occurrence_on=(clock_timestamp() at time zone 'Asia/Seoul')::date+1),'open'),'open','tomorrow remains a new open occurrence without a row');
select extensions.throws_ok($$select public.app_transition_general_task((select id from portfolio_tasks where title='매일 잔고 확인'),3,'complete',null,null,
  null,'18444444-4444-4444-8444-444444444444','app')$$,'P0001','Only an open general task occurrence can be completed','same occurrence cannot complete twice');
select extensions.throws_ok($$select public.app_transition_general_task((select id from portfolio_tasks where title='매일 잔고 확인'),3,'complete',null,null,
  (clock_timestamp() at time zone 'Asia/Seoul')::date+1,'18555555-5555-4555-8555-555555555555','app')$$,
  'P0001','A general task occurrence cannot be completed in the future','future occurrence completion is rejected');

select extensions.is(public.app_transition_general_task((select id from portfolio_tasks where title='매일 잔고 확인'),3,'reopen',null,'잘못 체크함',
  null,'18666666-6666-4666-8666-666666666666','app') #>> '{status}','open','today completion can be reopened');
select extensions.is(public.app_transition_general_task((select id from portfolio_tasks where title='매일 잔고 확인'),4,'complete','다시 확인',null,
  null,'18777777-7777-4777-8777-777777777777','app') #>> '{status}','done','reopened occurrence can complete again');
select extensions.is((select count(*) from activity_events where task_id=(select id from portfolio_tasks where title='매일 잔고 확인')
  and occurrence_on=(clock_timestamp() at time zone 'Asia/Seoul')::date and action_type='complete_general_task'),2::bigint,'correction history preserves both completion facts');

select extensions.throws_ok($$select public.app_transition_general_task((select id from portfolio_tasks where title='매일 잔고 확인'),5,'pause',null,null,
  null,'18888888-8888-4888-8888-888888888888','app')$$,'P0001','Invalid general task transition','new pause calls are rejected');
select extensions.throws_ok($$select public.app_transition_general_task((select id from portfolio_tasks where title='매일 잔고 확인'),5,'resume',null,null,
  null,'18999999-9999-4999-8999-999999999999','app')$$,'P0001','Invalid general task transition','new resume calls are rejected');
select extensions.is((select count(*) from activity_events where task_id=(select id from portfolio_tasks where title='매일 잔고 확인') and occurrence_on is null
  and action_type in ('pause_general_task','resume_general_task')),0::bigint,'retired control transitions create no activity');
select extensions.is(jsonb_array_length(public.app_list_general_task_page('completed',20,null)->'items'),1,'completed filter uses the current local occurrence');
select extensions.is(public.app_transition_general_task((select id from portfolio_tasks where title='매일 잔고 확인'),5,'cancel',null,'사용자가 반복 종료',
  null,'18aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','app') #>> '{status}','cancelled','ending recurrence closes future appearances');
select extensions.is((select count(*) from activity_events where task_id=(select id from portfolio_tasks where title='매일 잔고 확인')
  and action_type='complete_general_task'),3::bigint,'ending recurrence preserves earlier completions without inventing another');
select extensions.is((select count(*) from general_task_occurrence_states where task_id=(select id from portfolio_tasks where title='매일 잔고 확인')
  and occurrence_on>(clock_timestamp() at time zone 'Asia/Seoul')::date),0::bigint,'ending recurrence does not materialize future dates');

select * from extensions.finish();
rollback;
