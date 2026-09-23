-- The current decision source is activity_events(record_kind='decision').
-- Only general tasks are served to the web and OAuth MCP. Existing legacy
-- investment rows may be discarded under the 2026-09-23 product decision.
create or replace function public.set_activity_current_content()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.title := coalesce(new.title, nullif(trim(coalesce(new.after_data ->> 'title', new.after_data ->> 'question', '')), ''));
    new.note := coalesce(new.note, nullif(trim(coalesce(new.after_data ->> 'note', '')), ''));
    new.result := coalesce(new.result, nullif(trim(coalesce(new.after_data ->> 'result', new.after_data ->> 'answer', '')), ''));
    new.conclusion := coalesce(new.conclusion, nullif(trim(coalesce(new.after_data ->> 'conclusion', new.after_data ->> 'selected_option', new.after_data ->> 'reason', '')), ''));
    new.updated_at := coalesce(new.updated_at, new.created_at, clock_timestamp());
    return new;
end;
$$;

drop trigger if exists log_execution_task_transition_activity_trigger on public.portfolio_task_history;
drop trigger if exists log_task_fill_activity_trigger on public.task_fill_links;
drop function if exists public.log_execution_task_transition_activity();
drop function if exists public.log_task_fill_activity();

drop function if exists public.app_get_investment_decision_for_owner(uuid,uuid);
drop function if exists public.app_get_investment_decision(uuid);
drop function if exists public.app_list_investment_decision_page(uuid,text,integer,jsonb);
drop function if exists public.app_list_investment_decisions_for_owner(uuid,integer,timestamptz);
drop function if exists public.app_list_investment_decisions(integer,timestamptz);
drop function if exists public.app_record_investment_decision(uuid,jsonb);
drop function if exists public.app_transition_investment_decision(uuid,integer,uuid,jsonb);

drop function if exists public.app_get_portfolio_task_for_owner(uuid,uuid);
drop function if exists public.app_get_portfolio_task(uuid);
drop function if exists public.app_get_portfolio_task_base(uuid);
drop function if exists public.app_list_portfolio_task_page(uuid,text,integer,jsonb);
drop function if exists public.app_list_portfolio_tasks_for_owner(uuid,text,integer,timestamptz);
drop function if exists public.app_list_portfolio_tasks(text,integer,timestamptz);
drop function if exists public.app_list_portfolio_tasks_base(text,integer,timestamptz);
drop function if exists public.app_list_open_portfolio_tasks_internal(integer);
drop function if exists public.app_transition_portfolio_task(uuid,integer,uuid,jsonb);

drop function if exists public.app_execution_plan_summary(uuid);
drop function if exists public.app_link_trade_to_task(uuid,uuid,integer,uuid,text);
drop function if exists public.app_save_execution_task(integer,uuid,jsonb);
drop function if exists public.app_transition_execution_task(uuid,integer,text,text,uuid,text);

drop table if exists public.investment_decision_tasks;
drop table if exists public.investment_decision_state_history;
drop table if exists public.investment_decisions;
drop table if exists public.portfolio_task_evidence;
drop table if exists public.task_fill_links;
drop table if exists public.execution_plans;
drop table if exists public.decision_task_mutation_receipts;
