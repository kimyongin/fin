create or replace function public.app_delete_holding(
    input_holding_id bigint,
    input_source text default 'user',
    input_request text default null
)
returns table (
    holding_id bigint,
    account_id bigint,
    account_name text,
    ticker text,
    display_name text,
    quantity numeric,
    avg_price numeric,
    note text,
    activity_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_source text := coalesce(nullif(trim(input_source), ''), 'user');
    before_row jsonb;
    event_id bigint;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    if normalized_source not in ('user', 'agent') then
        raise exception 'Invalid activity source';
    end if;

    if input_holding_id is null then
        raise exception 'Holding id is required';
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

    delete from public.holdings
    where id = input_holding_id
      and user_id = current_user_id;

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
        normalized_source,
        'delete_holding',
        nullif(trim(coalesce(input_request, '')), ''),
        'holdings',
        input_holding_id::text,
        before_row,
        null,
        'succeeded'
    )
    returning id into event_id;

    return query
    select
        (before_row ->> 'id')::bigint,
        (before_row ->> 'account_id')::bigint,
        before_row ->> 'account_name',
        before_row ->> 'ticker',
        before_row ->> 'display_name',
        (before_row ->> 'quantity')::numeric,
        (before_row ->> 'avg_price')::numeric,
        before_row ->> 'note',
        event_id;
end;
$$;

grant execute on function public.app_delete_holding(bigint, text, text) to authenticated;
