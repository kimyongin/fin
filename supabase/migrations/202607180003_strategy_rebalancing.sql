create table public.strategies (
    id bigserial primary key,
    user_id uuid not null unique references auth.users(id) on delete cascade,
    name text not null,
    monthly_contribution numeric not null default 0 check (monthly_contribution >= 0),
    review_day integer not null default 1 check (review_day between 1 and 28),
    drift_threshold numeric not null default 5 check (drift_threshold > 0 and drift_threshold <= 100),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.strategy_buckets (
    id bigserial primary key,
    strategy_id bigint not null references public.strategies(id) on delete cascade,
    name text not null,
    target_percentage numeric not null check (target_percentage >= 0 and target_percentage <= 100),
    sort_order integer not null default 0
);

create table public.strategy_bucket_tags (
    bucket_id bigint not null references public.strategy_buckets(id) on delete cascade,
    tag_id bigint not null references public.tags(id) on delete cascade,
    primary key (bucket_id, tag_id),
    unique (tag_id)
);

alter table public.strategies enable row level security;
alter table public.strategy_buckets enable row level security;
alter table public.strategy_bucket_tags enable row level security;

create policy strategies_select_own on public.strategies for select to authenticated using (user_id = auth.uid());
create policy strategies_insert_own on public.strategies for insert to authenticated with check (user_id = auth.uid());
create policy strategies_update_own on public.strategies for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy strategies_delete_own on public.strategies for delete to authenticated using (user_id = auth.uid());

create policy strategy_buckets_select_own on public.strategy_buckets for select to authenticated using (
    exists (select 1 from public.strategies s where s.id = strategy_id and s.user_id = auth.uid())
);
create policy strategy_bucket_tags_select_own on public.strategy_bucket_tags for select to authenticated using (
    exists (
        select 1
        from public.strategy_buckets b
        join public.strategies s on s.id = b.strategy_id
        where b.id = bucket_id and s.user_id = auth.uid()
    )
);

create or replace function public.app_get_strategy_state(input_owner_user_id uuid default null)
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
    current_strategy as (
        select s.*
        from public.strategies s
        join current_user_ctx ctx on ctx.user_id = s.user_id
    )
    select jsonb_build_object(
        'strategy', (select to_jsonb(s) from current_strategy s),
        'buckets', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', b.id,
                'name', b.name,
                'target_percentage', b.target_percentage,
                'sort_order', b.sort_order,
                'tag_ids', coalesce((
                    select jsonb_agg(sbt.tag_id order by sbt.tag_id)
                    from public.strategy_bucket_tags sbt
                    where sbt.bucket_id = b.id
                ), '[]'::jsonb)
            ) order by b.sort_order, b.id)
            from public.strategy_buckets b
            join current_strategy s on s.id = b.strategy_id
        ), '[]'::jsonb)
    );
$$;

create or replace function public.app_save_strategy(
    input_name text,
    input_monthly_contribution numeric,
    input_review_day integer,
    input_drift_threshold numeric,
    input_buckets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    saved_strategy_id bigint;
    bucket_input jsonb;
    saved_bucket_id bigint;
    bucket_target numeric;
    bucket_name text;
    tag_id bigint;
    target_total numeric;
    seen_tag_ids bigint[] := '{}';
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    if nullif(trim(coalesce(input_name, '')), '') is null then
        raise exception 'Strategy name is required';
    end if;

    if jsonb_typeof(input_buckets) <> 'array' or jsonb_array_length(input_buckets) = 0 then
        raise exception 'At least one strategy bucket is required';
    end if;

    select coalesce(sum((value ->> 'target_percentage')::numeric), 0)
    into target_total
    from jsonb_array_elements(input_buckets);

    if abs(target_total - 100) > 0.01 then
        raise exception 'Strategy targets must add up to 100 percent';
    end if;

    insert into public.strategies (user_id, name, monthly_contribution, review_day, drift_threshold, updated_at)
    values (
        current_user_id,
        trim(input_name),
        greatest(coalesce(input_monthly_contribution, 0), 0),
        greatest(1, least(coalesce(input_review_day, 1), 28)),
        greatest(0.01, least(coalesce(input_drift_threshold, 5), 100)),
        now()
    )
    on conflict (user_id) do update
    set name = excluded.name,
        monthly_contribution = excluded.monthly_contribution,
        review_day = excluded.review_day,
        drift_threshold = excluded.drift_threshold,
        updated_at = now()
    returning id into saved_strategy_id;

    delete from public.strategy_buckets where strategy_id = saved_strategy_id;

    for bucket_input in select value from jsonb_array_elements(input_buckets) loop
        bucket_name := nullif(trim(coalesce(bucket_input ->> 'name', '')), '');
        bucket_target := (bucket_input ->> 'target_percentage')::numeric;

        if bucket_name is null or bucket_target is null or bucket_target < 0 or bucket_target > 100 then
            raise exception 'Each strategy bucket needs a name and target percentage';
        end if;

        insert into public.strategy_buckets (strategy_id, name, target_percentage, sort_order)
        values (saved_strategy_id, bucket_name, bucket_target, coalesce((bucket_input ->> 'sort_order')::integer, 0))
        returning id into saved_bucket_id;

        for tag_id in
            select value::bigint
            from jsonb_array_elements_text(coalesce(bucket_input -> 'tag_ids', '[]'::jsonb))
        loop
            if tag_id = any(seen_tag_ids) then
                raise exception 'A tag can only belong to one strategy bucket';
            end if;

            if not exists (
                select 1 from public.tags t where t.id = tag_id and t.user_id = current_user_id
            ) then
                raise exception 'Strategy bucket contains an invalid tag';
            end if;

            insert into public.strategy_bucket_tags (bucket_id, tag_id)
            values (saved_bucket_id, tag_id);
            seen_tag_ids := array_append(seen_tag_ids, tag_id);
        end loop;
    end loop;

    insert into public.activity_events (user_id, source, action_type, target_table, target_id, after_data, status)
    values (
        current_user_id,
        'user',
        'update_strategy',
        'strategies',
        saved_strategy_id::text,
        jsonb_build_object('name', trim(input_name), 'bucket_count', jsonb_array_length(input_buckets)),
        'succeeded'
    );

    return public.app_get_strategy_state(null);
end;
$$;

drop function if exists public.app_list_recent_activity(integer);

create function public.app_list_recent_activity(
    limit_count integer default 20,
    input_owner_user_id uuid default null
)
returns table (
    id bigint,
    source text,
    action_type text,
    natural_language_request text,
    target_table text,
    target_id text,
    before_data jsonb,
    after_data jsonb,
    status text,
    error_message text,
    created_at timestamptz
)
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
    )
    select
        ae.id,
        ae.source,
        ae.action_type,
        ae.natural_language_request,
        ae.target_table,
        ae.target_id,
        ae.before_data,
        ae.after_data,
        ae.status,
        ae.error_message,
        ae.created_at
    from public.activity_events ae
    join current_user_ctx ctx on ctx.user_id = ae.user_id
    order by ae.created_at desc
    limit least(greatest(coalesce(limit_count, 20), 1), 100);
$$;

grant execute on function public.app_get_strategy_state(uuid) to authenticated;
grant execute on function public.app_save_strategy(text, numeric, integer, numeric, jsonb) to authenticated;
grant execute on function public.app_list_recent_activity(integer, uuid) to authenticated;
