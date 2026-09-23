begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(7);

select extensions.hasnt_table('public','activity_reports','parallel report table retired');
select extensions.hasnt_table('public','activity_report_revisions','report revisions retired');
select extensions.hasnt_table('public','activity_report_mutation_receipts','report receipts retired');
select extensions.has_function('public','app_get_activity_report_context',array['date','date','text','integer','jsonb'],'period source reader remains');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000009101','authenticated','authenticated','retrospective-owner@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009101',true);
set local role authenticated;
select public.app_create_activity('91000000-0000-4000-8000-000000000001','{"title":"실제 확인","body":"실제 수행"}'::jsonb);
select public.app_create_activity('91000000-0000-4000-8000-000000000002','{"title":"오늘 회고","body":"앞선 행동의 요약"}'::jsonb);
select extensions.is(jsonb_array_length(public.app_get_activity_report_context((clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'Asia/Seoul',200,null)->'events'),2,'all saved records appear; guide avoids counting a summary as new action');
select extensions.is(public.app_get_activity_report_context((clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'Asia/Seoul',200,null)#>>'{events,1,title}','실제 확인','actual activity remains a source');
select public.app_create_activity('91000000-0000-4000-8000-000000000003','{"title":"판단 활동","body":"사용자가 유지하기로 선택"}'::jsonb);
select extensions.ok(not (public.app_get_activity_report_context((clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'Asia/Seoul',200,null) ? 'decisions'),'period context no longer invents a separate decision state');

select * from extensions.finish();
rollback;
