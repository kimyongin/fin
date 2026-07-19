alter table public.strategies
    add column mode text not null default 'neutral' check (mode in ('growth', 'neutral', 'defensive')),
    add column mode_reason text not null default '',
    add column principles jsonb not null default '{}'::jsonb;

create table public.strategy_bucket_mode_targets (
    bucket_id bigint not null references public.strategy_buckets(id) on delete cascade,
    mode text not null check (mode in ('growth', 'neutral', 'defensive')),
    target_percentage numeric not null check (target_percentage >= 0 and target_percentage <= 100),
    primary key (bucket_id, mode)
);

alter table public.strategy_bucket_mode_targets enable row level security;

create policy strategy_bucket_mode_targets_select_own on public.strategy_bucket_mode_targets for select to authenticated using (
    exists (
        select 1
        from public.strategy_buckets bucket
        join public.strategies strategy on strategy.id = bucket.strategy_id
        where bucket.id = bucket_id and strategy.user_id = auth.uid()
    )
);

insert into public.strategy_bucket_mode_targets (bucket_id, mode, target_percentage)
select bucket.id, mode.value, bucket.target_percentage
from public.strategy_buckets bucket
cross join (values ('growth'), ('neutral'), ('defensive')) as mode(value);

drop function if exists public.mcp_save_strategy(text, text, numeric, integer, numeric, jsonb);
drop function if exists public.app_save_strategy(text, numeric, integer, numeric, jsonb);

create or replace function public.app_get_strategy_state(input_owner_user_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with requested_owner as (
        select coalesce(input_owner_user_id, auth.uid()) as user_id
    ), current_user_ctx as (
        select user_id from requested_owner where public.can_view_owner(user_id)
    ), current_strategy as (
        select strategy.* from public.strategies strategy join current_user_ctx ctx on ctx.user_id = strategy.user_id
    )
    select jsonb_build_object(
        'strategy', (select to_jsonb(strategy) from current_strategy strategy),
        'buckets', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', bucket.id,
                'name', bucket.name,
                'target_percentage', bucket.target_percentage,
                'sort_order', bucket.sort_order,
                'tag_ids', coalesce((select jsonb_agg(link.tag_id order by link.tag_id) from public.strategy_bucket_tags link where link.bucket_id = bucket.id), '[]'::jsonb),
                'mode_targets', jsonb_build_object(
                    'growth', coalesce((select target.target_percentage from public.strategy_bucket_mode_targets target where target.bucket_id = bucket.id and target.mode = 'growth'), bucket.target_percentage),
                    'neutral', coalesce((select target.target_percentage from public.strategy_bucket_mode_targets target where target.bucket_id = bucket.id and target.mode = 'neutral'), bucket.target_percentage),
                    'defensive', coalesce((select target.target_percentage from public.strategy_bucket_mode_targets target where target.bucket_id = bucket.id and target.mode = 'defensive'), bucket.target_percentage)
                )
            ) order by bucket.sort_order, bucket.id)
            from public.strategy_buckets bucket join current_strategy strategy on strategy.id = bucket.strategy_id
        ), '[]'::jsonb)
    );
$$;

