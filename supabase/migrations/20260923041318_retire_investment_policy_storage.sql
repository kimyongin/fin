-- Preserve each currently stated restriction as its own owner-only principle.
-- Old snapshots do not identify individual restrictions, so do not invent
-- per-restriction history or infer removed restrictions as current.
insert into public.principles(principle_id,user_id,kind,body,effective_at)
select md5(profile.user_id::text || ':restriction:' || restriction.ordinality::text)::uuid,
       profile.user_id, restriction.item ->> 'kind', restriction.item ->> 'text',
       profile.updated_at
from public.investment_policy_profiles profile
cross join lateral jsonb_array_elements(profile.restrictions)
    with ordinality as restriction(item,ordinality)
where restriction.item ->> 'kind' in ('preference','prohibition')
  and nullif(trim(restriction.item ->> 'text'),'') is not null;

-- The current daily context already includes principles.items. Remove only
-- the transitional investment_policy copy before retiring its RPC.
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
    'recent_activity',recent_activity
  ) - 'holding_theses' - 'investment_policy'
  where context.id=created_context_id and context.user_id=auth.uid()
  returning context.snapshot into enriched_snapshot;
  return created_context||jsonb_build_object('snapshot',enriched_snapshot);
end; $$;

drop function if exists public.app_save_investment_policy(integer,uuid,jsonb,text,text);
drop function if exists public.app_get_investment_policy();
drop table if exists public.investment_policy_mutation_receipts;
drop table if exists public.investment_policy_history;
drop table if exists public.investment_policy_profiles;
