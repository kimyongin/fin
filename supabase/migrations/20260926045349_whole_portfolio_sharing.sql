-- The old sharing scope did not include principles or every activity. Require
-- an explicit new opt-in before widening any existing viewer's access.
update public.profiles set sharing_enabled = false where sharing_enabled;

create or replace function public.can_view_feature(owner_id uuid, input_feature_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select input_feature_key in ('assets', 'strategy', 'activity', 'tasks', 'principles')
    and public.can_view_owner(owner_id);
$$;

-- Keep the old three-argument endpoint for turning sharing off only. Old
-- clients must not unknowingly opt into the expanded scope.
create or replace function public.set_viewer_profile(
  input_public_name text, input_viewer_password text, input_sharing_enabled boolean
) returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid();
  normalized_name text := public.normalize_public_name(input_public_name);
  trimmed_password text := nullif(trim(coalesce(input_viewer_password, '')), '');
  existing_profile public.profiles;
  result_row public.profiles;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if input_sharing_enabled then raise exception 'Refresh the app to enable whole-portfolio sharing'; end if;
  if normalized_name is not null and
    (char_length(normalized_name) < 2 or char_length(normalized_name) > 32 or normalized_name ~ '\s') then
    raise exception 'Public name must be 2-32 characters with no spaces';
  end if;
  if trimmed_password is not null and char_length(trimmed_password) < 4 then
    raise exception 'Viewer password must be at least 4 characters';
  end if;
  select * into existing_profile from public.profiles where user_id = current_user_id;
  insert into public.profiles (
    user_id, public_name, public_name_normalized, viewer_password_hash,
    viewer_password_updated_at, sharing_enabled
  ) values (
    current_user_id, nullif(trim(input_public_name), ''), normalized_name,
    case when trimmed_password is null then existing_profile.viewer_password_hash
      else extensions.crypt(trimmed_password, extensions.gen_salt('bf')) end,
    case when trimmed_password is null then existing_profile.viewer_password_updated_at
      else clock_timestamp() end, false
  ) on conflict (user_id) do update set
    public_name = excluded.public_name,
    public_name_normalized = excluded.public_name_normalized,
    viewer_password_hash = excluded.viewer_password_hash,
    viewer_password_updated_at = excluded.viewer_password_updated_at,
    sharing_enabled = false,
    updated_at = clock_timestamp()
  returning * into result_row;
  return result_row;
end;
$$;

create function public.set_viewer_profile(
  input_public_name text, input_viewer_password text,
  input_sharing_enabled boolean, input_share_scope text
) returns public.profiles language plpgsql security definer set search_path = public as $$
declare result_row public.profiles;
begin
  if input_share_scope is distinct from 'portfolio_all' then
    raise exception 'Whole-portfolio share scope is required';
  end if;
  result_row := public.set_viewer_profile(input_public_name, input_viewer_password, false);
  if input_sharing_enabled then
    if result_row.public_name_normalized is null or result_row.viewer_password_hash is null then
      raise exception 'Public name and viewer password are required';
    end if;
    update public.profiles set sharing_enabled = true where user_id = auth.uid()
      returning * into result_row;
  end if;
  return result_row;
end;
$$;
revoke all on function public.set_viewer_profile(text,text,boolean,text) from public, anon;
grant execute on function public.set_viewer_profile(text,text,boolean,text) to authenticated;

create or replace function public.app_get_shared_feature_access(input_owner_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare allowed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if input_owner_user_id is null then raise exception 'Owner is required'; end if;
  allowed := public.can_view_owner(input_owner_user_id);
  return jsonb_build_object('owner_user_id',input_owner_user_id,
    'relationship_access',allowed,
    'features',jsonb_build_object('assets',allowed,'strategy',allowed,
      'activity',allowed,'tasks',allowed,'principles',allowed));
end;
$$;

-- The three-argument read remains owner-only for existing server callers.
-- The explicit-owner overload is the only shared principle entry point.
create function public.app_list_principles(
  input_on date, input_timezone text, input_include_ended boolean,
  input_owner_user_id uuid
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare cutoff timestamptz; latest public.principles%rowtype;
begin
  input_owner_user_id := coalesce(input_owner_user_id, auth.uid());
  if input_owner_user_id is null or not public.can_view_owner(input_owner_user_id) then
    raise exception 'Principles are not shared';
  end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then
    raise exception 'Invalid timezone';
  end if;
  cutoff := case when input_on is null then clock_timestamp()
    else (input_on + 1)::timestamp at time zone input_timezone end;
  select * into latest from public.principles
  where user_id=input_owner_user_id and effective_at<cutoff
  order by effective_at desc,id desc limit 1;
  return jsonb_build_object('items',case when latest.id is null or
    (latest.ended and not input_include_ended) then '[]'::jsonb
    else jsonb_build_array(to_jsonb(latest)-'user_id') end,
    'on_date',input_on,'timezone',input_timezone);
end;
$$;

create function public.app_list_principle_changes(
  input_limit integer, input_cursor jsonb, input_owner_user_id uuid
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare page_limit integer; cursor_at timestamptz; cursor_id bigint; result jsonb;
begin
  input_owner_user_id := coalesce(input_owner_user_id, auth.uid());
  if input_owner_user_id is null or not public.can_view_owner(input_owner_user_id) then
    raise exception 'Principles are not shared';
  end if;
  page_limit := least(greatest(coalesce(input_limit,20),1),50);
  if input_cursor is not null then
    if jsonb_typeof(input_cursor)<>'object' or
      not (input_cursor ? 'effective_at' and input_cursor ? 'id') then
      raise exception 'Invalid principle change cursor';
    end if;
    begin
      cursor_at := (input_cursor->>'effective_at')::timestamptz;
      cursor_id := (input_cursor->>'id')::bigint;
    exception when others then raise exception 'Invalid principle change cursor';
    end;
    if cursor_at is null or cursor_id is null then raise exception 'Invalid principle change cursor'; end if;
  end if;
  with bounded as (
    select p.* from public.principles p where p.user_id=input_owner_user_id
      and (cursor_at is null or (p.effective_at,p.id)<(cursor_at,cursor_id))
    order by p.effective_at desc,p.id desc limit page_limit+1
  ), page as (
    select * from bounded order by effective_at desc,id desc limit page_limit
  ), decorated as (
    select p.effective_at,p.id,
      (to_jsonb(p)-'user_id') || jsonb_build_object('change_type',
        case when p.ended then 'ended' when not exists (
          select 1 from public.principles old where old.user_id=p.user_id
            and old.principle_id=p.principle_id
            and (old.effective_at,old.id)<(p.effective_at,p.id))
        then 'added' else 'updated' end) item
    from page p
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(item order by effective_at desc,id desc)
      from decorated),'[]'::jsonb),
    'next_cursor',case when (select count(*) from bounded)>page_limit
      then (select jsonb_build_object('effective_at',effective_at,'id',id)
        from page order by effective_at,id limit 1) else null end
  ) into result;
  return result;
end;
$$;
revoke all on function public.app_list_principles(date,text,boolean,uuid),
  public.app_list_principle_changes(integer,jsonb,uuid) from public,anon;
grant execute on function public.app_list_principles(date,text,boolean,uuid),
  public.app_list_principle_changes(integer,jsonb,uuid) to authenticated;

drop function public.app_update_sharing_policy(integer,jsonb);
drop function public.app_get_sharing_policy();
drop table public.feature_sharing_grants;
drop table public.feature_sharing_policies;
