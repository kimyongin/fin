begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(13);

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

select * from extensions.finish();
rollback;
