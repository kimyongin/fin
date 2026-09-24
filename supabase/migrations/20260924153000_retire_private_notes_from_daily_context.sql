-- Daily advice uses the common instrument note within the portfolio DTO.
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
    'open_tasks',public.app_list_action_timeline(null,'pending',null,null,100,null,selected_timezone)->'pending',
    'recent_activities',recent_items,'last_activity',recent_items->0
  );
  if pg_column_size(context_value)>2097152 then raise exception 'Daily context exceeds the 2 MiB size limit'; end if;
  return context_value;
end;
$$;
