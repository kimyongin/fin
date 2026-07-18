drop function if exists public.mcp_save_tag(text, bigint, text, text, integer, text);
drop function if exists public.app_save_tag(bigint, text, text, integer, text, text);

alter table public.tags drop column if exists color;

create function public.app_save_tag(
  input_tag_id bigint default null,
  input_name text default null,
  input_sort_order integer default 0,
  input_source text default 'user',
  input_request text default null
)
returns table (
  tag_id bigint,
  name text,
  sort_order integer,
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
  after_row jsonb;
  saved_tag_id bigint;
  event_id bigint;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_source not in ('user', 'agent') then
    raise exception 'Invalid activity source';
  end if;

  if nullif(trim(coalesce(input_name, '')), '') is null then
    raise exception 'Tag name is required';
  end if;

  if input_tag_id is not null then
    select to_jsonb(t) into before_row
    from public.tags t
    where t.id = input_tag_id and t.user_id = current_user_id;

    if before_row is null then
      raise exception 'Tag not found';
    end if;

    update public.tags
    set name = trim(input_name), sort_order = coalesce(input_sort_order, 0)
    where id = input_tag_id and user_id = current_user_id
    returning id into saved_tag_id;
  else
    insert into public.tags (user_id, name, sort_order)
    values (current_user_id, trim(input_name), coalesce(input_sort_order, 0))
    returning id into saved_tag_id;
  end if;

  select to_jsonb(t) into after_row
  from public.tags t
  where t.id = saved_tag_id and t.user_id = current_user_id;

  insert into public.activity_events (
    user_id, source, action_type, natural_language_request, target_table, target_id, before_data, after_data, status
  )
  values (
    current_user_id, normalized_source,
    case when before_row is null then 'create_tag' else 'update_tag' end,
    nullif(trim(coalesce(input_request, '')), ''),
    'tags', saved_tag_id::text, before_row, after_row, 'succeeded'
  )
  returning id into event_id;

  return query
  select (after_row ->> 'id')::bigint, after_row ->> 'name', (after_row ->> 'sort_order')::integer, event_id;
end;
$$;

create function public.mcp_save_tag(
  input_token_hash text,
  input_tag_id bigint default null,
  input_name text default null,
  input_sort_order integer default 0,
  input_request text default null
)
returns table (
  tag_id bigint,
  name text,
  sort_order integer,
  activity_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.mcp_adopt_agent_token(input_token_hash);
  return query
  select * from public.app_save_tag(input_tag_id, input_name, input_sort_order, 'agent', input_request);
end;
$$;

create or replace function public.app_get_portfolio_state(input_owner_user_id uuid default null)
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
    select user_id from requested_owner where public.can_view_owner(user_id)
  ),
  latest_prices as (
    select distinct on (hpd.ticker) hpd.ticker, hpd.price_date, hpd.close_price, hpd.source
    from public.holding_prices_daily hpd
    join current_user_ctx ctx on ctx.user_id = hpd.user_id
    where hpd.source <> 'holiday'
    order by hpd.ticker, hpd.price_date desc
  )
  select jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(to_jsonb(a) order by a.name) from public.accounts a join current_user_ctx ctx on ctx.user_id = a.user_id), '[]'::jsonb),
    'holdings', coalesce((
      select jsonb_agg(to_jsonb(h) || jsonb_build_object('instruments', case when i.ticker is null then null else jsonb_build_object('display_name', i.display_name, 'currency', i.currency, 'instrument_type', i.instrument_type, 'note', i.note) end) order by h.account_id)
      from public.holdings h join current_user_ctx ctx on ctx.user_id = h.user_id
      left join public.instruments i on i.user_id = h.user_id and i.ticker = h.ticker
    ), '[]'::jsonb),
    'positions', '[]'::jsonb,
    'instruments', coalesce((select jsonb_agg(to_jsonb(i) order by i.display_name) from public.instruments i join current_user_ctx ctx on ctx.user_id = i.user_id), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order) from public.tags t join current_user_ctx ctx on ctx.user_id = t.user_id), '[]'::jsonb),
    'instrumentTags', coalesce((
      select jsonb_agg(jsonb_build_object('ticker', it.ticker, 'tag_id', it.tag_id, 'tags', case when t.id is null then null else jsonb_build_object('id', t.id, 'name', t.name) end) order by it.ticker)
      from public.instrument_tags it join current_user_ctx ctx on ctx.user_id = it.user_id
      left join public.tags t on t.user_id = it.user_id and t.id = it.tag_id
    ), '[]'::jsonb),
    'prices', coalesce((select jsonb_agg(to_jsonb(lp) order by lp.price_date desc) from latest_prices lp), '[]'::jsonb)
  );
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
    select distinct on (hpd.ticker) hpd.ticker, hpd.price_date, hpd.close_price, hpd.source
    from public.holding_prices_daily hpd
    join current_user_ctx ctx on ctx.user_id = hpd.user_id
    where hpd.source <> 'holiday'
    order by hpd.ticker, hpd.price_date desc
  )
  select jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(to_jsonb(a) order by a.name) from public.accounts a join current_user_ctx ctx on ctx.user_id = a.user_id), '[]'::jsonb),
    'holdings', coalesce((
      select jsonb_agg(to_jsonb(h) || jsonb_build_object('instruments', case when i.ticker is null then null else jsonb_build_object('display_name', i.display_name, 'currency', i.currency, 'instrument_type', i.instrument_type, 'note', i.note) end) order by h.account_id)
      from public.holdings h join current_user_ctx ctx on ctx.user_id = h.user_id
      left join public.instruments i on i.user_id = h.user_id and i.ticker = h.ticker
    ), '[]'::jsonb),
    'positions', '[]'::jsonb,
    'instruments', coalesce((select jsonb_agg(to_jsonb(i) order by i.display_name) from public.instruments i join current_user_ctx ctx on ctx.user_id = i.user_id), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order) from public.tags t join current_user_ctx ctx on ctx.user_id = t.user_id), '[]'::jsonb),
    'instrumentTags', coalesce((
      select jsonb_agg(jsonb_build_object('ticker', it.ticker, 'tag_id', it.tag_id, 'tags', case when t.id is null then null else jsonb_build_object('id', t.id, 'name', t.name) end) order by it.ticker)
      from public.instrument_tags it join current_user_ctx ctx on ctx.user_id = it.user_id
      left join public.tags t on t.user_id = it.user_id and t.id = it.tag_id
    ), '[]'::jsonb),
    'prices', coalesce((select jsonb_agg(to_jsonb(lp) order by lp.price_date desc) from latest_prices lp), '[]'::jsonb)
  );
$$;

grant execute on function public.app_save_tag(bigint, text, integer, text, text) to authenticated;
grant execute on function public.mcp_save_tag(text, bigint, text, integer, text) to anon, authenticated;
grant execute on function public.app_get_portfolio_state(uuid) to authenticated;
grant execute on function public.mcp_get_portfolio_state(text) to anon, authenticated;
