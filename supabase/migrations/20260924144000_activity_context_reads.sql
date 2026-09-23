-- Context reads use the same body/tag model as the interactive activity feed.
-- Do not infer a mandatory review/decision kind from a free-form record.
create or replace function public.app_get_daily_context(
  input_timezone text default 'Asia/Seoul', input_subject_tickers text[] default null
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  selected_timezone text:=trim(coalesce(input_timezone,''));
  selected_tickers text[];
  current_at timestamptz:=clock_timestamp();
  recent_items jsonb;
  context_value jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from pg_timezone_names where name=selected_timezone) then raise exception 'Invalid timezone'; end if;
  select coalesce(array_agg(distinct upper(trim(ticker)) order by upper(trim(ticker))),'{}'::text[])
    into selected_tickers from unnest(coalesce(input_subject_tickers,'{}'::text[])) ticker where trim(ticker)<>'';
  if cardinality(selected_tickers)>200 then raise exception 'Daily context accepts at most 200 subjects'; end if;
  recent_items:=public.app_search_activities(null,null,null,null,'done',null,null,null,null,'any',20,null,selected_timezone)->'items';
  context_value:=jsonb_build_object(
    'as_of',current_at,'review_date',(current_at at time zone selected_timezone)::date,
    'timezone',selected_timezone,'requested_subject_tickers',to_jsonb(selected_tickers),
    'portfolio',public.app_get_portfolio_state(null),
    'strategy',public.app_get_strategy_state(null),
    'principles',public.app_list_principles(null,selected_timezone,false)->'items',
    'private_holding_notes',public.app_list_private_holding_notes()->'items',
    'open_tasks',public.app_list_action_timeline(null,'pending',null,null,100,null,selected_timezone)->'pending',
    'recent_activities',recent_items,'last_activity',recent_items->0
  );
  if pg_column_size(context_value)>2097152 then raise exception 'Daily context exceeds the 2 MiB size limit'; end if;
  return context_value;
end;
$$;

create or replace function public.app_get_activity_report_context(
  input_period_start date,input_period_end date,input_timezone text,
  input_limit integer default 200,input_cursor jsonb default null
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  current_user_id uuid:=auth.uid();
  page_limit integer:=greatest(1,least(coalesce(input_limit,200),500));
  cursor_occurred_at timestamptz;
  cursor_id bigint;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if input_period_start is null or input_period_end is null or input_period_start>input_period_end
    or input_period_end-input_period_start>366 then raise exception 'Invalid report period'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'occurred_at') or not(input_cursor?'id') then
      raise exception 'Invalid report context cursor'; end if;
    begin cursor_occurred_at:=(input_cursor->>'occurred_at')::timestamptz;
      cursor_id:=(input_cursor->>'id')::bigint;
    exception when others then raise exception 'Invalid report context cursor'; end;
  end if;
  return (with eligible as (
    select event.id,event.title,event.body,event.occurred_at,event.occurrence_on,
      event.task_id,event.holding_id,event.instrument_id,event.account_id,
      coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
        from public.activity_event_tags relation join public.activity_tags tag
          on tag.user_id=relation.user_id and tag.id=relation.tag_id
        where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb) tags
    from public.activity_events event
    where event.user_id=current_user_id and event.status='succeeded'
      and event.action_type not in ('create_general_task','update_general_task')
      and coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)
        between input_period_start and input_period_end
      and (cursor_occurred_at is null or (event.occurred_at,event.id)<(cursor_occurred_at,cursor_id))
    order by event.occurred_at desc,event.id desc limit page_limit+1
  ), page as (select * from eligible order by occurred_at desc,id desc limit page_limit)
  select jsonb_build_object(
    'period',jsonb_build_object('start',input_period_start,'end',input_period_end,'timezone',input_timezone),
    'events',coalesce((select jsonb_agg(to_jsonb(item) order by item.occurred_at desc,item.id desc) from page item),'[]'::jsonb),
    'next_cursor',case when (select count(*) from eligible)>page_limit then
      (select jsonb_build_object('occurred_at',item.occurred_at,'id',item.id)
        from page item order by item.occurred_at,item.id limit 1) end,
    'current_open_tasks',coalesce((select jsonb_agg(jsonb_build_object('id',task.id,'title',task.title,
      'due_date',task.due_date,'updated_at',task.updated_at) order by task.due_date nulls last,task.updated_at desc)
      from public.portfolio_tasks task where task.user_id=current_user_id and task.control_state='active'
        and task.kind='general'),'[]'::jsonb),
    'current_open_tasks_basis','current_at_request_not_historical_period_end'
  ));
end;
$$;

-- Legacy raw feed is consumed by owner-only diagnostics. Never let its
-- before/after JSON bypass the narrower shared activity DTO.
create or replace function public.app_list_recent_activity(
  limit_count integer default 20,input_owner_user_id uuid default null
) returns table(
  id bigint,source text,action_type text,natural_language_request text,
  target_table text,target_id text,before_data jsonb,after_data jsonb,
  status text,error_message text,created_at timestamptz
) language sql stable security definer set search_path=public as $$
  select event.id,event.source,event.action_type,event.natural_language_request,
    event.target_table,event.target_id,event.before_data,event.after_data,
    event.status,event.error_message,event.created_at
  from public.activity_events event
  where auth.uid() is not null and coalesce(input_owner_user_id,auth.uid())=auth.uid()
    and event.user_id=auth.uid() and event.status='succeeded'
  order by event.created_at desc
  limit least(greatest(coalesce(limit_count,20),1),100);
$$;
