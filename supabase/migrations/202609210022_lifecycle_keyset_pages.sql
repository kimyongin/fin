create function public.app_list_portfolio_task_page(
  input_owner_user_id uuid default null,
  input_filter text default 'active',
  input_limit integer default 20,
  input_cursor jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  selected_owner uuid := coalesce(input_owner_user_id, auth.uid());
  normalized_filter text := lower(trim(coalesce(input_filter, 'active')));
  page_limit integer := greatest(1, least(coalesce(input_limit, 20), 50));
  cursor_updated_at timestamptz;
  cursor_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if normalized_filter not in ('active', 'paused', 'closed', 'all') then raise exception 'Invalid task filter'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor) <> 'object' or not (input_cursor ? 'updated_at') or not (input_cursor ? 'id') then
      raise exception 'Invalid task cursor';
    end if;
    cursor_updated_at := (input_cursor ->> 'updated_at')::timestamptz;
    cursor_id := (input_cursor ->> 'id')::uuid;
  end if;
  if selected_owner <> auth.uid() and not public.can_view_feature(selected_owner, 'tasks') then
    return jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null);
  end if;

  return (
    with task_rows as (
      select
        task.id, task.kind, task.version, task.title, task.subject, task.due_date,
        task.timezone, task.trigger_text, task.control_state, task.research_state,
        task.created_at, task.updated_at,
        case when task.kind = 'execution' then jsonb_build_object(
          'account_id', plan.account_id,
          'instrument_id', plan.instrument_id,
          'side', plan.side,
          'target_quantity', plan.target_quantity,
          'filled_quantity', coalesce(fills.filled_quantity, 0),
          'remaining_quantity', greatest(plan.target_quantity - coalesce(fills.filled_quantity, 0), 0),
          'overfilled_quantity', greatest(coalesce(fills.filled_quantity, 0) - plan.target_quantity, 0),
          'progress', case
            when coalesce(fills.filled_quantity, 0) = 0 then 'planned'
            when coalesce(fills.filled_quantity, 0) < plan.target_quantity then 'partial'
            else 'completed'
          end
        ) else null end as execution_plan,
        case
          when selected_owner = auth.uid() or public.can_view_feature(selected_owner, 'decisions')
          then (select count(*)::integer from public.investment_decision_tasks link where link.user_id = selected_owner and link.task_id = task.id)
          else 0
        end as decision_count
      from public.portfolio_tasks task
      left join public.execution_plans plan
        on plan.user_id = task.user_id and plan.task_id = task.id
      left join lateral (
        select sum(entry.quantity) as filled_quantity
        from public.task_fill_links link
        join public.trade_entries entry
          on entry.user_id = link.user_id and entry.id = link.trade_entry_id
        where link.user_id = selected_owner
          and link.task_id = task.id
          and entry.reversed_at is null
      ) fills on true
      where task.user_id = selected_owner
    ),
    filtered as (
      select row.*
      from task_rows row
      where (
        normalized_filter = 'all'
        or (normalized_filter = 'paused' and row.control_state = 'paused')
        or (normalized_filter = 'active' and row.control_state = 'active' and (
          (row.kind = 'research' and row.research_state in ('open', 'waiting'))
          or (row.kind = 'execution' and row.execution_plan ->> 'progress' in ('planned', 'partial'))
        ))
        or (normalized_filter = 'closed' and (
          row.control_state = 'cancelled'
          or (row.kind = 'research' and row.research_state in ('resolved', 'closed'))
          or (row.kind = 'execution' and row.execution_plan ->> 'progress' = 'completed')
        ))
      )
      and (cursor_updated_at is null or (row.updated_at, row.id) < (cursor_updated_at, cursor_id))
      order by row.updated_at desc, row.id desc
      limit page_limit + 1
    ),
    page as (
      select * from filtered order by updated_at desc, id desc limit page_limit
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(item) order by item.updated_at desc, item.id desc) from page item), '[]'::jsonb),
      'next_cursor', case when (select count(*) from filtered) > page_limit then (
        select jsonb_build_object('updated_at', item.updated_at, 'id', item.id)
        from page item order by item.updated_at, item.id limit 1
      ) else null end
    )
  );
end;
$$;

