-- Current holding reasons live in owner-only notes on instruments/holdings.
-- The prior private-note migration copied any active thesis text. The audited
-- local and production thesis tables contain no rows, so the parallel engine
-- can be retired without widening the public portfolio note DTO.

create or replace function public.app_create_daily_context_before_principles(
    input_timezone text default 'Asia/Seoul', input_subject_tickers text[] default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  created_context jsonb;
  created_context_id uuid;
  enriched_snapshot jsonb;
  recent_activity jsonb;
begin
  created_context := public.app_create_daily_context_without_lifecycle(input_timezone,input_subject_tickers);
  created_context_id := (created_context->>'context_id')::uuid;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.occurred_at desc,item.id desc),'[]'::jsonb)
  into recent_activity
  from (
    select event.id,event.source,event.action_type,event.target_table,event.target_id,event.task_id,
      event.title,event.note,event.result,event.conclusion,event.instrument_id,event.account_id,
      event.before_data,event.after_data,event.occurred_at,event.occurrence_on,event.updated_at,event.version
    from public.activity_events event
    where event.user_id=auth.uid() and event.status='succeeded'
      and event.action_type not in ('create_general_task','update_general_task')
    order by event.occurred_at desc,event.id desc
    limit 20
  ) item;

  update public.daily_review_contexts context set snapshot = context.snapshot || jsonb_build_object(
    'open_tasks',jsonb_build_object('status','available','items',public.app_list_action_timeline(null,'pending',null,null,100,null,input_timezone)->'pending'),
    'todo_bundles',jsonb_build_object('status','retired','items','[]'::jsonb),
    'decisions',jsonb_build_object('status','available','items',public.app_list_investment_decisions(20,null)),
    'investment_policy',coalesce(public.app_get_investment_policy()->'profile','null'::jsonb),
    'recent_activity',recent_activity
  ) - 'holding_theses'
  where context.id=created_context_id and context.user_id=auth.uid()
  returning context.snapshot into enriched_snapshot;
  return created_context||jsonb_build_object('snapshot',enriched_snapshot);
end; $$;

drop trigger if exists deactivate_theses_after_position_close_trigger on public.holdings;
drop function if exists public.deactivate_theses_after_position_close();
drop function if exists public.app_link_task_to_holding_thesis(uuid, uuid, integer, integer, uuid);
drop function if exists public.app_save_holding_thesis(bigint, bigint, integer, uuid, jsonb, text, text);
drop function if exists public.app_get_holding_thesis(bigint, bigint);
drop function if exists public.app_list_holding_theses();
drop function if exists public.app_get_holding_thesis_base(bigint, bigint);
drop function if exists public.app_list_holding_theses_base();

drop table if exists public.holding_thesis_task_receipts;
drop table if exists public.holding_thesis_tasks;
drop table if exists public.holding_thesis_mutation_receipts;
drop table if exists public.holding_thesis_history;
drop table if exists public.holding_theses;
