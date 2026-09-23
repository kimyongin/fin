begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(6);

select extensions.hasnt_table('public','activity_reports','parallel report table retired');
select extensions.hasnt_table('public','activity_report_revisions','report revisions retired');
select extensions.hasnt_table('public','activity_report_mutation_receipts','report receipts retired');
select extensions.has_function('public','app_get_activity_report_context',array['date','date','text','integer','jsonb'],'period source reader remains');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000009101','authenticated','authenticated','retrospective-owner@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009101',true);
set local role authenticated;
select public.app_create_activity('91000000-0000-4000-8000-000000000001','{"title":"실제 확인","category":"general"}'::jsonb);
select public.app_create_activity('91000000-0000-4000-8000-000000000002','{"title":"오늘 회고","category":"retrospective"}'::jsonb);
select extensions.is(jsonb_array_length(public.app_get_activity_report_context((clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'Asia/Seoul',200,null)->'events'),1,'retrospective is not counted as a source action');
select extensions.is(public.app_get_activity_report_context((clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date,'Asia/Seoul',200,null)#>>'{events,0,title}','실제 확인','actual activity remains a source');

select * from extensions.finish();
rollback;