create function public.app_list_investment_decision_page(
  input_owner_user_id uuid default null,
  input_filter text default 'current',
  input_limit integer default 20,
  input_cursor jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  selected_owner uuid := coalesce(input_owner_user_id, auth.uid());
  normalized_filter text := lower(trim(coalesce(input_filter, 'current')));
  page_limit integer := greatest(1, least(coalesce(input_limit, 20), 50));
  cursor_updated_at timestamptz;
  cursor_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if normalized_filter not in ('current', 'closed', 'all') then raise exception 'Invalid decision filter'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor) <> 'object' or not (input_cursor ? 'updated_at') or not (input_cursor ? 'id') then
      raise exception 'Invalid decision cursor';
    end if;
    cursor_updated_at := (input_cursor ->> 'updated_at')::timestamptz;
    cursor_id := (input_cursor ->> 'id')::uuid;
  end if;
  if selected_owner <> auth.uid() and not public.can_view_feature(selected_owner, 'decisions') then
    return jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null);
  end if;

  return (
    with filtered as (
      select
        decision.id, decision.version, decision.status, decision.subject,
        decision.question, decision.options, decision.selected_option, decision.reason,
        decision.uncertainty, decision.review_condition, decision.created_at, decision.updated_at,
        case
          when selected_owner = auth.uid() or public.can_view_feature(selected_owner, 'tasks')
          then (select count(*)::integer from public.investment_decision_tasks link where link.user_id = selected_owner and link.decision_id = decision.id)
          else 0
        end as task_count
      from public.investment_decisions decision
      where decision.user_id = selected_owner
        and (
          normalized_filter = 'all'
          or (normalized_filter = 'current' and decision.status in ('proposed', 'adopted'))
          or (normalized_filter = 'closed' and decision.status in ('dismissed', 'superseded'))
        )
        and (cursor_updated_at is null or (decision.updated_at, decision.id) < (cursor_updated_at, cursor_id))
      order by decision.updated_at desc, decision.id desc
      limit page_limit + 1
    ),
    page as (
      select * from filtered order by updated_at desc, id desc limit page_limit
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(item) order by item.updated_at desc, item.id desc) from page item), '[]'::jsonb),
      'next_cursor', case when (select count(*) from filtered) > page_limit then (
        select jsonb_build_object('updated_at', item.updated_at, 'id', item.id)
        from page item order by item.updated_at, item.id limit 1
      ) else null end
    )
  );
end;
$$;

create or replace function public.app_get_portfolio_task_for_owner(input_owner_user_id uuid, input_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when input_owner_user_id = auth.uid() then public.app_get_portfolio_task(input_task_id)
    when public.can_view_feature(input_owner_user_id, 'tasks') then (
      select to_jsonb(item)
      from (
        select
          task.id, task.kind, task.version, task.title, task.subject, task.due_date,
          task.timezone, task.trigger_text, task.control_state, task.research_state,
          task.created_at, task.updated_at,
          case when task.kind = 'execution' then (
            select jsonb_build_object(
              'account_id', plan.account_id, 'instrument_id', plan.instrument_id,
              'side', plan.side, 'target_quantity', plan.target_quantity,
              'filled_quantity', coalesce(sum(entry.quantity) filter (where entry.reversed_at is null), 0),
              'progress', case
                when coalesce(sum(entry.quantity) filter (where entry.reversed_at is null), 0) = 0 then 'planned'
                when coalesce(sum(entry.quantity) filter (where entry.reversed_at is null), 0) < plan.target_quantity then 'partial'
                else 'completed'
              end
            )
            from public.execution_plans plan
            left join public.task_fill_links link on link.user_id = plan.user_id and link.task_id = plan.task_id
            left join public.trade_entries entry on entry.user_id = link.user_id and entry.id = link.trade_entry_id
            where plan.user_id = input_owner_user_id and plan.task_id = task.id
            group by plan.account_id, plan.instrument_id, plan.side, plan.target_quantity
          ) else null end as execution_plan,
          '[]'::jsonb as history,
          case when public.can_view_feature(input_owner_user_id, 'decisions') then coalesce((
            select jsonb_agg(link.decision_id order by link.created_at, link.decision_id)
            from public.investment_decision_tasks link
            where link.user_id = input_owner_user_id and link.task_id = task.id
          ), '[]'::jsonb) else '[]'::jsonb end as decision_ids
        from public.portfolio_tasks task
        where task.user_id = input_owner_user_id and task.id = input_task_id
      ) item
    )
    else null
  end;
$$;

revoke all on function public.app_list_portfolio_task_page(uuid, text, integer, jsonb) from public, anon;
revoke all on function public.app_list_investment_decision_page(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.app_list_portfolio_task_page(uuid, text, integer, jsonb) to authenticated;
grant execute on function public.app_list_investment_decision_page(uuid, text, integer, jsonb) to authenticated;