create or replace function public.app_save_strategy(
    input_name text,
    input_monthly_contribution numeric,
    input_review_day integer,
    input_drift_threshold numeric,
    input_buckets jsonb,
    input_mode text default 'neutral',
    input_mode_reason text default '',
    input_principles jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid(); saved_strategy_id bigint; bucket_input jsonb; saved_bucket_id bigint;
    bucket_target numeric; bucket_name text; tag_id bigint; target_total numeric; seen_tag_ids bigint[] := '{}'; mode_name text;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if nullif(trim(coalesce(input_name, '')), '') is null then raise exception 'Strategy name is required'; end if;
    if jsonb_typeof(input_buckets) <> 'array' or jsonb_array_length(input_buckets) = 0 then raise exception 'At least one strategy bucket is required'; end if;
    if trim(coalesce(input_mode, '')) not in ('growth', 'neutral', 'defensive') then raise exception 'Invalid strategy mode'; end if;
    if jsonb_typeof(coalesce(input_principles, '{}'::jsonb)) <> 'object' then raise exception 'Principles must be an object'; end if;

    foreach mode_name in array array['growth', 'neutral', 'defensive'] loop
        select coalesce(sum(coalesce((value -> 'mode_targets' ->> mode_name)::numeric, (value ->> 'target_percentage')::numeric)), 0)
        into target_total from jsonb_array_elements(input_buckets);
        if abs(target_total - 100) > 0.01 then raise exception 'Strategy targets must add up to 100 percent for each mode'; end if;
    end loop;

    insert into public.strategies (user_id, name, monthly_contribution, review_day, drift_threshold, mode, mode_reason, principles, updated_at)
    values (current_user_id, trim(input_name), greatest(coalesce(input_monthly_contribution, 0), 0), greatest(1, least(coalesce(input_review_day, 1), 28)), greatest(0.01, least(coalesce(input_drift_threshold, 5), 100)), trim(input_mode), trim(coalesce(input_mode_reason, '')), coalesce(input_principles, '{}'::jsonb), now())
    on conflict (user_id) do update set name = excluded.name, monthly_contribution = excluded.monthly_contribution, review_day = excluded.review_day, drift_threshold = excluded.drift_threshold, mode = excluded.mode, mode_reason = excluded.mode_reason, principles = excluded.principles, updated_at = now()
    returning id into saved_strategy_id;

    delete from public.strategy_buckets where strategy_id = saved_strategy_id;
    for bucket_input in select value from jsonb_array_elements(input_buckets) loop
        bucket_name := nullif(trim(coalesce(bucket_input ->> 'name', '')), '');
        bucket_target := coalesce((bucket_input -> 'mode_targets' ->> 'neutral')::numeric, (bucket_input ->> 'target_percentage')::numeric);
        if bucket_name is null or bucket_target is null or bucket_target < 0 or bucket_target > 100 then raise exception 'Each strategy bucket needs a name and target percentage'; end if;
        insert into public.strategy_buckets (strategy_id, name, target_percentage, sort_order) values (saved_strategy_id, bucket_name, bucket_target, coalesce((bucket_input ->> 'sort_order')::integer, 0)) returning id into saved_bucket_id;
        foreach mode_name in array array['growth', 'neutral', 'defensive'] loop
            insert into public.strategy_bucket_mode_targets (bucket_id, mode, target_percentage) values (saved_bucket_id, mode_name, coalesce((bucket_input -> 'mode_targets' ->> mode_name)::numeric, bucket_target));
        end loop;
        for tag_id in select value::bigint from jsonb_array_elements_text(coalesce(bucket_input -> 'tag_ids', '[]'::jsonb)) loop
            if tag_id = any(seen_tag_ids) then raise exception 'A tag can only belong to one strategy bucket'; end if;
            if not exists (select 1 from public.tags tag where tag.id = tag_id and tag.user_id = current_user_id) then raise exception 'Strategy bucket contains an invalid tag'; end if;
            insert into public.strategy_bucket_tags (bucket_id, tag_id) values (saved_bucket_id, tag_id);
            seen_tag_ids := array_append(seen_tag_ids, tag_id);
        end loop;
    end loop;
    insert into public.activity_events (user_id, source, action_type, target_table, target_id, after_data, status)
    values (current_user_id, 'user', 'update_strategy', 'strategies', saved_strategy_id::text, jsonb_build_object('name', trim(input_name), 'mode', input_mode, 'mode_reason', trim(coalesce(input_mode_reason, '')), 'principles', coalesce(input_principles, '{}'::jsonb)), 'succeeded');
    return public.app_get_strategy_state(null);
end;
$$;

grant select on public.strategy_bucket_mode_targets to authenticated;
grant execute on function public.app_save_strategy(text, numeric, integer, numeric, jsonb, text, text, jsonb) to authenticated;

create or replace function public.mcp_save_strategy(
    input_token_hash text,
    input_name text,
    input_monthly_contribution numeric,
    input_review_day integer,
    input_drift_threshold numeric,
    input_buckets jsonb,
    input_mode text default 'neutral',
    input_mode_reason text default '',
    input_principles jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return public.app_save_strategy(input_name, input_monthly_contribution, input_review_day, input_drift_threshold, input_buckets, input_mode, input_mode_reason, input_principles);
end;
$$;

grant execute on function public.mcp_save_strategy(text, text, numeric, integer, numeric, jsonb, text, text, jsonb) to anon, authenticated;
