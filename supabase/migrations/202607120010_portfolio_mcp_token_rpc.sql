create or replace function public.mcp_touch_agent_token(input_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    resolved_user_id uuid;
begin
    select at.user_id
    into resolved_user_id
    from public.agent_tokens at
    where at.token_hash = lower(trim(coalesce(input_token_hash, '')))
      and at.revoked_at is null;

    if resolved_user_id is null then
        raise exception 'Invalid agent token';
    end if;

    update public.agent_tokens at
    set last_used_at = now()
    where at.token_hash = lower(trim(coalesce(input_token_hash, '')))
      and at.revoked_at is null;

    return resolved_user_id;
end;
$$;

create or replace function public.mcp_get_portfolio_state(input_token_hash text)
returns jsonb
language sql
security definer
set search_path = public
as $$
    with current_user_ctx as (
        select public.mcp_touch_agent_token(input_token_hash) as user_id
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
        'accounts',
        coalesce(
            (
                select jsonb_agg(to_jsonb(a) order by a.name)
                from public.accounts a
                join current_user_ctx ctx
                  on ctx.user_id = a.user_id
            ),
            '[]'::jsonb
        ),
        'holdings',
        coalesce(
            (
                select jsonb_agg(
                    to_jsonb(h)
                    || jsonb_build_object(
                        'instruments',
                        case
                            when i.ticker is null then null
                            else jsonb_build_object(
                                'display_name', i.display_name,
                                'currency', i.currency,
                                'instrument_type', i.instrument_type,
                                'note', i.note
                            )
                        end
                    )
                    order by h.account_id
                )
                from public.holdings h
                join current_user_ctx ctx
                  on ctx.user_id = h.user_id
                left join public.instruments i
                  on i.user_id = h.user_id
                 and i.ticker = h.ticker
            ),
            '[]'::jsonb
        ),
        'positions',
        '[]'::jsonb,
        'instruments',
        coalesce(
            (
                select jsonb_agg(to_jsonb(i) order by i.display_name)
                from public.instruments i
                join current_user_ctx ctx
                  on ctx.user_id = i.user_id
            ),
            '[]'::jsonb
        ),
        'tags',
        coalesce(
            (
                select jsonb_agg(to_jsonb(t) order by t.sort_order)
                from public.tags t
                join current_user_ctx ctx
                  on ctx.user_id = t.user_id
            ),
            '[]'::jsonb
        ),
        'instrumentTags',
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'ticker', it.ticker,
                        'tag_id', it.tag_id,
                        'tags',
                        case
                            when t.id is null then null
                            else jsonb_build_object(
                                'id', t.id,
                                'name', t.name,
                                'color', t.color
                            )
                        end
                    )
                    order by it.ticker
                )
                from public.instrument_tags it
                join current_user_ctx ctx
                  on ctx.user_id = it.user_id
                left join public.tags t
                  on t.user_id = it.user_id
                 and t.id = it.tag_id
            ),
            '[]'::jsonb
        ),
        'prices',
        coalesce(
            (
                select jsonb_agg(to_jsonb(lp) order by lp.price_date desc)
                from latest_prices lp
            ),
            '[]'::jsonb
        )
    );
$$;

create or replace function public.mcp_find_holdings(
    input_token_hash text,
    input_query text default null
)
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
security definer
set search_path = public
as $$
    with current_user_ctx as (
        select public.mcp_touch_agent_token(input_token_hash) as user_id
    )
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
    join current_user_ctx ctx
      on ctx.user_id = h.user_id
    join public.accounts a
      on a.id = h.account_id
     and a.user_id = h.user_id
    left join public.instruments i
      on i.user_id = h.user_id
     and i.ticker = h.ticker
    where (
        nullif(trim(coalesce(input_query, '')), '') is null
        or h.ticker ilike '%' || trim(input_query) || '%'
        or i.display_name ilike '%' || trim(input_query) || '%'
        or a.name ilike '%' || trim(input_query) || '%'
    )
    order by a.name, coalesce(i.display_name, h.ticker), h.ticker
    limit 20;
$$;

create or replace function public.mcp_list_recent_activity(
    input_token_hash text,
    limit_count integer default 20
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
security definer
set search_path = public
as $$
    with current_user_ctx as (
        select public.mcp_touch_agent_token(input_token_hash) as user_id
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
    join current_user_ctx ctx
      on ctx.user_id = ae.user_id
    order by ae.created_at desc
    limit least(greatest(coalesce(limit_count, 20), 1), 100);
$$;

create or replace function public.mcp_update_holding_avg_price(
    input_token_hash text,
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
    resolved_user_id uuid;
    before_row jsonb;
    after_row jsonb;
    event_id bigint;
begin
    resolved_user_id := public.mcp_touch_agent_token(input_token_hash);

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
          and h.user_id = resolved_user_id
    ) row_data;

    if before_row is null then
        raise exception 'Holding not found';
    end if;

    update public.holdings
    set avg_price = input_avg_price
    where id = input_holding_id
      and user_id = resolved_user_id;

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
          and h.user_id = resolved_user_id
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
        resolved_user_id,
        'agent',
        'update_holding_avg_price',
        nullif(trim(coalesce(input_request, '')), ''),
        'holdings',
        input_holding_id::text,
        before_row,
        after_row,
        'succeeded'
    )
    returning id into event_id;

    return query
    select
        event_id,
        input_holding_id,
        after_row ->> 'account_name',
        after_row ->> 'ticker',
        after_row ->> 'display_name',
        (before_row ->> 'avg_price')::numeric,
        (after_row ->> 'avg_price')::numeric;
end;
$$;

grant execute on function public.mcp_touch_agent_token(text) to anon, authenticated;
grant execute on function public.mcp_get_portfolio_state(text) to anon, authenticated;
grant execute on function public.mcp_find_holdings(text, text) to anon, authenticated;
grant execute on function public.mcp_list_recent_activity(text, integer) to anon, authenticated;
grant execute on function public.mcp_update_holding_avg_price(text, bigint, numeric, text) to anon, authenticated;
