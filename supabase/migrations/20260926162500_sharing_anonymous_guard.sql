-- Anonymous viewer sessions never become persistent profile/friend editors.
create or replace function public.app_set_profile_avatar(input_avatar_key text)
returns text language plpgsql security definer set search_path=public as $$
declare selected_key text;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Authentication required';
  end if;
  if input_avatar_key not in (
    'bear','cat','fox','dog','rabbit','panda','penguin','owl','frog','turtle',
    'apple','cherry','lemon','peach','strawberry','grape','watermelon','banana','pineapple','kiwi'
  ) or input_avatar_key is null then raise exception 'Invalid profile avatar'; end if;
  insert into public.profiles(user_id,avatar_key) values(auth.uid(),input_avatar_key)
  on conflict(user_id) do update set avatar_key=excluded.avatar_key
  returning avatar_key into selected_key;
  return selected_key;
end;
$$;

create or replace function public.add_friend(input_public_name text,input_viewer_password text)
returns table(owner_user_id uuid,owner_public_name text,created_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare current_user_id uuid:=auth.uid(); owner_profile public.profiles;
begin
  if current_user_id is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Authentication required';
  end if;
  select * into owner_profile from public.profiles
  where public_name_normalized=public.normalize_public_name(input_public_name) and sharing_enabled;
  if owner_profile.user_id is null then raise exception 'Shared profile not found'; end if;
  if owner_profile.user_id=current_user_id then raise exception 'Cannot add your own profile as a friend'; end if;
  if coalesce(owner_profile.viewer_password_hash,'')='' then raise exception 'Invalid viewer password'; end if;
  if owner_profile.viewer_password_hash like '$2%' then
    if owner_profile.viewer_password_hash<>extensions.crypt(coalesce(input_viewer_password,''),owner_profile.viewer_password_hash) then
      raise exception 'Invalid viewer password';
    end if;
  elsif owner_profile.viewer_password_hash<>encode(extensions.digest(coalesce(input_viewer_password,''),'sha256'),'hex') then
    raise exception 'Invalid viewer password';
  end if;
  insert into public.friendships(viewer_user_id,owner_user_id) values(current_user_id,owner_profile.user_id)
  on conflict on constraint friendships_pkey do nothing;
  return query select f.owner_user_id,owner_profile.public_name,f.created_at from public.friendships f
    where f.viewer_user_id=current_user_id and f.owner_user_id=owner_profile.user_id;
end;
$$;
