-- The bundle UI and MCP write path were retired in favour of portfolio_tasks
-- and activity_events. The former migration already mapped legacy items into
-- those records; this removes the obsolete parallel storage and APIs.

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
        order by task.updated_at desc, task.id desc
        limit greatest(1, least(coalesce(input_limit, 20), 50))
    ) item;
$$;

drop function if exists public.app_list_todo_migration_map();
drop function if exists public.app_list_todo_linked_task_ids();
drop function if exists public.app_save_todo_bundle(uuid, integer, uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text);
drop function if exists public.app_list_todo_bundles(text, integer, jsonb);
drop function if exists public.app_get_todo_bundle(uuid);
drop function if exists public.app_todo_bundle_status(uuid);
drop function if exists public.app_todo_item_json(public.todo_items);

drop table if exists public.todo_item_action_migrations;
drop table if exists public.todo_bundle_mutation_receipts;
drop table if exists public.todo_bundle_verification_links;
drop table if exists public.todo_bundle_decision_links;
drop table if exists public.todo_bundle_rule_links;
drop table if exists public.todo_items;
drop table if exists public.todo_bundles;
