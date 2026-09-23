begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(14);

select extensions.hasnt_table('public','daily_review_contexts','stored daily contexts retired');
select extensions.hasnt_table('public','daily_briefings','briefing aggregate retired');
select extensions.hasnt_table('public','daily_briefing_evidence','briefing evidence retired');
select extensions.hasnt_table('public','daily_briefing_scopes','briefing scopes retired');
select extensions.hasnt_table('public','daily_briefing_scope_sources','briefing source links retired');
select extensions.hasnt_table('public','daily_briefing_scope_evidence','briefing evidence links retired');
select extensions.hasnt_table('public','daily_review_mutation_receipts','briefing receipts retired');
select extensions.hasnt_function('public','app_create_daily_context',array['text','text[]'],'stored context writer retired');
select extensions.hasnt_function('public','app_save_daily_briefing',array['uuid','uuid','jsonb'],'old briefing writer retired');
select extensions.hasnt_function('public','app_get_daily_briefing',array['uuid'],'old briefing detail retired');
select extensions.hasnt_function('public','app_list_daily_briefing_page',array['uuid','integer','jsonb'],'old briefing page retired');
select extensions.hasnt_function('public','app_list_briefing_related_tasks',array['uuid','uuid','integer'],'old relation read retired');
select extensions.has_function('public','app_get_daily_context',array['text','text[]'],'read-only current context remains');
select extensions.has_function('public','app_list_narrative_activities',array['text','uuid','integer','jsonb'],'saved review activity read remains');

select * from extensions.finish();
rollback;
