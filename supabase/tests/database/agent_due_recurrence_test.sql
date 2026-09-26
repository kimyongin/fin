begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(16);

select extensions.is(public.app_task_due_occurrence('daily','2026-09-01',array[]::integer[],null,time '08:00','Asia/Seoul',timestamptz '2026-09-23 22:59:59+00'),
  date '2026-09-23','before the daily local time, yesterday is latest due');
select extensions.is(public.app_task_due_occurrence('daily','2026-09-01',array[]::integer[],null,time '08:00','Asia/Seoul',timestamptz '2026-09-23 23:00:00+00'),
  date '2026-09-24','daily task becomes due exactly at local time');
select extensions.is(public.app_task_due_occurrence('weekly','2026-09-01',array[1,4],null,time '08:00','Asia/Seoul',timestamptz '2026-09-23 22:59:59+00'),
  date '2026-09-21','Monday remains latest before Thursday local time');
select extensions.is(public.app_task_due_occurrence('weekly','2026-09-01',array[1,4],null,time '08:00','Asia/Seoul',timestamptz '2026-09-23 23:00:00+00'),
  date '2026-09-24','Thursday becomes due exactly at local time');
select extensions.is(public.app_task_due_occurrence('weekly','2026-09-25',array[1,4],null,null,'Asia/Seoul',timestamptz '2026-09-24 23:00:00+00'),
  null::date,'weekly task before start is not due');
select extensions.is(public.app_task_due_occurrence('none',null,array[]::integer[],date '2026-09-25',time '08:00','Asia/Seoul',timestamptz '2026-09-24 22:59:59+00'),
  null::date,'future one-off time is not due');
select extensions.is(public.app_task_due_occurrence('none',null,array[]::integer[],date '2026-09-25',time '08:00','Asia/Seoul',timestamptz '2026-09-24 23:00:00+00'),
  date '0001-01-01','one-off time becomes due exactly at local time');
select extensions.is(public.app_task_due_occurrence('daily','2026-11-01',array[]::integer[],null,time '01:30','America/New_York',timestamptz '2026-11-01 05:30:00+00'),
  date '2026-11-01','fall-back ambiguous time is due on first local occurrence');
select extensions.is(public.app_task_due_occurrence('daily','2026-03-08',array[]::integer[],null,time '02:30','America/New_York',timestamptz '2026-03-08 07:00:00+00'),
  date '2026-03-08','spring-forward missing time is due after local clock passes it');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000009331','authenticated','authenticated','due-owner@example.com','',now(),now(),now()),
       ('00000000-0000-0000-0000-000000009332','authenticated','authenticated','due-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009331',true);
set local role authenticated;

select public.app_save_general_task(null,null,'93311111-1111-4111-8111-111111111111',jsonb_build_object(
  'title','매주 확인','subject',jsonb_build_object('kind','portfolio'),'timezone','Asia/Seoul',
  'recurrence_kind','weekly','recurrence_start_on',((clock_timestamp() at time zone 'Asia/Seoul')::date-14)::text,
  'recurrence_weekdays',jsonb_build_array(extract(isodow from clock_timestamp() at time zone 'Asia/Seoul')::integer),
  'authored_via','agent'));
select extensions.is(jsonb_array_length(public.app_list_due_general_tasks()->'items'),1,'owner due queue includes latest weekly occurrence');
select extensions.is(public.app_list_due_general_tasks() #>> '{items,0,occurrence_on}',
  ((clock_timestamp() at time zone 'Asia/Seoul')::date)::text,'queue returns one latest occurrence');
select extensions.is(public.app_list_due_general_tasks(1,0)->>'next_offset',null::text,'bounded due queue has no next page when exhausted');
select extensions.is(public.app_transition_general_task((select id from portfolio_tasks where title='매주 확인'),1,'complete','검토함',null,
  (clock_timestamp() at time zone 'Asia/Seoul')::date,'93322222-2222-4222-8222-222222222222','agent') #>> '{status}',
  'done','agent can complete the fetched due occurrence');
select extensions.is(jsonb_array_length(public.app_list_due_general_tasks()->'items'),0,'completion removes task from due queue');
select extensions.is((select count(*) from public.activity_events where action_type='complete_general_task' and title='매주 확인'),1::bigint,
  'completion creates one record');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009332',true);
select extensions.is(jsonb_array_length(public.app_list_due_general_tasks()->'items'),0,'other user cannot see owner due queue');

select * from extensions.finish();
rollback;
