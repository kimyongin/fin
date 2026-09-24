-- Retire only the account-holding memo. Instrument and account notes remain.

-- Prior local values were exported outside Git; production must be backed up before applying.

drop function public.mcp_save_holding(text,bigint,bigint,text,numeric,numeric,numeric,numeric,text,text);

drop function public.app_save_cash_holding(bigint,bigint,text,numeric,text,text,text);

drop function public.app_save_valuation_holding(bigint,bigint,text,numeric,numeric,text,text,text);

drop function public.app_save_nonmarket_holding(bigint,bigint,text,text,numeric,numeric,numeric,text,text,text);

drop function public.app_save_holding(bigint,bigint,text,numeric,numeric,text,text,text);

drop function public.mcp_delete_holding(text,bigint,text);

drop function public.app_delete_holding(bigint,text,text);

drop function public.agent_find_holdings(text);

drop function public.mcp_find_holdings(text,text);

drop function public.app_find_holdings(text);

alter table public.holdings drop column note;



-- Purpose-specific financial writes keep their existing validations and activity facts.

-- Their public contract no longer accepts or returns a holding memo.

CREATE OR REPLACE FUNCTION public.app_save_holding(input_holding_id bigint DEFAULT NULL::bigint, input_account_id bigint DEFAULT NULL::bigint, input_ticker text DEFAULT NULL::text, input_quantity numeric DEFAULT NULL::numeric, input_avg_price numeric DEFAULT NULL::numeric, input_source text DEFAULT 'user'::text, input_request text DEFAULT NULL::text)
 RETURNS TABLE(holding_id bigint, account_id bigint, account_name text, ticker text, display_name text, quantity numeric, avg_price numeric, activity_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            h.avg_price
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
            avg_price = input_avg_price
        where id = input_holding_id
          and user_id = current_user_id
        returning id into saved_holding_id;
    else
        insert into public.holdings (
            user_id,
            account_id,
            ticker,
            quantity,
            avg_price
        )
        values (
            current_user_id,
            input_account_id,
            normalized_ticker,
            input_quantity,
            input_avg_price
        )
        on conflict on constraint holdings_account_id_ticker_key do update
        set quantity = excluded.quantity,
            avg_price = excluded.avg_price
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
            h.avg_price
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
        event_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_save_nonmarket_holding(input_holding_id bigint, input_account_id bigint, input_ticker text, input_kind text, input_quantity numeric, input_purchase_amount numeric, input_valuation_amount numeric, input_source text, input_request text)
 RETURNS TABLE(holding_id bigint, account_id bigint, account_name text, ticker text, display_name text, quantity numeric, avg_price numeric, purchase_amount numeric, valuation_amount numeric, activity_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare current_user_id uuid := auth.uid(); normalized_ticker text := upper(trim(coalesce(input_ticker, ''))); before_row jsonb; after_row jsonb; saved_holding_id bigint; event_id bigint;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if input_source not in ('user', 'agent') then raise exception 'Invalid activity source'; end if;
  if input_account_id is null or normalized_ticker = '' then raise exception 'Account and instrument are required'; end if;
  if input_kind = 'valuation' and (input_purchase_amount is null or input_purchase_amount < 0 or input_valuation_amount is null or input_valuation_amount < 0) then raise exception 'Purchase and valuation amounts must be zero or greater'; end if;
  if input_kind = 'cash' and (input_valuation_amount is null or input_valuation_amount < 0) then raise exception 'Valuation amount must be zero or greater'; end if;
  if not exists (select 1 from public.accounts where id = input_account_id and user_id = current_user_id) then raise exception 'Account not found'; end if;
  if not exists (select 1 from public.instruments where user_id = current_user_id and ticker = normalized_ticker and instrument_type = input_kind) then raise exception 'Instrument type does not match holding'; end if;
  select to_jsonb(h) into before_row from public.holdings h where h.user_id = current_user_id and ((input_holding_id is not null and h.id = input_holding_id) or (input_holding_id is null and h.account_id = input_account_id and h.ticker = normalized_ticker)) limit 1;
  if input_holding_id is not null and before_row is null then raise exception 'Holding not found'; end if;
  if input_holding_id is not null then
    update public.holdings set account_id = input_account_id, ticker = normalized_ticker, quantity = null, avg_price = null,
      purchase_amount = case when input_kind = 'valuation' then input_purchase_amount else null end,
      valuation_amount = input_valuation_amount
    where id = input_holding_id and user_id = current_user_id returning id into saved_holding_id;
  else
    insert into public.holdings (user_id, account_id, ticker, quantity, avg_price, purchase_amount, valuation_amount)
    values (current_user_id, input_account_id, normalized_ticker, null, null,
      case when input_kind = 'valuation' then input_purchase_amount else null end, input_valuation_amount)
    on conflict on constraint holdings_account_id_ticker_key do update set quantity = null, avg_price = null, purchase_amount = excluded.purchase_amount, valuation_amount = excluded.valuation_amount
    returning id into saved_holding_id;
  end if;
  select to_jsonb(h) into after_row from public.holdings h where h.id = saved_holding_id and h.user_id = current_user_id;
  insert into public.activity_events (user_id, source, action_type, natural_language_request, target_table, target_id, before_data, after_data, status)
  values (current_user_id, input_source, case when before_row is null then 'create_holding' else 'update_holding' end, nullif(trim(coalesce(input_request, '')), ''), 'holdings', saved_holding_id::text, before_row, after_row, 'succeeded') returning id into event_id;
  return query select h.id, h.account_id, a.name, h.ticker, i.display_name, h.quantity::numeric, h.avg_price::numeric, h.purchase_amount, h.valuation_amount, event_id
  from public.holdings h join public.accounts a on a.id = h.account_id join public.instruments i on i.user_id = h.user_id and i.ticker = h.ticker where h.id = saved_holding_id;
end; $function$;

CREATE OR REPLACE FUNCTION public.app_save_valuation_holding(input_holding_id bigint DEFAULT NULL::bigint, input_account_id bigint DEFAULT NULL::bigint, input_ticker text DEFAULT NULL::text, input_purchase_amount numeric DEFAULT NULL::numeric, input_valuation_amount numeric DEFAULT NULL::numeric, input_source text DEFAULT 'user'::text, input_request text DEFAULT NULL::text)
 RETURNS TABLE(holding_id bigint, account_id bigint, account_name text, ticker text, display_name text, quantity numeric, avg_price numeric, purchase_amount numeric, valuation_amount numeric, activity_id bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from public.app_save_nonmarket_holding(input_holding_id, input_account_id, input_ticker, 'valuation', null, input_purchase_amount, input_valuation_amount, input_source, input_request);
$function$;

CREATE OR REPLACE FUNCTION public.app_save_cash_holding(input_holding_id bigint DEFAULT NULL::bigint, input_account_id bigint DEFAULT NULL::bigint, input_ticker text DEFAULT NULL::text, input_balance numeric DEFAULT NULL::numeric, input_source text DEFAULT 'user'::text, input_request text DEFAULT NULL::text)
 RETURNS TABLE(holding_id bigint, account_id bigint, account_name text, ticker text, display_name text, quantity numeric, avg_price numeric, purchase_amount numeric, valuation_amount numeric, activity_id bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from public.app_save_nonmarket_holding(input_holding_id, input_account_id, input_ticker, 'cash', null, null, input_balance, input_source, input_request);
$function$;

CREATE OR REPLACE FUNCTION public.app_delete_holding(input_holding_id bigint, input_source text DEFAULT 'user'::text, input_request text DEFAULT NULL::text)
 RETURNS TABLE(holding_id bigint, account_id bigint, account_name text, ticker text, display_name text, quantity numeric, avg_price numeric, activity_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            h.avg_price
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
        event_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_find_holdings(input_query text DEFAULT NULL::text)
 RETURNS TABLE(holding_id bigint, account_id bigint, account_name text, ticker text, display_name text, quantity numeric, avg_price numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select
        h.id,
        h.account_id,
        a.name,
        h.ticker,
        coalesce(i.display_name, h.ticker),
        h.quantity,
        h.avg_price
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
$function$;

CREATE OR REPLACE FUNCTION public.agent_find_holdings(input_query text)
 RETURNS TABLE(holding_id bigint, account_id bigint, account_name text, ticker text, display_name text, quantity numeric, avg_price numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select *
    from public.app_find_holdings(input_query);
$function$;

CREATE OR REPLACE FUNCTION public.mcp_find_holdings(input_token_hash text, input_query text DEFAULT NULL::text)
 RETURNS TABLE(holding_id bigint, account_id bigint, account_name text, ticker text, display_name text, quantity numeric, avg_price numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        h.avg_price
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
$function$;

CREATE OR REPLACE FUNCTION public.mcp_save_holding(input_token_hash text, input_holding_id bigint DEFAULT NULL::bigint, input_account_id bigint DEFAULT NULL::bigint, input_ticker text DEFAULT NULL::text, input_quantity numeric DEFAULT NULL::numeric, input_avg_price numeric DEFAULT NULL::numeric, input_purchase_amount numeric DEFAULT NULL::numeric, input_valuation_amount numeric DEFAULT NULL::numeric, input_request text DEFAULT NULL::text)
 RETURNS TABLE(holding_id bigint, account_id bigint, account_name text, ticker text, display_name text, instrument_type text, quantity numeric, avg_price numeric, purchase_amount numeric, valuation_amount numeric, activity_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare type_value text;
begin
  perform public.mcp_adopt_agent_token(input_token_hash);
  select instrument_type into type_value from public.instruments where user_id = auth.uid() and ticker = upper(trim(coalesce(input_ticker, '')));
  if type_value = 'valuation' then
    return query select h.holding_id, h.account_id, h.account_name, h.ticker, h.display_name, type_value, h.quantity, h.avg_price, h.purchase_amount, h.valuation_amount, h.activity_id from public.app_save_valuation_holding(input_holding_id, input_account_id, input_ticker, input_purchase_amount, input_valuation_amount, 'agent', input_request) h;
  elsif type_value = 'cash' then
    return query select h.holding_id, h.account_id, h.account_name, h.ticker, h.display_name, type_value, h.quantity, h.avg_price, h.purchase_amount, h.valuation_amount, h.activity_id from public.app_save_cash_holding(input_holding_id, input_account_id, input_ticker, input_valuation_amount, 'agent', input_request) h;
  elsif type_value = 'market' then
    return query select h.holding_id, h.account_id, h.account_name, h.ticker, h.display_name, type_value, h.quantity, h.avg_price, null::numeric, null::numeric, h.activity_id from public.app_save_holding(input_holding_id, input_account_id, input_ticker, input_quantity, input_avg_price, 'agent', input_request) h;
  else raise exception 'Instrument not found or cannot be held'; end if;
end; $function$;

CREATE OR REPLACE FUNCTION public.mcp_delete_holding(input_token_hash text, input_holding_id bigint, input_request text DEFAULT NULL::text)
 RETURNS TABLE(holding_id bigint, account_id bigint, account_name text, ticker text, display_name text, quantity numeric, avg_price numeric, activity_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return query
    select *
    from public.app_delete_holding(input_holding_id, 'agent', input_request);
end;
$function$;

CREATE OR REPLACE FUNCTION public.agent_update_holding_avg_price(input_holding_id bigint, input_avg_price numeric, input_request text DEFAULT NULL::text)
 RETURNS TABLE(action_id bigint, holding_id bigint, account_name text, ticker text, display_name text, previous_avg_price numeric, next_avg_price numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            h.avg_price
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
$function$;

CREATE OR REPLACE FUNCTION public.mcp_update_holding_avg_price(input_token_hash text, input_holding_id bigint, input_avg_price numeric, input_request text DEFAULT NULL::text)
 RETURNS TABLE(action_id bigint, holding_id bigint, account_name text, ticker text, display_name text, previous_avg_price numeric, next_avg_price numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
            h.avg_price
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
            h.avg_price
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
$function$;

CREATE OR REPLACE FUNCTION public.app_bulk_save_portfolio_rows(input_rows jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(account_count integer, instrument_count integer, holding_count integer, activity_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  current_user_id uuid := auth.uid();
  input_row jsonb;
  type_value text;
  ticker_value text;
  account_value text;
  name_value text;
  account_id_value bigint;
  instrument_id_value bigint;
  tag_id_value bigint;
  created_accounts integer := 0;
  created_instruments integer := 0;
  saved_holdings integer := 0;
  event_id bigint;
  quantity_value numeric;
  average_value numeric;
  purchase_value numeric;
  valuation_value numeric;
  before_snapshot jsonb;
  after_snapshot jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(input_rows) <> 'array' or jsonb_array_length(input_rows) = 0 or jsonb_array_length(input_rows) > 200 then raise exception 'Provide 1 to 200 rows'; end if;

  before_snapshot := public.app_portfolio_snapshot(current_user_id);

  for input_row in select value from jsonb_array_elements(input_rows) loop
    account_value := trim(coalesce(input_row ->> 'account_name', ''));
    name_value := trim(coalesce(input_row ->> 'display_name', ''));
    type_value := lower(trim(coalesce(input_row ->> 'instrument_type', 'market')));
    ticker_value := upper(trim(coalesce(input_row ->> 'ticker', '')));
    quantity_value := nullif(input_row ->> 'quantity', '')::numeric;
    average_value := nullif(input_row ->> 'avg_price', '')::numeric;
    purchase_value := nullif(input_row ->> 'purchase_amount', '')::numeric;
    valuation_value := nullif(input_row ->> 'valuation_amount', '')::numeric;

    if account_value = '' or name_value = '' then raise exception 'Account name and instrument name are required'; end if;
    if type_value not in ('market', 'valuation', 'cash') then raise exception 'Invalid instrument type'; end if;
    if type_value = 'market' and (ticker_value = '' or quantity_value is null or quantity_value < 0 or average_value is null or average_value < 0) then raise exception 'Market investments require ticker, quantity, and average price'; end if;
    if type_value = 'valuation' and (purchase_value is null or purchase_value < 0 or valuation_value is null or valuation_value < 0) then raise exception 'Valuation investments require purchase and valuation amounts'; end if;
    if type_value = 'cash' and (valuation_value is null or valuation_value < 0) then raise exception 'Cash requires a nonnegative valuation amount'; end if;

    if ticker_value = '' then
      ticker_value := case when type_value = 'cash' then 'CASH:' else 'VALUATION:' end
        || upper(substr(md5(account_value || '|' || name_value || '|' || coalesce(input_row ->> 'currency', 'KRW')), 1, 20));
    end if;

    select id into account_id_value from public.accounts where user_id = current_user_id and lower(name) = lower(account_value) limit 1;
    if account_id_value is null then
      insert into public.accounts (user_id, name, broker, is_active)
      values (current_user_id, account_value, nullif(trim(coalesce(input_row ->> 'broker', '')), ''), true)
      returning id into account_id_value;
      created_accounts := created_accounts + 1;
    else
      update public.accounts set broker = nullif(trim(coalesce(input_row ->> 'broker', '')), '') where id = account_id_value;
    end if;

    select id into instrument_id_value from public.instruments where user_id = current_user_id and ticker = ticker_value;
    if instrument_id_value is null then
      insert into public.instruments (user_id, ticker, display_name, currency, instrument_type, price_source)
      values (current_user_id, ticker_value, name_value, upper(coalesce(input_row ->> 'currency', 'KRW')), type_value, 'manual')
      returning id into instrument_id_value;
      created_instruments := created_instruments + 1;
    else
      update public.instruments
      set display_name = name_value, currency = upper(coalesce(input_row ->> 'currency', 'KRW')), instrument_type = type_value
      where id = instrument_id_value;
    end if;

    tag_id_value := nullif(input_row ->> 'tag_id', '')::bigint;
    if tag_id_value is not null and not exists (select 1 from public.tags where id = tag_id_value and user_id = current_user_id) then raise exception 'Tag not found'; end if;
    delete from public.instrument_tags where user_id = current_user_id and ticker = ticker_value;
    if tag_id_value is not null then insert into public.instrument_tags (user_id, ticker, tag_id) values (current_user_id, ticker_value, tag_id_value); end if;

    insert into public.holdings (user_id, account_id, ticker, quantity, avg_price, purchase_amount, valuation_amount)
    values (
      current_user_id, account_id_value, ticker_value,
      case when type_value = 'market' then quantity_value else null end,
      case when type_value = 'market' then average_value else null end,
      case when type_value = 'valuation' then purchase_value else null end,
      case when type_value in ('valuation', 'cash') then valuation_value else null end
    )
    on conflict on constraint holdings_account_id_ticker_key do update
    set quantity = excluded.quantity, avg_price = excluded.avg_price, purchase_amount = excluded.purchase_amount,
        valuation_amount = excluded.valuation_amount;
    saved_holdings := saved_holdings + 1;
  end loop;

  after_snapshot := public.app_portfolio_snapshot(current_user_id);

  insert into public.activity_events (user_id, source, action_type, target_table, before_data, after_data, status)
  values (
    current_user_id, 'user', 'bulk_edit_portfolio', 'portfolio',
    jsonb_build_object('portfolio_snapshot', before_snapshot),
    jsonb_build_object(
      'portfolio_snapshot', after_snapshot,
      'row_count', saved_holdings,
      'created_account_count', created_accounts,
      'created_instrument_count', created_instruments
    ),
    'succeeded'
  )
  returning id into event_id;

  return query select created_accounts, created_instruments, saved_holdings, event_id;
end;
$function$;

