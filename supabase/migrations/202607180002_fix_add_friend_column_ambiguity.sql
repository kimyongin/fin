create or replace function public.add_friend(
    input_public_name text,
    input_viewer_password text
)
returns table (
    owner_user_id uuid,
    owner_public_name text,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    owner_profile public.profiles;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    select *
    into owner_profile
    from public.profiles
    where public_name_normalized = public.normalize_public_name(input_public_name)
      and sharing_enabled;

    if owner_profile.user_id is null then
        raise exception 'Shared profile not found';
    end if;

    if owner_profile.user_id = current_user_id then
        raise exception 'Cannot add your own profile as a friend';
    end if;

    if coalesce(owner_profile.viewer_password_hash, '') = '' then
        raise exception 'Invalid viewer password';
    end if;

    if owner_profile.viewer_password_hash like '$2%' then
        if owner_profile.viewer_password_hash <> extensions.crypt(coalesce(input_viewer_password, ''), owner_profile.viewer_password_hash) then
            raise exception 'Invalid viewer password';
        end if;
    elsif owner_profile.viewer_password_hash <> encode(extensions.digest(coalesce(input_viewer_password, ''), 'sha256'), 'hex') then
        raise exception 'Invalid viewer password';
    end if;

    insert into public.friendships (viewer_user_id, owner_user_id)
    values (current_user_id, owner_profile.user_id)
    on conflict on constraint friendships_pkey do nothing;

    return query
    select f.owner_user_id, owner_profile.public_name, f.created_at
    from public.friendships f
    where f.viewer_user_id = current_user_id
      and f.owner_user_id = owner_profile.user_id;
end;
$$;

grant execute on function public.add_friend(text, text) to authenticated;
