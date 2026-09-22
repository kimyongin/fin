create or replace function public.app_list_action_timeline(
    input_owner_user_id uuid default null,
    input_filter text default 'all',
    input_from date default null,
    input_to date default null,
    input_limit integer default 30,
    input_cursor jsonb default null,
    input_timezone text default 'Asia/Seoul'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    selected_owner uuid := coalesce(input_owner_user_id, auth.uid());
    normalized_filter text := lower(trim(coalesce(input_filter, 'all')));
    page_limit integer := greatest(1, least(coalesce(input_limit, 30), 100));
    cursor_occurred_at timestamptz;
    cursor_id bigint;
    tasks_allowed boolean;
    activity_allowed boolean;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    if selected_owner is null then raise exception 'Owner is required'; end if;
    if normalized_filter not in ('all','pending','done') then raise exception 'Invalid action timeline filter'; end if;
    if input_from is not null and input_to is not null and input_from > input_to then raise exception 'Invalid action timeline date range'; end if;
    if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
    if input_cursor is not null then
        if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'occurred_at') or not(input_cursor?'id') then
            raise exception 'Invalid action timeline cursor';
        end if;
        begin
            cursor_occurred_at := (input_cursor->>'occurred_at')::timestamptz;
            cursor_id := (input_cursor->>'id')::bigint;
        exception when others then
            raise exception 'Invalid action timeline cursor';
        end;
    end if;

    tasks_allowed := selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks');
    activity_allowed := selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity');

    return (
      with pending_rows as (
        select task.id,task.kind,task.version,task.title,task.subject,task.due_date,task.timezone,
          task.trigger_text,task.control_state,task.research_state,task.recurrence_kind,
          task.recurrence_start_on,
          case when task.kind='general' and task.recurrence_kind='daily'
            then (clock_timestamp() at time zone task.timezone)::date else null end occurrence_on,
          case
            when task.kind='general' then case
              when task.recurrence_kind='daily' and (clock_timestamp() at time zone task.timezone)::date<task.recurrence_start_on then 'not_scheduled'
              else coalesce(occurrence.status,'open') end
            when task.kind='research' then task.research_state
            when task.kind='execution' then case
              when coalesce(fills.filled_quantity,0)=0 then 'planned'
              when coalesce(fills.filled_quantity,0)<plan.target_quantity then 'partial'
              else 'completed' end
          end status,
          case when task.kind='execution' then jsonb_build_object(
            'side',plan.side,'target_quantity',plan.target_quantity,
            'filled_quantity',coalesce(fills.filled_quantity,0),
            'remaining_quantity',greatest(plan.target_quantity-coalesce(fills.filled_quantity,0),0)
          ) else null end execution_plan,
          task.created_at,task.updated_at
        from public.portfolio_tasks task
        left join public.execution_plans plan on plan.user_id=task.user_id and plan.task_id=task.id
        left join lateral (
          select sum(entry.quantity) filled_quantity
          from public.task_fill_links link
          join public.trade_entries entry on entry.user_id=link.user_id and entry.id=link.trade_entry_id
          where link.user_id=task.user_id and link.task_id=task.id and entry.reversed_at is null
        ) fills on true
        left join public.general_task_occurrence_states occurrence
          on occurrence.user_id=task.user_id and occurrence.task_id=task.id
         and occurrence.occurrence_key=case when task.recurrence_kind='daily'
           then (clock_timestamp() at time zone task.timezone)::date else date '0001-01-01' end
        where tasks_allowed and normalized_filter in ('all','pending')
          and task.user_id=selected_owner and task.control_state='active'
          and (
            (task.kind='general' and coalesce(occurrence.status,'open')='open')
            or (task.kind='research' and task.research_state in ('open','waiting'))
            or (task.kind='execution' and coalesce(fills.filled_quantity,0)<plan.target_quantity)
          )
      ),
      eligible_events as (
        select event.id,event.source,event.action_type,event.natural_language_request,
          event.target_table,event.target_id,event.task_id,event.before_data,event.after_data,
          event.status,event.error_message,event.occurred_at,event.occurrence_on,event.created_at,
          coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date) display_date,
          case
            when event.action_type in ('complete_general_task','transition_portfolio_task','transition_execution_task') then '완료'
            when event.action_type in ('confirm_trade_entry','record_trade_entry') then coalesce(event.after_data->>'side','매매')
            when event.action_type in ('verify_holding','reconcile_holding') then '확인'
            when event.action_type='record_manual_activity' then '기록'
            else '수정'
          end category
        from public.activity_events event
        where activity_allowed and normalized_filter in ('all','done')
          and event.user_id=selected_owner and event.status='succeeded'
          and event.action_type not in ('create_general_task','update_general_task')
          and (tasks_allowed or event.task_id is null)
          and (input_from is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)>=input_from)
          and (input_to is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)<=input_to)
          and (cursor_occurred_at is null or (event.occurred_at,event.id)<(cursor_occurred_at,cursor_id))
      ),
      bounded_events as (
        select * from eligible_events order by occurred_at desc,id desc limit page_limit+1
      ),
      event_page as (
        select * from bounded_events order by occurred_at desc,id desc limit page_limit
      ),
      event_days as (
        select display_date,count(*)::integer item_count,
          jsonb_object_agg(category,category_count order by category) counts,
          jsonb_agg(to_jsonb(item)-'display_date'-'category_count' order by occurred_at desc,id desc) items
        from (
          select page.*,count(*) over(partition by display_date,category)::integer category_count
          from event_page page
        ) item
        group by display_date
      )
      select jsonb_build_object(
        'pending',coalesce((select jsonb_agg(to_jsonb(item) order by item.due_date nulls last,item.updated_at desc,item.id desc) from pending_rows item),'[]'::jsonb),
        'days',coalesce((select jsonb_agg(jsonb_build_object('date',day.display_date,'item_count',day.item_count,'counts',day.counts,'items',day.items) order by day.display_date desc) from event_days day),'[]'::jsonb),
        'next_cursor',case when (select count(*) from bounded_events)>page_limit then (
          select jsonb_build_object('occurred_at',item.occurred_at,'id',item.id)
          from event_page item order by item.occurred_at,item.id limit 1
        ) else null end
      )
    );
end;
$$;

revoke all on function public.app_list_action_timeline(uuid,text,date,date,integer,jsonb,text) from public,anon;
grant execute on function public.app_list_action_timeline(uuid,text,date,date,integer,jsonb,text) to authenticated;
