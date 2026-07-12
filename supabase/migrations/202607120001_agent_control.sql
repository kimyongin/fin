create table if not exists public.activity_events (
    id bigserial primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    source text not null default 'agent',
    action_type text not null,
    natural_language_request text,
    target_table text,
    target_id text,
    before_data jsonb,
    after_data jsonb,
    status text not null default 'succeeded',
    error_message text,
    created_at timestamptz not null default now(),
    constraint activity_events_source_check check (source in ('user', 'agent')),
    constraint activity_events_status_check check (status in ('succeeded', 'failed'))
);

create index if not exists activity_events_user_created_at_idx
    on public.activity_events (user_id, created_at desc);

alter table public.activity_events enable row level security;

drop policy if exists activity_events_select_own on public.activity_events;
create policy activity_events_select_own
on public.activity_events
for select
to authenticated
using (user_id = auth.uid());

create or replace function public.activity_list_recent_events(limit_count integer default 20)
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
    where ae.user_id = auth.uid()
    order by ae.created_at desc
    limit least(greatest(coalesce(limit_count, 20), 1), 100);
$$;

create or replace function public.activity_record_user_event(
    input_action_type text,
    input_target_table text default null,
    input_target_id text default null,
    input_before_data jsonb default null,
    input_after_data jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    event_id bigint;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    if nullif(trim(coalesce(input_action_type, '')), '') is null then
        raise exception 'Action type is required';
    end if;

    insert into public.activity_events (
        user_id,
        source,
        action_type,
        target_table,
        target_id,
        before_data,
        after_data,
        status
    )
    values (
        current_user_id,
        'user',
        trim(input_action_type),
        nullif(trim(coalesce(input_target_table, '')), ''),
        nullif(trim(coalesce(input_target_id, '')), ''),
        input_before_data,
        input_after_data,
        'succeeded'
    )
    returning id into event_id;

    return event_id;
end;
$$;

create or replace function public.agent_find_holdings(input_query text)
returns table (
    holding_id bigint,
    account_id bigint,
    account_name text,
    ticker text,
    display_name text,
    quantity numeric,
    avg_price numeric,
    note text
)
language sql
stable
security definer
set search_path = public
as $$
    select
        h.id,
        h.account_id,
        a.name,
        h.ticker,
        coalesce(i.display_name, h.ticker),
        h.quantity,
        h.avg_price,
        h.note
    from public.holdings h
    join public.accounts a
      on a.id = h.account_id
     and a.user_id = h.user_id
    left join public.instruments i
      on i.user_id = h.user_id
     and i.ticker = h.ticker
    where h.user_id = auth.uid()
      and (
        nullif(trim(coalesce(input_query, '')), '') is null
        or h.ticker ilike '%' || trim(input_query) || '%'
        or i.display_name ilike '%' || trim(input_query) || '%'
        or a.name ilike '%' || trim(input_query) || '%'
      )
    order by a.name, coalesce(i.display_name, h.ticker), h.ticker
    limit 20;
$$;

create or replace function public.agent_update_holding_avg_price(
    input_holding_id bigint,
    input_avg_price numeric,
    input_request text default null
)
returns table (
    action_id bigint,
    holding_id bigint,
    account_name text,
    ticker text,
    display_name text,
    previous_avg_price numeric,
    next_avg_price numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    before_row jsonb;
    after_row jsonb;
    action_row_id bigint;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    if input_holding_id is null then
        raise exception 'Holding id is required';
    end if;

    if input_avg_price is null or input_avg_price < 0 then
        raise exception 'Average price must be zero or greater';
    end if;

    select to_jsonb(row_data)
    into before_row
    from (
        select
            h.id,
            h.account_id,
            a.name as account_name,
            h.ticker,
            coalesce(i.display_name, h.ticker) as display_name,
            h.quantity,
            h.avg_price,
            h.note
        from public.holdings h
        join public.accounts a
          on a.id = h.account_id
         and a.user_id = h.user_id
        left join public.instruments i
          on i.user_id = h.user_id
         and i.ticker = h.ticker
        where h.id = input_holding_id
          and h.user_id = current_user_id
    ) row_data;

    if before_row is null then
        raise exception 'Holding not found';
    end if;

    update public.holdings
    set avg_price = input_avg_price
    where id = input_holding_id
      and user_id = current_user_id;

    select to_jsonb(row_data)
    into after_row
    from (
        select
            h.id,
            h.account_id,
            a.name as account_name,
            h.ticker,
            coalesce(i.display_name, h.ticker) as display_name,
            h.quantity,
            h.avg_price,
            h.note
        from public.holdings h
        join public.accounts a
          on a.id = h.account_id
         and a.user_id = h.user_id
        left join public.instruments i
          on i.user_id = h.user_id
         and i.ticker = h.ticker
        where h.id = input_holding_id
          and h.user_id = current_user_id
    ) row_data;

    insert into public.activity_events (
        user_id,
        source,
        action_type,
        natural_language_request,
        target_table,
        target_id,
        before_data,
        after_data,
        status
    )
    values (
        current_user_id,
        'agent',
        'update_holding_avg_price',
        nullif(trim(coalesce(input_request, '')), ''),
        'holdings',
        input_holding_id::text,
        before_row,
        after_row,
        'succeeded'
    )
    returning id into action_row_id;

    return query
    select
        action_row_id,
        input_holding_id,
        after_row ->> 'account_name',
        after_row ->> 'ticker',
        after_row ->> 'display_name',
        (before_row ->> 'avg_price')::numeric,
        (after_row ->> 'avg_price')::numeric;
end;
$$;

grant execute on function public.activity_list_recent_events(integer) to authenticated;
grant execute on function public.activity_record_user_event(text, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.agent_find_holdings(text) to authenticated;
grant execute on function public.agent_update_holding_avg_price(bigint, numeric, text) to authenticated;
