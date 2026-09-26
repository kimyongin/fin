alter table public.profiles
  add column avatar_key text not null default 'bear'
  constraint profiles_avatar_key_allowed
  check (avatar_key in ('bear', 'cat', 'fox', 'dog', 'apple', 'cherry', 'lemon', 'peach'));

create or replace function public.app_set_profile_avatar(input_avatar_key text)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  selected_key text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if input_avatar_key not in ('bear', 'cat', 'fox', 'dog', 'apple', 'cherry', 'lemon', 'peach') or input_avatar_key is null then
    raise exception 'Invalid profile avatar';
  end if;
  insert into public.profiles (user_id, avatar_key)
  values (auth.uid(), input_avatar_key)
  on conflict (user_id) do update set avatar_key = excluded.avatar_key
  returning avatar_key into selected_key;
  return selected_key;
end;
$$;

revoke all on function public.app_set_profile_avatar(text) from public, anon;
grant execute on function public.app_set_profile_avatar(text) to authenticated;

drop function public.list_friends();
create function public.list_friends()
returns table (
  owner_user_id uuid,
  owner_public_name text,
  owner_avatar_key text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select f.owner_user_id, p.public_name, p.avatar_key, f.created_at
  from public.friendships f
  join public.profiles p on p.user_id = f.owner_user_id
  where f.viewer_user_id = auth.uid() and p.sharing_enabled
  order by lower(p.public_name), f.created_at;
$$;

revoke all on function public.list_friends() from public, anon;
grant execute on function public.list_friends() to authenticated;

drop function public.get_active_viewer_access();
create function public.get_active_viewer_access()
returns table (
  owner_user_id uuid,
  owner_public_name text,
  expires_at timestamptz,
  owner_avatar_key text
)
language sql
stable
security definer
set search_path = public
as $$
  select vs.owner_user_id, p.public_name, vs.expires_at, p.avatar_key
  from public.viewer_sessions vs
  join public.profiles p on p.user_id = vs.owner_user_id
  where vs.viewer_user_id = auth.uid()
    and vs.expires_at > now()
    and p.sharing_enabled
    and vs.password_version = p.viewer_password_updated_at
  order by vs.expires_at desc
  limit 1;
$$;

revoke all on function public.get_active_viewer_access() from public;
grant execute on function public.get_active_viewer_access() to authenticated, anon;
