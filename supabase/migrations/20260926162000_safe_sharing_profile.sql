-- All profile writes go through purpose-specific server validation. The raw
-- profile row includes a password hash and must not be returned to clients.
create function public.app_get_sharing_profile()
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'public_name',p.public_name,
    'sharing_enabled',coalesce(p.sharing_enabled,false),
    'viewer_password_updated_at',p.viewer_password_updated_at,
    'avatar_key',coalesce(p.avatar_key,'bear'))
  from (select auth.uid() as user_id) owner_ctx
  left join public.profiles p on p.user_id=owner_ctx.user_id
  where owner_ctx.user_id is not null;
$$;

create function public.app_save_sharing_profile(
  input_public_name text,input_viewer_password text,input_sharing_enabled boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare saved public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Anonymous users cannot save sharing settings'; end if;
  saved:=public.set_viewer_profile(input_public_name,input_viewer_password,input_sharing_enabled,'portfolio_all');
  return jsonb_build_object('public_name',saved.public_name,'sharing_enabled',saved.sharing_enabled,
    'viewer_password_updated_at',saved.viewer_password_updated_at,'avatar_key',saved.avatar_key);
end;
$$;

create function public.app_reset_sharing_profile()
returns jsonb language plpgsql security definer set search_path=public as $$
declare owner_id uuid:=auth.uid();
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Anonymous users cannot reset sharing settings'; end if;
  update public.profiles set public_name=null,public_name_normalized=null,
    viewer_password_hash=null,viewer_password_updated_at=null,sharing_enabled=false
    where user_id=owner_id;
  delete from public.viewer_sessions where owner_user_id=owner_id;
  delete from public.friendships where owner_user_id=owner_id;
  return public.app_get_sharing_profile();
end;
$$;

-- The avatar writer validates against the allowed key list and auth.uid().
alter function public.app_set_profile_avatar(text) security definer;

revoke all on public.profiles from anon,authenticated;
grant select(user_id,public_name,sharing_enabled,viewer_password_updated_at,avatar_key,created_at,updated_at)
  on public.profiles to authenticated;
revoke all on function public.set_viewer_profile(text,text,boolean) from public,anon,authenticated;
revoke all on function public.set_viewer_profile(text,text,boolean,text) from public,anon,authenticated;
revoke all on function public.app_get_sharing_profile() from public,anon;
revoke all on function public.app_save_sharing_profile(text,text,boolean) from public,anon;
revoke all on function public.app_reset_sharing_profile() from public,anon;
grant execute on function public.app_get_sharing_profile() to authenticated;
grant execute on function public.app_save_sharing_profile(text,text,boolean) to authenticated;
grant execute on function public.app_reset_sharing_profile() to authenticated;
