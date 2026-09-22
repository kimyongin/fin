begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(8);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001941','authenticated','authenticated','freshness-owner@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001941',true);
set local role authenticated;

select public.app_create_activity('24111111-1111-4111-8111-111111111111',jsonb_build_object(
  'title','어제 점검','result','초기 결과','occurred_at',clock_timestamp()-interval '1 day','timezone','Asia/Seoul','authored_via','app'));

select extensions.is((public.app_create_daily_context('Asia/Seoul',null)#>>'{snapshot,recent_activity,0,result}'),'초기 결과','daily context exposes current activity content');
select extensions.is(jsonb_array_length(public.app_create_daily_context('Asia/Seoul',null)#>'{snapshot,recent_activity}'),1,'daily context contains one row for one performed activity');
select extensions.is((public.app_get_activity_report_context((clock_timestamp() at time zone 'Asia/Seoul')::date-1,(clock_timestamp() at time zone 'Asia/Seoul')::date-1,'Asia/Seoul',200,null)#>>'{events,0,result}'),'초기 결과','report context exposes current activity content');

create temporary table freshness_reports(old_id uuid,new_id uuid);
insert into freshness_reports(old_id,new_id)
values(
  (public.app_save_activity_report(null,null,'24222222-2222-4222-8222-222222222222',jsonb_build_object(
    'period_kind','daily','period_start',(clock_timestamp() at time zone 'Asia/Seoul')::date-1,'period_end',(clock_timestamp() at time zone 'Asia/Seoul')::date-1,'timezone','Asia/Seoul','title','어제','summary','초기',
    'source_event_ids',jsonb_build_array((select id from activity_events where title='어제 점검')),'source_task_ids','[]'::jsonb,'source_decision_ids','[]'::jsonb))->>'id')::uuid,
  (public.app_save_activity_report(null,null,'24333333-3333-4333-8333-333333333333',jsonb_build_object(
    'period_kind','daily','period_start',(clock_timestamp() at time zone 'Asia/Seoul')::date,'period_end',(clock_timestamp() at time zone 'Asia/Seoul')::date,'timezone','Asia/Seoul','title','오늘','summary','비어 있음',
    'source_event_ids','[]'::jsonb,'source_task_ids','[]'::jsonb,'source_decision_ids','[]'::jsonb))->>'id')::uuid
);
select extensions.is(public.app_get_activity_report((select old_id from freshness_reports))->>'needs_regeneration','false','complete report starts current');
select extensions.is(public.app_get_activity_report((select new_id from freshness_reports))->>'needs_regeneration','false','empty future report starts current');

select public.app_update_activity((select id from activity_events where title='어제 점검'),1,
  '24444444-4444-4444-8444-444444444444',jsonb_build_object('result','수정 결과','occurred_at',clock_timestamp()),'app');

select extensions.is(public.app_get_activity_report((select old_id from freshness_reports))->>'needs_regeneration','true','source edit and move out marks the old period stale');
select extensions.is(public.app_get_activity_report((select new_id from freshness_reports))->>'needs_regeneration','true','moving an activity in marks the new period stale');
select extensions.is((public.app_get_activity_report_context((clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'Asia/Seoul',200,null)#>>'{events,0,result}'),'수정 결과','period context reads the edited current row once');

select * from extensions.finish();
rollback;
