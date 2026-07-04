create extension if not exists pgcrypto;

create table if not exists public.profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    public_name text,
    public_name_normalized text,
    viewer_password_hash text,
    viewer_password_updated_at timestamptz,
    sharing_enabled boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.profiles
    add column if not exists public_name text,
    add column if not exists public_name_normalized text,
    add column if not exists viewer_password_hash text,
    add column if not exists viewer_password_updated_at timestamptz,
    add column if not exists sharing_enabled boolean not null default false,
    add column if not exists created_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now();

create unique index if not exists profiles_public_name_normalized_key
    on public.profiles (public_name_normalized)
    where public_name_normalized is not null;

create table if not exists public.viewer_sessions (
    id uuid primary key default gen_random_uuid(),
    viewer_user_id uuid not null references auth.users(id) on delete cascade,
    owner_user_id uuid not null references auth.users(id) on delete cascade,
    password_version timestamptz not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    constraint viewer_sessions_not_self check (viewer_user_id <> owner_user_id)
);

create unique index if not exists viewer_sessions_viewer_owner_key
    on public.viewer_sessions (viewer_user_id, owner_user_id);

create index if not exists viewer_sessions_owner_lookup_idx
    on public.viewer_sessions (owner_user_id, viewer_user_id, expires_at desc);

create or replace function public.normalize_public_name(input_name text)
returns text
language sql
immutable
as $$
    select nullif(lower(trim(input_name)), '');
$$;

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_profile_updated_at();

alter table public.profiles enable row level security;
alter table public.viewer_sessions enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated, anon
using (user_id = auth.uid());

drop policy if exists viewer_sessions_select_own on public.viewer_sessions;
create policy viewer_sessions_select_own
on public.viewer_sessions
for select
to authenticated, anon
using (viewer_user_id = auth.uid() or owner_user_id = auth.uid());

create or replace function public.can_view_owner(owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select
        owner_id = auth.uid()
        or exists (
            select 1
            from public.viewer_sessions vs
            join public.profiles p
              on p.user_id = vs.owner_user_id
            where vs.viewer_user_id = auth.uid()
              and vs.owner_user_id = owner_id
              and vs.expires_at > now()
              and p.sharing_enabled
              and vs.password_version = p.viewer_password_updated_at
        );
$$;

create or replace function public.set_viewer_profile(
    input_public_name text,
    input_viewer_password text,
    input_sharing_enabled boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_name text := public.normalize_public_name(input_public_name);
    trimmed_password text := nullif(trim(coalesce(input_viewer_password, '')), '');
    existing_profile public.profiles;
    next_password_hash text;
    next_password_updated_at timestamptz;
    result_row public.profiles;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    if normalized_name is not null and normalized_name !~ '^[0-9a-z가-힣_-]{2,32}$' then
        raise exception 'Public name must be 2-32 chars using Korean, English, numbers, dash, or underscore';
    end if;

    select *
    into existing_profile
    from public.profiles
    where user_id = current_user_id;

    if input_sharing_enabled and normalized_name is null then
        raise exception 'Public name is required when sharing is enabled';
    end if;

    if trimmed_password is not null and length(trimmed_password) < 4 then
        raise exception 'Viewer password must be at least 4 characters';
    end if;

    if input_sharing_enabled and trimmed_password is null and coalesce(existing_profile.viewer_password_hash, '') = '' then
        raise exception 'Viewer password is required when sharing is enabled';
    end if;

    if trimmed_password is not null then
        next_password_hash := crypt(trimmed_password, gen_salt('bf'));
        next_password_updated_at := now();
    else
        next_password_hash := existing_profile.viewer_password_hash;
        next_password_updated_at := existing_profile.viewer_password_updated_at;
    end if;

    insert into public.profiles (
        user_id,
        public_name,
        public_name_normalized,
        viewer_password_hash,
        viewer_password_updated_at,
        sharing_enabled
    )
    values (
        current_user_id,
        nullif(trim(input_public_name), ''),
        normalized_name,
        next_password_hash,
        next_password_updated_at,
        coalesce(input_sharing_enabled, false)
    )
    on conflict (user_id) do update
    set public_name = excluded.public_name,
        public_name_normalized = excluded.public_name_normalized,
        viewer_password_hash = excluded.viewer_password_hash,
        viewer_password_updated_at = excluded.viewer_password_updated_at,
        sharing_enabled = excluded.sharing_enabled,
        updated_at = now()
    returning *
    into result_row;

    return result_row;
end;
$$;

create or replace function public.unlock_viewer_access(
    input_public_name text,
    input_viewer_password text
)
returns table (
    owner_user_id uuid,
    owner_public_name text,
    expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    current_viewer_id uuid := auth.uid();
    owner_profile public.profiles;
    session_expires_at timestamptz := now() + interval '7 days';
begin
    if current_viewer_id is null then
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

    if owner_profile.user_id = current_viewer_id then
        raise exception 'Cannot unlock your own profile as a viewer';
    end if;

    if coalesce(owner_profile.viewer_password_hash, '') = ''
       or owner_profile.viewer_password_hash <> crypt(coalesce(input_viewer_password, ''), owner_profile.viewer_password_hash) then
        raise exception 'Invalid viewer password';
    end if;

    insert into public.viewer_sessions (
        viewer_user_id,
        owner_user_id,
        password_version,
        expires_at
    )
    values (
        current_viewer_id,
        owner_profile.user_id,
        owner_profile.viewer_password_updated_at,
        session_expires_at
    )
    on conflict (viewer_user_id, owner_user_id) do update
    set password_version = excluded.password_version,
        expires_at = excluded.expires_at;

    return query
    select owner_profile.user_id, owner_profile.public_name, session_expires_at;
end;
$$;

grant execute on function public.set_viewer_profile(text, text, boolean) to authenticated, anon;
grant execute on function public.unlock_viewer_access(text, text) to authenticated, anon;
grant execute on function public.can_view_owner(uuid) to authenticated, anon;
