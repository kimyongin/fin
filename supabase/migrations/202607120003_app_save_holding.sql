create or replace function public.app_save_holding(
    input_holding_id bigint default null,
    input_account_id bigint default null,
    input_ticker text default null,
    input_quantity numeric default null,
    input_avg_price numeric default null,
    input_note text default null,
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
    normalized_ticker text := upper(trim(coalesce(input_ticker, '')));
    normalized_source text := coalesce(nullif(trim(input_source), ''), 'user');
    before_row jsonb;
    after_row jsonb;
    saved_holding_id bigint;
    event_id bigint;
    activity_type text;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    if normalized_source not in ('user', 'agent') then
        raise exception 'Invalid activity source';
    end if;

    if input_account_id is null then
        raise exception 'Account is required';
    end if;

    if normalized_ticker = '' then
        raise exception 'Ticker is required';
    end if;

    if input_quantity is null or input_quantity < 0 then
        raise exception 'Quantity must be zero or greater';
    end if;

    if input_avg_price is null or input_avg_price < 0 then
        raise exception 'Average price must be zero or greater';
    end if;

    if not exists (
        select 1
        from public.accounts a
        where a.id = input_account_id
          and a.user_id = current_user_id
    ) then
        raise exception 'Account not found';
    end if;

    if not exists (
        select 1
        from public.instruments i
        where i.ticker = normalized_ticker
          and i.user_id = current_user_id
    ) then
        raise exception 'Instrument not found';
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
        where h.user_id = current_user_id
          and (
            (input_holding_id is not null and h.id = input_holding_id)
            or (
              input_holding_id is null
              and h.account_id = input_account_id
              and h.ticker = normalized_ticker
            )
          )
        limit 1
    ) row_data;

    if input_holding_id is not null and before_row is null then
        raise exception 'Holding not found';
    end if;

    if input_holding_id is not null then
        update public.holdings
        set account_id = input_account_id,
            ticker = normalized_ticker,
            quantity = input_quantity,
            avg_price = input_avg_price,
            note = nullif(trim(coalesce(input_note, '')), '')
        where id = input_holding_id
          and user_id = current_user_id
        returning id into saved_holding_id;
    else
        insert into public.holdings (
            user_id,
            account_id,
            ticker,
            quantity,
            avg_price,
            note
        )
        values (
            current_user_id,
            input_account_id,
            normalized_ticker,
            input_quantity,
            input_avg_price,
            nullif(trim(coalesce(input_note, '')), '')
        )
        on conflict on constraint holdings_account_id_ticker_key do update
        set quantity = excluded.quantity,
            avg_price = excluded.avg_price,
            note = excluded.note
        returning id into saved_holding_id;
    end if;

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
        where h.id = saved_holding_id
          and h.user_id = current_user_id
    ) row_data;

    activity_type := case when before_row is null then 'create_holding' else 'update_holding' end;

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
        activity_type,
        nullif(trim(coalesce(input_request, '')), ''),
        'holdings',
        saved_holding_id::text,
        before_row,
        after_row,
        'succeeded'
    )
    returning id into event_id;

    return query
    select
        (after_row ->> 'id')::bigint,
        (after_row ->> 'account_id')::bigint,
        after_row ->> 'account_name',
        after_row ->> 'ticker',
        after_row ->> 'display_name',
        (after_row ->> 'quantity')::numeric,
        (after_row ->> 'avg_price')::numeric,
        after_row ->> 'note',
        event_id;
end;
$$;

grant execute on function public.app_save_holding(bigint, bigint, text, numeric, numeric, text, text, text) to authenticated;
