create or replace function public.app_create_daily_context(
    input_timezone text default 'Asia/Seoul', input_subject_tickers text[] default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  created_context jsonb;
  created_context_id uuid;
  enriched_snapshot jsonb;
  recent_activity jsonb;
begin
  created_context:=public.app_create_daily_context_without_lifecycle(input_timezone,input_subject_tickers);
  created_context_id:=(created_context->>'context_id')::uuid;

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

  update public.daily_review_contexts context set snapshot=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
    context.snapshot,
    '{open_tasks}',jsonb_build_object('status','available','items',public.app_list_action_timeline(null,'pending',null,null,100,null,input_timezone)->'pending')),
    '{todo_bundles}',jsonb_build_object('status','retired','items','[]'::jsonb)),
    '{decisions}',jsonb_build_object('status','available','items',public.app_list_investment_decisions(20,null))),
    '{investment_policy}',coalesce(public.app_get_investment_policy()->'profile','null'::jsonb)),
    '{holding_theses}',public.app_list_holding_theses()),
    '{recent_activity}',recent_activity)
  where context.id=created_context_id and context.user_id=auth.uid()
  returning context.snapshot into enriched_snapshot;
  return created_context||jsonb_build_object('snapshot',enriched_snapshot);
end; $$;

create or replace function public.app_get_activity_report_context(
  input_period_start date,
  input_period_end date,
  input_timezone text,
  input_limit integer default 200,
  input_cursor jsonb default null
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare current_user_id uuid:=auth.uid(); page_limit integer:=greatest(1,least(coalesce(input_limit,200),500));
  cursor_occurred_at timestamptz; cursor_id bigint;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if input_period_start is null or input_period_end is null or input_period_start>input_period_end or input_period_end-input_period_start>366 then raise exception 'Invalid report period'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'occurred_at') or not(input_cursor?'id') then raise exception 'Invalid report context cursor'; end if;
    begin cursor_occurred_at:=(input_cursor->>'occurred_at')::timestamptz; cursor_id:=(input_cursor->>'id')::bigint;
    exception when others then raise exception 'Invalid report context cursor'; end;
  end if;
  return (
    with eligible as (
      select event.id,event.source,event.action_type,event.target_table,event.target_id,event.task_id,
        event.title,event.note,event.result,event.conclusion,event.instrument_id,event.account_id,
        event.before_data,event.after_data,event.occurred_at,event.occurrence_on,event.updated_at,event.version,
        coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
          from public.activity_event_tags relation join public.activity_tags tag
            on tag.user_id=relation.user_id and tag.id=relation.tag_id
          where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb) tags
      from public.activity_events event
      where event.user_id=current_user_id and event.status='succeeded'
        and event.action_type not in ('create_general_task','update_general_task')
        and coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date) between input_period_start and input_period_end
        and (cursor_occurred_at is null or (event.occurred_at,event.id)<(cursor_occurred_at,cursor_id))
      order by event.occurred_at desc,event.id desc limit page_limit+1
    ), page as (select * from eligible order by occurred_at desc,id desc limit page_limit)
    select jsonb_build_object(
      'period',jsonb_build_object('start',input_period_start,'end',input_period_end,'timezone',input_timezone),
      'events',coalesce((select jsonb_agg(to_jsonb(item) order by item.occurred_at desc,item.id desc) from page item),'[]'::jsonb),
      'next_cursor',case when (select count(*) from eligible)>page_limit then (select jsonb_build_object('occurred_at',item.occurred_at,'id',item.id) from page item order by item.occurred_at,item.id limit 1) else null end,
      'current_open_tasks',coalesce((select jsonb_agg(jsonb_build_object('id',task.id,'kind',task.kind,'title',task.title,'due_date',task.due_date,'updated_at',task.updated_at) order by task.due_date nulls last,task.updated_at desc) from public.portfolio_tasks task where task.user_id=current_user_id and task.control_state='active' and ((task.kind='research' and task.research_state in ('open','waiting')) or task.kind in ('general','execution'))),'[]'::jsonb),
      'current_open_tasks_basis','current_at_request_not_historical_period_end',
      'decisions',coalesce((select jsonb_agg(jsonb_build_object('id',decision.id,'status',decision.status,'question',decision.question,'selected_option',decision.selected_option,'reason',decision.reason,'updated_at',decision.updated_at) order by decision.updated_at desc) from public.investment_decisions decision where decision.user_id=current_user_id and (decision.created_at at time zone input_timezone)::date<=input_period_end and (decision.updated_at at time zone input_timezone)::date>=input_period_start),'[]'::jsonb)
    )
  );
end; $$;

create or replace function public.app_get_activity_report(input_report_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select to_jsonb(report) || jsonb_build_object('needs_regeneration',
    exists(
      select 1
      from unnest(report.source_event_ids) source_id
      left join public.activity_events event
        on event.id=source_id and event.user_id=report.user_id
      where event.id is null or event.status<>'succeeded'
        or coalesce(event.occurrence_on,(event.occurred_at at time zone report.timezone)::date) not between report.period_start and report.period_end
        or event.updated_at>report.updated_at
    ) or exists(
      select 1 from public.activity_events event
      where event.user_id=report.user_id and event.status='succeeded'
        and event.action_type not in ('create_general_task','update_general_task')
        and coalesce(event.occurrence_on,(event.occurred_at at time zone report.timezone)::date) between report.period_start and report.period_end
        and not(event.id=any(report.source_event_ids))
    )
  )
  from public.activity_reports report where report.id=input_report_id and report.user_id=auth.uid();
$$;

revoke all on function public.app_create_daily_context(text,text[]),public.app_get_activity_report_context(date,date,text,integer,jsonb),public.app_get_activity_report(uuid) from public,anon;
grant execute on function public.app_create_daily_context(text,text[]),public.app_get_activity_report_context(date,date,text,integer,jsonb),public.app_get_activity_report(uuid) to authenticated;
