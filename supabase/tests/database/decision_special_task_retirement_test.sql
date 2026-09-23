begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(16);

select extensions.hasnt_table('public','investment_decisions','parallel decision source retired');
select extensions.hasnt_table('public','investment_decision_state_history','decision transition history retired');
select extensions.hasnt_table('public','investment_decision_tasks','decision-task join retired');
select extensions.hasnt_table('public','portfolio_task_evidence','special research evidence retired');
select extensions.hasnt_table('public','execution_plans','quantity plans retired');
select extensions.hasnt_table('public','task_fill_links','planned-fill mapping retired');
select extensions.hasnt_table('public','decision_task_mutation_receipts','special-task receipts retired');
select extensions.hasnt_function('public','app_record_investment_decision',array['uuid','jsonb'],'old decision writer retired');
select extensions.hasnt_function('public','app_transition_investment_decision',array['uuid','integer','uuid','jsonb'],'old transition writer retired');
select extensions.hasnt_function('public','app_save_execution_task',array['integer','uuid','jsonb'],'quantity-plan writer retired');
select extensions.hasnt_function('public','app_list_portfolio_task_page',array['uuid','text','integer','jsonb'],'old task page retired');
select extensions.has_function('public','app_get_general_task',array['uuid'],'current general task detail remains');
select extensions.has_function('public','app_list_narrative_activities',array['text','uuid','integer','jsonb'],'decision activity page remains');
select extensions.ok((select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.portfolio_tasks'::regclass and conname='portfolio_tasks_kind_check') like '%kind = ''general''%','new tasks can only be general');
select extensions.ok((select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.portfolio_tasks'::regclass and conname='portfolio_tasks_control_state_check') like '%cancelled%','only active/cancelled control states remain');
select extensions.is((select count(*) from public.portfolio_tasks where kind <> 'general'),0::bigint,'retired task rows are absent');

select * from extensions.finish();
rollback;
