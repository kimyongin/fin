create extension if not exists pgcrypto;

create table if not exists public.agent_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    token_hash text not null unique,
    token_prefix text not null,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists agent_tokens_user_created_at_idx
    on public.agent_tokens (user_id, created_at desc);

create index if not exists agent_tokens_active_hash_idx
    on public.agent_tokens (token_hash)
    where revoked_at is null;

alter table public.agent_tokens enable row level security;

drop policy if exists agent_tokens_select_own on public.agent_tokens;
create policy agent_tokens_select_own
on public.agent_tokens
for select
to authenticated
using (user_id = auth.uid());

create or replace function public.agent_list_tokens()
returns table (
    id uuid,
    name text,
    token_prefix text,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    select
        at.id,
        at.name,
        at.token_prefix,
        at.last_used_at,
        at.revoked_at,
        at.created_at
    from public.agent_tokens at
    where at.user_id = auth.uid()
    order by at.created_at desc;
$$;

create or replace function public.agent_create_token(
    input_name text,
    input_token_hash text,
    input_token_prefix text
)
returns table (
    id uuid,
    name text,
    token_prefix text,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    trimmed_name text := nullif(trim(coalesce(input_name, '')), '');
    trimmed_hash text := lower(nullif(trim(coalesce(input_token_hash, '')), ''));
    trimmed_prefix text := nullif(trim(coalesce(input_token_prefix, '')), '');
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    if trimmed_hash is null or trimmed_hash !~ '^[0-9a-f]{64}$' then
        raise exception 'Token hash must be a SHA-256 hex string';
    end if;

    if trimmed_prefix is null or length(trimmed_prefix) > 32 then
        raise exception 'Token prefix is required';
    end if;

    return query
    insert into public.agent_tokens (
        user_id,
        name,
        token_hash,
        token_prefix
    )
    values (
        current_user_id,
        coalesce(trimmed_name, 'Codex agent'),
        trimmed_hash,
        trimmed_prefix
    )
    returning
        agent_tokens.id,
        agent_tokens.name,
        agent_tokens.token_prefix,
        agent_tokens.last_used_at,
        agent_tokens.revoked_at,
        agent_tokens.created_at;
end;
$$;

create or replace function public.agent_revoke_token(input_token_id uuid)
returns table (
    id uuid,
    name text,
    token_prefix text,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    return query
    update public.agent_tokens at
    set revoked_at = coalesce(at.revoked_at, now())
    where at.id = input_token_id
      and at.user_id = current_user_id
    returning
        at.id,
        at.name,
        at.token_prefix,
        at.last_used_at,
        at.revoked_at,
        at.created_at;
end;
$$;

grant execute on function public.agent_list_tokens() to authenticated;
grant execute on function public.agent_create_token(text, text, text) to authenticated;
grant execute on function public.agent_revoke_token(uuid) to authenticated;
