create or replace function public.app_list_open_portfolio_tasks_internal(input_limit integer default 20)
returns jsonb language sql stable security definer set search_path = public as $$
    select coalesce(jsonb_agg(to_jsonb(item) order by item.updated_at desc, item.id desc), '[]'::jsonb)
    from (
        select task.id, task.kind, task.version, task.title, task.subject,
               task.due_date, task.timezone, task.trigger_text,
               task.control_state, task.research_state, task.created_at, task.updated_at,
               (select count(*)::integer from public.investment_decision_tasks link
                where link.user_id = auth.uid() and link.task_id = task.id) decision_count
        from public.portfolio_tasks task
        where task.user_id = auth.uid()
          and task.kind = 'research'
          and task.research_state in ('open', 'waiting')
          and task.control_state in ('active', 'paused')
          and not exists (
              select 1 from public.todo_items item
              where item.user_id = auth.uid() and item.task_id = task.id
          )
        order by task.updated_at desc, task.id desc
        limit greatest(1, least(coalesce(input_limit, 20), 50))
    ) item;
$$;

create or replace function public.app_create_daily_context(
    input_timezone text default 'Asia/Seoul',
    input_subject_tickers text[] default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    created_context jsonb;
    created_context_id uuid;
    enriched_snapshot jsonb;
begin
    created_context := public.app_create_daily_context_without_lifecycle(input_timezone, input_subject_tickers);
    created_context_id := (created_context ->> 'context_id')::uuid;

    update public.daily_review_contexts context
    set snapshot = jsonb_set(
        jsonb_set(
            jsonb_set(
                jsonb_set(
                    jsonb_set(
                        context.snapshot,
                        '{open_tasks}',
                        jsonb_build_object('status', 'available', 'items', public.app_list_open_portfolio_tasks_internal(20))
                    ),
                    '{todo_bundles}',
                    jsonb_build_object('status', 'available', 'items', public.app_list_todo_bundles('active', 20, null) -> 'items')
                ),
                '{decisions}',
                jsonb_build_object('status', 'available', 'items', public.app_list_investment_decisions(20, null))
            ),
            '{investment_policy}',
            coalesce(public.app_get_investment_policy() -> 'profile', 'null'::jsonb)
        ),
        '{holding_theses}',
        public.app_list_holding_theses()
    )
    where context.id = created_context_id and context.user_id = auth.uid()
    returning context.snapshot into enriched_snapshot;

    return created_context || jsonb_build_object('snapshot', enriched_snapshot);
end;
$$;

grant execute on function public.app_create_daily_context(text, text[]) to authenticated;
