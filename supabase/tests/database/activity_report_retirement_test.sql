begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(4);

select extensions.hasnt_table('public','activity_reports','parallel report table retired');
select extensions.hasnt_table('public','activity_report_revisions','report revisions retired');
select extensions.hasnt_table('public','activity_report_mutation_receipts','report receipts retired');
select extensions.has_function('public','app_get_activity_report_context',array['date','date','text','integer','jsonb'],'period source reader remains');

select * from extensions.finish();
rollback;
