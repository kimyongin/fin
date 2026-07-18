create table if not exists public.friendships (
    viewer_user_id uuid not null references auth.users(id) on delete cascade,
    owner_user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (viewer_user_id, owner_user_id),
    constraint friendships_not_self check (viewer_user_id <> owner_user_id)
);

create index if not exists friendships_viewer_created_at_idx
    on public.friendships (viewer_user_id, created_at desc);

alter table public.friendships enable row level security;

drop policy if exists friendships_select_own on public.friendships;
create policy friendships_select_own
on public.friendships
for select
to authenticated
using (viewer_user_id = auth.uid());

drop policy if exists friendships_delete_own on public.friendships;
create policy friendships_delete_own
on public.friendships
for delete
to authenticated
using (viewer_user_id = auth.uid());

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
            from public.friendships f
            join public.profiles p
              on p.user_id = f.owner_user_id
            where f.viewer_user_id = auth.uid()
              and f.owner_user_id = owner_id
              and p.sharing_enabled
        )
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
    on conflict (viewer_user_id, owner_user_id) do nothing;

    return query
    select f.owner_user_id, owner_profile.public_name, f.created_at
    from public.friendships f
    where f.viewer_user_id = current_user_id
      and f.owner_user_id = owner_profile.user_id;
end;
$$;

create or replace function public.list_friends()
returns table (
    owner_user_id uuid,
    owner_public_name text,
    created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    select f.owner_user_id, p.public_name, f.created_at
    from public.friendships f
    join public.profiles p
      on p.user_id = f.owner_user_id
    where f.viewer_user_id = auth.uid()
      and p.sharing_enabled
    order by lower(p.public_name), f.created_at;
$$;

create or replace function public.remove_friend(input_owner_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
    with deleted as (
        delete from public.friendships
        where viewer_user_id = auth.uid()
          and owner_user_id = input_owner_user_id
        returning 1
    )
    select exists(select 1 from deleted);
$$;

drop function if exists public.app_get_portfolio_state();

create function public.app_get_portfolio_state(input_owner_user_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with requested_owner as (
        select coalesce(input_owner_user_id, auth.uid()) as user_id
    ),
    current_user_ctx as (
        select user_id
        from requested_owner
        where public.can_view_owner(user_id)
    ),
    latest_prices as (
        select distinct on (hpd.ticker)
            hpd.ticker,
            hpd.price_date,
            hpd.close_price,
            hpd.source
        from public.holding_prices_daily hpd
        join current_user_ctx ctx
          on ctx.user_id = hpd.user_id
        where hpd.source <> 'holiday'
        order by hpd.ticker, hpd.price_date desc
    )
    select jsonb_build_object(
        'accounts', coalesce((
            select jsonb_agg(to_jsonb(a) order by a.name)
            from public.accounts a
            join current_user_ctx ctx on ctx.user_id = a.user_id
        ), '[]'::jsonb),
        'holdings', coalesce((
            select jsonb_agg(to_jsonb(h) || jsonb_build_object(
                'instruments', case when i.ticker is null then null else jsonb_build_object(
                    'display_name', i.display_name,
                    'currency', i.currency,
                    'instrument_type', i.instrument_type,
                    'note', i.note
                ) end
            ) order by h.account_id)
            from public.holdings h
            join current_user_ctx ctx on ctx.user_id = h.user_id
            left join public.instruments i on i.user_id = h.user_id and i.ticker = h.ticker
        ), '[]'::jsonb),
        'positions', '[]'::jsonb,
        'instruments', coalesce((
            select jsonb_agg(to_jsonb(i) order by i.display_name)
            from public.instruments i
            join current_user_ctx ctx on ctx.user_id = i.user_id
        ), '[]'::jsonb),
        'tags', coalesce((
            select jsonb_agg(to_jsonb(t) order by t.sort_order)
            from public.tags t
            join current_user_ctx ctx on ctx.user_id = t.user_id
        ), '[]'::jsonb),
        'instrumentTags', coalesce((
            select jsonb_agg(jsonb_build_object(
                'ticker', it.ticker,
                'tag_id', it.tag_id,
                'tags', case when t.id is null then null else jsonb_build_object(
                    'id', t.id,
                    'name', t.name,
                    'color', t.color
                ) end
            ) order by it.ticker)
            from public.instrument_tags it
            join current_user_ctx ctx on ctx.user_id = it.user_id
            left join public.tags t on t.user_id = it.user_id and t.id = it.tag_id
        ), '[]'::jsonb),
        'prices', coalesce((
            select jsonb_agg(to_jsonb(lp) order by lp.price_date desc)
            from latest_prices lp
        ), '[]'::jsonb)
    );
$$;

grant execute on function public.add_friend(text, text) to authenticated;
grant execute on function public.list_friends() to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.app_get_portfolio_state(uuid) to authenticated;
grant execute on function public.can_view_owner(uuid) to authenticated, anon;
