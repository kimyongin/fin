-- Current owner context is a read, not a six-hour stored analysis snapshot.
-- Review activity remains the only saved analysis until the user requests one.
create function public.app_get_daily_context(
    input_timezone text default 'Asia/Seoul',
    input_subject_tickers text[] default null
)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
    selected_timezone text := trim(coalesce(input_timezone, ''));
    selected_tickers text[];
    current_at timestamptz := clock_timestamp();
    saved_reviews jsonb;
    saved_decisions jsonb;
    context_value jsonb;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    if selected_timezone = '' or not exists(select 1 from pg_timezone_names where name = selected_timezone) then
        raise exception 'Invalid timezone';
    end if;
    select coalesce(array_agg(distinct upper(trim(ticker)) order by upper(trim(ticker))), '{}'::text[])
      into selected_tickers
      from unnest(coalesce(input_subject_tickers, '{}'::text[])) ticker
     where trim(ticker) <> '';
    if cardinality(selected_tickers) > 200 then raise exception 'Daily context accepts at most 200 subjects'; end if;

    saved_reviews := public.app_list_narrative_activities('review', null, 20, null)->'items';
    saved_decisions := public.app_list_narrative_activities('decision', null, 20, null)->'items';
    context_value := jsonb_build_object(
      'as_of', current_at,
      'review_date', (current_at at time zone selected_timezone)::date,
      'timezone', selected_timezone,
      'requested_subject_tickers', to_jsonb(selected_tickers),
      'portfolio', public.app_get_portfolio_state(null),
      'strategy', public.app_get_strategy_state(null),
      'principles', public.app_list_principles(null, selected_timezone, false)->'items',
      'private_holding_notes', public.app_list_private_holding_notes()->'items',
      'open_tasks', public.app_list_action_timeline(null, 'pending', null, null, 100, null, selected_timezone)->'pending',
      'last_review', saved_reviews->0,
      'recent_reviews', saved_reviews,
      'recent_decisions', saved_decisions
    );
    if pg_column_size(context_value) > 2097152 then raise exception 'Daily context exceeds the 2 MiB size limit'; end if;
    return context_value;
end;
$$;

revoke all on function public.app_get_daily_context(text,text[]) from public, anon;
grant execute on function public.app_get_daily_context(text,text[]) to authenticated;
