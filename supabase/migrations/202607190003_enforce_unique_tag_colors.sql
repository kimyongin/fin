update public.tags
set color = case color
  when 'info' then 'cyan'
  when 'success' then 'green'
  when 'warning' then 'amber'
  when 'danger' then 'red'
  else color
end;

do $$
declare
  duplicate_tag record;
  available_color text;
  palette text[] := array[
    'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue',
    'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'red', 'slate', 'gray', 'neutral'
  ];
begin
  for duplicate_tag in
    select id, user_id
    from (
      select id, user_id, row_number() over (partition by user_id, color order by sort_order, id) as color_rank
      from public.tags
    ) ranked_tags
    where color_rank > 1
  loop
    select color_option into available_color
    from unnest(palette) as palette_color(color_option)
    where not exists (
      select 1 from public.tags existing
      where existing.user_id = duplicate_tag.user_id and existing.color = color_option
    )
    limit 1;

    if available_color is not null then
      update public.tags set color = available_color where id = duplicate_tag.id;
    end if;
  end loop;
end $$;

create or replace function public.app_save_tag(
  input_tag_id bigint default null,
  input_name text default null,
  input_color text default 'neutral',
  input_sort_order integer default 0,
  input_source text default 'user',
  input_request text default null
)
returns table (
  tag_id bigint,
  name text,
  color text,
  sort_order integer,
  activity_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_source text := coalesce(nullif(trim(input_source), ''), 'user');
  normalized_color text := lower(coalesce(nullif(trim(input_color), ''), 'neutral'));
  before_row jsonb;
  after_row jsonb;
  saved_tag_id bigint;
  event_id bigint;
  activity_type text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_source not in ('user', 'agent') then
    raise exception 'Invalid activity source';
  end if;

  if nullif(trim(coalesce(input_name, '')), '') is null then
    raise exception 'Tag name is required';
  end if;

  if normalized_color not in (
    'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue',
    'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'red', 'slate', 'gray', 'neutral'
  ) then
    raise exception 'Invalid tag color';
  end if;

  if exists (
    select 1 from public.tags t
    where t.user_id = current_user_id
      and t.color = normalized_color
      and t.id is distinct from input_tag_id
  ) then
    raise exception 'Tag color is already in use';
  end if;

  if input_tag_id is not null then
    select to_jsonb(t)
    into before_row
    from public.tags t
    where t.id = input_tag_id and t.user_id = current_user_id;

    if before_row is null then
      raise exception 'Tag not found';
    end if;

    update public.tags
    set name = trim(input_name), color = normalized_color, sort_order = coalesce(input_sort_order, 0)
    where id = input_tag_id and user_id = current_user_id
    returning id into saved_tag_id;
  else
    insert into public.tags (user_id, name, color, sort_order)
    values (current_user_id, trim(input_name), normalized_color, coalesce(input_sort_order, 0))
    returning id into saved_tag_id;
  end if;

  select to_jsonb(t) into after_row
  from public.tags t
  where t.id = saved_tag_id and t.user_id = current_user_id;

  activity_type := case when before_row is null then 'create_tag' else 'update_tag' end;

  insert into public.activity_events (
    user_id, source, action_type, natural_language_request, target_table, target_id, before_data, after_data, status
  )
  values (
    current_user_id, normalized_source, activity_type, nullif(trim(coalesce(input_request, '')), ''),
    'tags', saved_tag_id::text, before_row, after_row, 'succeeded'
  )
  returning id into event_id;

  return query
  select (after_row ->> 'id')::bigint, after_row ->> 'name', after_row ->> 'color', (after_row ->> 'sort_order')::integer, event_id;
end;
$$;

grant execute on function public.app_save_tag(bigint, text, text, integer, text, text) to authenticated;
