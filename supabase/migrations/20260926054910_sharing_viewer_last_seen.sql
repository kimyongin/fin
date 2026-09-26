alter table public.friendships add column last_viewed_at timestamptz;

create index friendships_owner_created_at_idx
  on public.friendships (owner_user_id, created_at, viewer_user_id);

create function public.app_list_portfolio_viewers(input_limit integer default 50, input_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  current_owner uuid := auth.uid();
  page_size integer := least(greatest(coalesce(input_limit, 50), 1), 50);
  page_offset integer := greatest(coalesce(input_offset, 0), 0);
  result jsonb;
begin
  if current_owner is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authentication required';
  end if;

  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'viewer_user_id', rows.viewer_user_id,
      'public_name', rows.public_name,
      'avatar_key', rows.avatar_key,
      'last_viewed_at', rows.last_viewed_at
    ) order by rows.created_at, rows.viewer_user_id) filter (where rows.ordinal <= page_size), '[]'::jsonb),
    'next_offset', case when count(*) > page_size then page_offset + page_size else null end
  ) into result
  from (
    select f.viewer_user_id, f.created_at, f.last_viewed_at,
      p.public_name, coalesce(p.avatar_key, 'bear') as avatar_key,
      row_number() over (order by f.created_at, f.viewer_user_id) as ordinal
    from public.friendships f
    join auth.users u on u.id = f.viewer_user_id and not coalesce(u.is_anonymous, false)
    left join public.profiles p on p.user_id = f.viewer_user_id
    where f.owner_user_id = current_owner
    order by f.created_at, f.viewer_user_id
    limit page_size + 1 offset page_offset
  ) rows;
  return result;
end;
$$;

create function public.app_mark_shared_portfolio_view(input_owner_user_id uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  current_viewer uuid := auth.uid();
  viewed_at timestamptz;
begin
  if current_viewer is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authentication required';
  end if;
  if input_owner_user_id is null or input_owner_user_id = current_viewer then
    raise exception 'Friend relationship required';
  end if;
  update public.friendships f
  set last_viewed_at = greatest(coalesce(f.last_viewed_at, '-infinity'::timestamptz), clock_timestamp())
  from public.profiles p
  where f.viewer_user_id = current_viewer
    and f.owner_user_id = input_owner_user_id
    and p.user_id = f.owner_user_id
    and p.sharing_enabled
  returning f.last_viewed_at into viewed_at;
  if viewed_at is null then raise exception 'Shared friend not found'; end if;
  return viewed_at;
end;
$$;

revoke all on function public.app_list_portfolio_viewers(integer, integer) from public, anon;
revoke all on function public.app_mark_shared_portfolio_view(uuid) from public, anon;
grant execute on function public.app_list_portfolio_viewers(integer, integer) to authenticated;
grant execute on function public.app_mark_shared_portfolio_view(uuid) to authenticated;
