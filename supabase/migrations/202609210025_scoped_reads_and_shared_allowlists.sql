create function public.app_list_briefing_related_tasks(
  input_briefing_id uuid,
  input_owner_user_id uuid default null,
  input_limit integer default 3
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  selected_owner uuid := coalesce(input_owner_user_id, auth.uid());
  page_limit integer := greatest(1, least(coalesce(input_limit, 3), 20));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if selected_owner <> auth.uid() and not (
    public.can_view_feature(selected_owner, 'briefings')
    and public.can_view_feature(selected_owner, 'decisions')
    and public.can_view_feature(selected_owner, 'tasks')
  ) then
    return jsonb_build_object('status', 'forbidden', 'items', '[]'::jsonb);
  end if;
  if not exists (
    select 1 from public.daily_briefings
    where user_id = selected_owner and id = input_briefing_id
  ) then
    return jsonb_build_object('status', 'not_found', 'items', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.state_rank, item.due_date nulls last, item.updated_at desc, item.id desc)
      from (
        select * from (
          select distinct on (task.id)
          task.id, task.kind, task.version, task.title, task.subject, task.due_date,
          task.timezone, task.trigger_text, task.control_state, task.research_state,
          task.created_at, task.updated_at,
          case
            when task.control_state = 'active' and task.kind = 'research' and task.research_state in ('open', 'waiting') then 0
            when task.control_state = 'active' and task.kind = 'execution' then 1
            when task.control_state = 'paused' then 2
            else 3
          end as state_rank
        from public.investment_decisions decision
        join public.investment_decision_tasks link
          on link.user_id = decision.user_id and link.decision_id = decision.id
        join public.portfolio_tasks task
          on task.user_id = link.user_id and task.id = link.task_id
        where decision.user_id = selected_owner
          and decision.source_briefing_id = input_briefing_id
          order by task.id, state_rank, task.due_date nulls last, task.updated_at desc
        ) deduplicated
        order by state_rank, due_date nulls last, updated_at desc, id desc
        limit page_limit
      ) item
    ), '[]'::jsonb)
  );
end;
$$;

create function public.app_list_transaction_page(
  input_instrument_id bigint default null,
  input_account_id bigint default null,
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
  page_limit integer := greatest(1, least(coalesce(input_limit, 20), 100));
  cursor_created_at timestamptz;
  cursor_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor) <> 'object' or not (input_cursor ? 'created_at') or not (input_cursor ? 'id') then
      raise exception 'Invalid transaction cursor';
    end if;
    cursor_created_at := (input_cursor ->> 'created_at')::timestamptz;
    cursor_id := (input_cursor ->> 'id')::uuid;
  end if;

  return (
    with filtered as (
      select
        trade.id, trade.account_id, account.name as account_name,
        trade.instrument_id, instrument.ticker, instrument.display_name as instrument_name,
        trade.side, trade.quantity::text, trade.unit_price::text, trade.executed_on,
        trade.sequence_no, trade.before_quantity::text, trade.after_quantity::text,
        case when trade.after_quantity = 0 then null else (trade.after_cost_pool / trade.after_quantity)::text end as after_avg_price,
        trade.authored_via, trade.created_at, trade.reversed_at, trade.reversal_reason
      from public.trade_entries trade
      join public.accounts account on account.id = trade.account_id and account.user_id = trade.user_id
      join public.instruments instrument on instrument.id = trade.instrument_id and instrument.user_id = trade.user_id
      where trade.user_id = auth.uid()
        and (input_instrument_id is null or trade.instrument_id = input_instrument_id)
        and (input_account_id is null or trade.account_id = input_account_id)
        and (cursor_created_at is null or (trade.created_at, trade.id) < (cursor_created_at, cursor_id))
      order by trade.created_at desc, trade.id desc
      limit page_limit + 1
    ),
    page as (
      select * from filtered order by created_at desc, id desc limit page_limit
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(item) order by item.created_at desc, item.id desc) from page item), '[]'::jsonb),
      'next_cursor', case when (select count(*) from filtered) > page_limit then (
        select jsonb_build_object('created_at', item.created_at, 'id', item.id)
        from page item order by item.created_at, item.id limit 1
      ) else null end
    )
  );
end;
$$;

create or replace function public.app_get_investment_decision_for_owner(input_owner_user_id uuid,input_decision_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select case when input_owner_user_id=auth.uid() then public.app_get_investment_decision(input_decision_id)
  when public.can_view_feature(input_owner_user_id,'decisions') then (
   select jsonb_build_object(
     'id',d.id,'version',d.version,'status',d.status,'subject',d.subject,
     'question',d.question,'options',d.options,'selected_option',d.selected_option,
     'reason',d.reason,'uncertainty',d.uncertainty,'review_condition',d.review_condition,
     'created_at',d.created_at,'updated_at',d.updated_at,
     'tasks',case when public.can_view_feature(input_owner_user_id,'tasks') then coalesce((
       select jsonb_agg(jsonb_build_object(
         'id',t.id,'title',t.title,'kind',t.kind,'control_state',t.control_state,
         'research_state',t.research_state,'due_date',t.due_date
       ) order by t.updated_at desc,t.id desc)
       from public.investment_decision_tasks link
       join public.portfolio_tasks t on t.id=link.task_id and t.user_id=link.user_id
       where link.user_id=input_owner_user_id and link.decision_id=d.id
     ),'[]'::jsonb) else '[]'::jsonb end,
     'history','[]'::jsonb
   )
   from public.investment_decisions d where d.user_id=input_owner_user_id and d.id=input_decision_id)
  else null end;
$$;

revoke all on function public.app_list_briefing_related_tasks(uuid, uuid, integer) from public, anon;
revoke all on function public.app_list_transaction_page(bigint, bigint, integer, jsonb) from public, anon;
grant execute on function public.app_list_briefing_related_tasks(uuid, uuid, integer) to authenticated;
grant execute on function public.app_list_transaction_page(bigint, bigint, integer, jsonb) to authenticated;
