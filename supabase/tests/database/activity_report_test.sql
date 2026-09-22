begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(13);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001901','authenticated','authenticated','report-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001902','authenticated','authenticated','report-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001901',true);
set local role authenticated;
select public.app_record_manual_activity('리포트 원본 행동','확인',clock_timestamp(), 'Asia/Seoul','19111111-1111-4111-8111-111111111111','app');
create temporary table report_source_event as select id from activity_events where action_type='record_manual_activity';

select extensions.is(jsonb_array_length(public.app_get_activity_report_context((clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'Asia/Seoul',200,null)->'events'),1,'context returns period source events');
select extensions.is(public.app_get_activity_report_context((clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'Asia/Seoul',200,null)->>'current_open_tasks_basis','current_at_request_not_historical_period_end','context labels current pending snapshot honestly');

create temporary table saved_report as select public.app_save_activity_report(null,null,'19222222-2222-4222-8222-222222222222',jsonb_build_object(
  'period_kind','daily','period_start',(clock_timestamp() at time zone 'Asia/Seoul')::date,'period_end',(clock_timestamp() at time zone 'Asia/Seoul')::date,'timezone','Asia/Seoul','title','오늘 행동 리포트','summary','한 가지 행동을 확인했다.',
  'highlights',jsonb_build_array('확인'),'open_items','[]'::jsonb,'source_event_ids',jsonb_build_array((select id from activity_events where action_type='record_manual_activity')),
  'source_task_ids','[]'::jsonb,'source_decision_ids','[]'::jsonb)) payload;
select extensions.is((select payload->>'version' from saved_report),'1','report is saved at version one');
select extensions.is((select payload->>'needs_regeneration' from saved_report),'false','complete source coverage is current');
select extensions.is((select count(*) from activity_report_revisions),1::bigint,'save preserves a revision snapshot');
select extensions.is((select count(*) from activity_events where action_type like '%report%'),0::bigint,'saving a report does not inflate action history');
select extensions.is(jsonb_array_length(public.app_list_activity_reports(20,null)->'items'),1,'saved reports are listed');
select extensions.is((public.app_save_activity_report(null,null,'19222222-2222-4222-8222-222222222222',jsonb_build_object(
  'period_kind','daily','period_start',(clock_timestamp() at time zone 'Asia/Seoul')::date,'period_end',(clock_timestamp() at time zone 'Asia/Seoul')::date,'timezone','Asia/Seoul','title','오늘 행동 리포트','summary','한 가지 행동을 확인했다.',
  'highlights',jsonb_build_array('확인'),'open_items','[]'::jsonb,'source_event_ids',jsonb_build_array((select id from activity_events where action_type='record_manual_activity')),
  'source_task_ids','[]'::jsonb,'source_decision_ids','[]'::jsonb))->>'version'),'1','idempotent retry returns the original report');
select public.app_record_manual_activity('뒤늦은 같은 날 행동',null,clock_timestamp(),'Asia/Seoul','19333333-3333-4333-8333-333333333333','app');
select extensions.is(public.app_get_activity_report((select (payload->>'id')::uuid from saved_report))->>'needs_regeneration','true','new in-period event marks the report stale');
select extensions.throws_ok($$select public.app_save_activity_report(null,null,'19444444-4444-4444-8444-444444444444','{"period_kind":"daily","period_start":"2026-09-21","period_end":"2026-09-22","timezone":"Asia/Seoul","title":"bad","summary":"bad","source_event_ids":[],"source_task_ids":[],"source_decision_ids":[]}'::jsonb)$$,'P0001','Report period does not match its kind','period kind is validated');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001902',true);
select extensions.is(public.app_get_activity_report((select (payload->>'id')::uuid from saved_report)),null,'another user cannot read the report');
select extensions.is(jsonb_array_length(public.app_list_activity_reports(20,null)->'items'),0,'another user sees no reports');
select extensions.throws_ok(format($sql$select public.app_save_activity_report(null,null,'19555555-5555-4555-8555-555555555555',jsonb_build_object('period_kind','daily','period_start',(clock_timestamp() at time zone 'Asia/Seoul')::date,'period_end',(clock_timestamp() at time zone 'Asia/Seoul')::date,'timezone','Asia/Seoul','title','침범','summary','침범','source_event_ids',jsonb_build_array(%s),'source_task_ids','[]'::jsonb,'source_decision_ids','[]'::jsonb))$sql$,(select id from report_source_event limit 1)),'P0001','Report source event is invalid','foreign source IDs are rejected');

select * from extensions.finish();
rollback;
