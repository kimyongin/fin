create function public.app_list_daily_briefing_page(
  input_owner_user_id uuid default null,
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
  page_limit integer := greatest(1, least(coalesce(input_limit, 20), 50));
  cursor_analyzed_at timestamptz;
  cursor_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor) <> 'object' or not (input_cursor ? 'analyzed_at') or not (input_cursor ? 'id') then
      raise exception 'Invalid briefing cursor';
    end if;
    cursor_analyzed_at := (input_cursor ->> 'analyzed_at')::timestamptz;
    cursor_id := (input_cursor ->> 'id')::uuid;
  end if;
  if selected_owner <> auth.uid() and not public.can_view_feature(selected_owner, 'briefings') then
    return jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null);
  end if;

  return (
    with selected as (
      select
        briefing.id, briefing.review_date, briefing.timezone, briefing.analyzed_at,
        briefing.status, briefing.coverage_status, briefing.headline,
        briefing.supersedes_id, briefing.created_at
      from public.daily_briefings briefing
      where briefing.user_id = selected_owner
        and (cursor_analyzed_at is null or (briefing.analyzed_at, briefing.id) < (cursor_analyzed_at, cursor_id))
      order by briefing.analyzed_at desc, briefing.id desc
      limit page_limit + 1
    ),
    page as (
      select * from selected order by analyzed_at desc, id desc limit page_limit
    )
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(item) order by item.analyzed_at desc, item.id desc) from page item), '[]'::jsonb),
      'next_cursor', case when (select count(*) from selected) > page_limit then (
        select jsonb_build_object('analyzed_at', item.analyzed_at, 'id', item.id)
        from page item order by item.analyzed_at, item.id limit 1
      ) else null end
    )
  );
end;
$$;

revoke all on function public.app_list_daily_briefing_page(uuid, integer, jsonb) from public, anon;
grant execute on function public.app_list_daily_briefing_page(uuid, integer, jsonb) to authenticated;
