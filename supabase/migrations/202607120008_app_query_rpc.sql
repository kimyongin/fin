create or replace function public.app_get_portfolio_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with current_user_ctx as (
        select auth.uid() as user_id
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

create or replace function public.app_find_holdings(input_query text default null)
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

create or replace function public.app_list_recent_activity(limit_count integer default 20)
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
    select *
    from public.activity_list_recent_events(limit_count);
$$;

grant execute on function public.app_get_portfolio_state() to authenticated;
grant execute on function public.app_find_holdings(text) to authenticated;
grant execute on function public.app_list_recent_activity(integer) to authenticated;
