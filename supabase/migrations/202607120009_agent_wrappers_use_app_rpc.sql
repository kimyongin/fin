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
    select *
    from public.app_find_holdings(input_query);
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
    saved_row record;
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

    select *
    into saved_row
    from public.app_save_holding(
        input_holding_id,
        (before_row ->> 'account_id')::bigint,
        before_row ->> 'ticker',
        (before_row ->> 'quantity')::numeric,
        input_avg_price,
        before_row ->> 'note',
        'agent',
        input_request
    )
    limit 1;

    update public.activity_events
    set action_type = 'update_holding_avg_price'
    where id = saved_row.activity_id
      and user_id = current_user_id;

    return query
    select
        saved_row.activity_id,
        saved_row.holding_id,
        saved_row.account_name,
        saved_row.ticker,
        saved_row.display_name,
        (before_row ->> 'avg_price')::numeric,
        saved_row.avg_price;
end;
$$;

grant execute on function public.agent_find_holdings(text) to authenticated;
grant execute on function public.agent_update_holding_avg_price(bigint, numeric, text) to authenticated;
