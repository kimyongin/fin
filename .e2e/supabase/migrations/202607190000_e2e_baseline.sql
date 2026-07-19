


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."activity_list_recent_events"("limit_count" integer DEFAULT 20) RETURNS TABLE("id" bigint, "source" "text", "action_type" "text", "natural_language_request" "text", "target_table" "text", "target_id" "text", "before_data" "jsonb", "after_data" "jsonb", "status" "text", "error_message" "text", "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."activity_list_recent_events"("limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."activity_record_user_event"("input_action_type" "text", "input_target_table" "text" DEFAULT NULL::"text", "input_target_id" "text" DEFAULT NULL::"text", "input_before_data" "jsonb" DEFAULT NULL::"jsonb", "input_after_data" "jsonb" DEFAULT NULL::"jsonb") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."activity_record_user_event"("input_action_type" "text", "input_target_table" "text", "input_target_id" "text", "input_before_data" "jsonb", "input_after_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_friend"("input_public_name" "text", "input_viewer_password" "text") RETURNS TABLE("owner_user_id" "uuid", "owner_public_name" "text", "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
    current_user_id uuid := auth.uid();
    owner_profile public.profiles;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    select *
    into owner_profile
    from public.profiles
    where public_name_normalized = public.normalize_public_name(input_public_name)
      and sharing_enabled;

    if owner_profile.user_id is null then
        raise exception 'Shared profile not found';
    end if;

    if owner_profile.user_id = current_user_id then
        raise exception 'Cannot add your own profile as a friend';
    end if;

    if coalesce(owner_profile.viewer_password_hash, '') = '' then
        raise exception 'Invalid viewer password';
    end if;

    if owner_profile.viewer_password_hash like '$2%' then
        if owner_profile.viewer_password_hash <> extensions.crypt(coalesce(input_viewer_password, ''), owner_profile.viewer_password_hash) then
            raise exception 'Invalid viewer password';
        end if;
    elsif owner_profile.viewer_password_hash <> encode(extensions.digest(coalesce(input_viewer_password, ''), 'sha256'), 'hex') then
        raise exception 'Invalid viewer password';
    end if;

    insert into public.friendships (viewer_user_id, owner_user_id)
    values (current_user_id, owner_profile.user_id)
    on conflict on constraint friendships_pkey do nothing;

    return query
    select f.owner_user_id, owner_profile.public_name, f.created_at
    from public.friendships f
    where f.viewer_user_id = current_user_id
      and f.owner_user_id = owner_profile.user_id;
end;
$_$;


ALTER FUNCTION "public"."add_friend"("input_public_name" "text", "input_viewer_password" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agent_create_token"("input_name" "text", "input_token_hash" "text", "input_token_prefix" "text") RETURNS TABLE("id" "uuid", "name" "text", "token_prefix" "text", "last_used_at" timestamp with time zone, "revoked_at" timestamp with time zone, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
    current_user_id uuid := auth.uid();
    trimmed_name text := nullif(trim(coalesce(input_name, '')), '');
    trimmed_hash text := lower(nullif(trim(coalesce(input_token_hash, '')), ''));
    trimmed_prefix text := nullif(trim(coalesce(input_token_prefix, '')), '');
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    if trimmed_hash is null or trimmed_hash !~ '^[0-9a-f]{64}$' then
        raise exception 'Token hash must be a SHA-256 hex string';
    end if;

    if trimmed_prefix is null or length(trimmed_prefix) > 32 then
        raise exception 'Token prefix is required';
    end if;

    return query
    insert into public.agent_tokens (
        user_id,
        name,
        token_hash,
        token_prefix
    )
    values (
        current_user_id,
        coalesce(trimmed_name, 'Codex agent'),
        trimmed_hash,
        trimmed_prefix
    )
    returning
        agent_tokens.id,
        agent_tokens.name,
        agent_tokens.token_prefix,
        agent_tokens.last_used_at,
        agent_tokens.revoked_at,
        agent_tokens.created_at;
end;
$_$;


ALTER FUNCTION "public"."agent_create_token"("input_name" "text", "input_token_hash" "text", "input_token_prefix" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agent_find_holdings"("input_query" "text") RETURNS TABLE("holding_id" bigint, "account_id" bigint, "account_name" "text", "ticker" "text", "display_name" "text", "quantity" numeric, "avg_price" numeric, "note" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    select *
    from public.app_find_holdings(input_query);
$$;


ALTER FUNCTION "public"."agent_find_holdings"("input_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agent_list_tokens"() RETURNS TABLE("id" "uuid", "name" "text", "token_prefix" "text", "last_used_at" timestamp with time zone, "revoked_at" timestamp with time zone, "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    select
        at.id,
        at.name,
        at.token_prefix,
        at.last_used_at,
        at.revoked_at,
        at.created_at
    from public.agent_tokens at
    where at.user_id = auth.uid()
    order by at.created_at desc;
$$;


ALTER FUNCTION "public"."agent_list_tokens"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agent_revoke_token"("input_token_id" "uuid") RETURNS TABLE("id" "uuid", "name" "text", "token_prefix" "text", "last_used_at" timestamp with time zone, "revoked_at" timestamp with time zone, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    current_user_id uuid := auth.uid();
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    return query
    update public.agent_tokens at
    set revoked_at = coalesce(at.revoked_at, now())
    where at.id = input_token_id
      and at.user_id = current_user_id
    returning
        at.id,
        at.name,
        at.token_prefix,
        at.last_used_at,
        at.revoked_at,
        at.created_at;
end;
$$;


ALTER FUNCTION "public"."agent_revoke_token"("input_token_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agent_update_holding_avg_price"("input_holding_id" bigint, "input_avg_price" numeric, "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("action_id" bigint, "holding_id" bigint, "account_name" "text", "ticker" "text", "display_name" "text", "previous_avg_price" numeric, "next_avg_price" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."agent_update_holding_avg_price"("input_holding_id" bigint, "input_avg_price" numeric, "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_bulk_save_portfolio_rows"("input_rows" "jsonb" DEFAULT '[]'::"jsonb") RETURNS TABLE("account_count" integer, "instrument_count" integer, "holding_count" integer, "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

    insert into public.holdings (user_id, account_id, ticker, quantity, avg_price, purchase_amount, valuation_amount, note)
    values (
      current_user_id, account_id_value, ticker_value,
      case when type_value = 'market' then quantity_value else null end,
      case when type_value = 'market' then average_value else null end,
      case when type_value = 'valuation' then purchase_value else null end,
      case when type_value in ('valuation', 'cash') then valuation_value else null end,
      nullif(trim(coalesce(input_row ->> 'note', '')), '')
    )
    on conflict on constraint holdings_account_id_ticker_key do update
    set quantity = excluded.quantity, avg_price = excluded.avg_price, purchase_amount = excluded.purchase_amount,
        valuation_amount = excluded.valuation_amount, note = excluded.note;
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
$$;


ALTER FUNCTION "public"."app_bulk_save_portfolio_rows"("input_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_delete_account"("input_account_id" bigint, "input_source" "text" DEFAULT 'user'::"text", "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("account_id" bigint, "name" "text", "broker" "text", "note" "text", "is_active" boolean, "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

    if input_account_id is null then
        raise exception 'Account id is required';
    end if;

    select to_jsonb(a)
    into before_row
    from public.accounts a
    where a.id = input_account_id
      and a.user_id = current_user_id;

    if before_row is null then
        raise exception 'Account not found';
    end if;

    if exists (
        select 1
        from public.holdings h
        where h.account_id = input_account_id
          and h.user_id = current_user_id
    ) then
        raise exception 'Account has linked holdings';
    end if;

    delete from public.accounts
    where id = input_account_id
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
        'delete_account',
        nullif(trim(coalesce(input_request, '')), ''),
        'accounts',
        input_account_id::text,
        before_row,
        null,
        'succeeded'
    )
    returning id into event_id;

    return query
    select
        (before_row ->> 'id')::bigint,
        before_row ->> 'name',
        before_row ->> 'broker',
        before_row ->> 'note',
        (before_row ->> 'is_active')::boolean,
        event_id;
end;
$$;


ALTER FUNCTION "public"."app_delete_account"("input_account_id" bigint, "input_source" "text", "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_delete_holding"("input_holding_id" bigint, "input_source" "text" DEFAULT 'user'::"text", "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("holding_id" bigint, "account_id" bigint, "account_name" "text", "ticker" "text", "display_name" "text", "quantity" numeric, "avg_price" numeric, "note" "text", "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."app_delete_holding"("input_holding_id" bigint, "input_source" "text", "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_delete_instrument"("input_instrument_id" bigint, "input_source" "text" DEFAULT 'user'::"text", "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("instrument_id" bigint, "ticker" "text", "display_name" "text", "currency" "text", "instrument_type" "text", "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    current_user_id uuid := auth.uid();
    normalized_source text := coalesce(nullif(trim(input_source), ''), 'user');
    before_row jsonb;
    target_ticker text;
    event_id bigint;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;
    if normalized_source not in ('user', 'agent') then
        raise exception 'Invalid activity source';
    end if;
    if input_instrument_id is null then
        raise exception 'Instrument id is required';
    end if;

    select to_jsonb(i), i.ticker
    into before_row, target_ticker
    from public.instruments i
    where i.id = input_instrument_id
      and i.user_id = current_user_id;

    if before_row is null then
        raise exception 'Instrument not found';
    end if;
    if exists (
        select 1 from public.holdings h
        where h.user_id = current_user_id and h.ticker = target_ticker
    ) then
        raise exception 'Instrument has linked holdings';
    end if;

    delete from public.instrument_tags it
    where it.user_id = current_user_id and it.ticker = target_ticker;
    delete from public.holding_prices_daily hp
    where hp.user_id = current_user_id and hp.ticker = target_ticker;
    delete from public.instruments i
    where i.id = input_instrument_id and i.user_id = current_user_id;

    insert into public.activity_events (
        user_id, source, action_type, natural_language_request, target_table, target_id, before_data, after_data, status
    ) values (
        current_user_id, normalized_source, 'delete_instrument', nullif(trim(coalesce(input_request, '')), ''),
        'instruments', input_instrument_id::text, before_row, null, 'succeeded'
    ) returning id into event_id;

    return query select
        (before_row ->> 'id')::bigint,
        before_row ->> 'ticker',
        before_row ->> 'display_name',
        before_row ->> 'currency',
        before_row ->> 'instrument_type',
        event_id;
end;
$$;


ALTER FUNCTION "public"."app_delete_instrument"("input_instrument_id" bigint, "input_source" "text", "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_delete_tag"("input_tag_id" bigint, "input_source" "text" DEFAULT 'user'::"text", "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("tag_id" bigint, "unlinked_instrument_count" integer, "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_user_id uuid := auth.uid();
  normalized_source text := coalesce(nullif(trim(input_source), ''), 'user');
  tag_row jsonb;
  unlinked_tickers jsonb;
  before_row jsonb;
  after_row jsonb;
  removed_count integer;
  event_id bigint;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_source not in ('user', 'agent') then
    raise exception 'Invalid activity source';
  end if;

  select to_jsonb(t) into tag_row
  from public.tags t
  where t.id = input_tag_id and t.user_id = current_user_id;

  if tag_row is null then
    raise exception 'Tag not found';
  end if;

  with removed_links as (
    delete from public.instrument_tags it
    where it.user_id = current_user_id and it.tag_id = input_tag_id
    returning it.ticker
  )
  select coalesce(jsonb_agg(ticker order by ticker), '[]'::jsonb), count(*)::integer
  into unlinked_tickers, removed_count
  from removed_links;

  before_row := tag_row || jsonb_build_object('linked_tickers', unlinked_tickers);

  delete from public.tags t
  where t.id = input_tag_id and t.user_id = current_user_id;

  after_row := jsonb_build_object(
    'id', input_tag_id,
    'deleted', true,
    'unlinked_tickers', unlinked_tickers
  );

  insert into public.activity_events (
    user_id, source, action_type, natural_language_request, target_table, target_id, before_data, after_data, status
  )
  values (
    current_user_id, normalized_source, 'delete_tag', nullif(trim(coalesce(input_request, '')), ''),
    'tags', input_tag_id::text, before_row, after_row, 'succeeded'
  )
  returning id into event_id;

  return query select input_tag_id, removed_count, event_id;
end;
$$;


ALTER FUNCTION "public"."app_delete_tag"("input_tag_id" bigint, "input_source" "text", "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_find_holdings"("input_query" "text" DEFAULT NULL::"text") RETURNS TABLE("holding_id" bigint, "account_id" bigint, "account_name" "text", "ticker" "text", "display_name" "text", "quantity" numeric, "avg_price" numeric, "note" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."app_find_holdings"("input_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_get_portfolio_state"("input_owner_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."app_get_portfolio_state"("input_owner_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_get_strategy_state"("input_owner_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."app_get_strategy_state"("input_owner_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_list_recent_activity"("limit_count" integer DEFAULT 20, "input_owner_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" bigint, "source" "text", "action_type" "text", "natural_language_request" "text", "target_table" "text", "target_id" "text", "before_data" "jsonb", "after_data" "jsonb", "status" "text", "error_message" "text", "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."app_list_recent_activity"("limit_count" integer, "input_owner_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_portfolio_snapshot"("input_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.accounts a where a.user_id = input_user_id), '[]'::jsonb),
    'instruments', coalesce((select jsonb_agg(to_jsonb(i) order by i.ticker) from public.instruments i where i.user_id = input_user_id), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order, t.id) from public.tags t where t.user_id = input_user_id), '[]'::jsonb),
    'instrument_tags', coalesce((select jsonb_agg(to_jsonb(it) order by it.ticker) from public.instrument_tags it where it.user_id = input_user_id), '[]'::jsonb),
    'holdings', coalesce((select jsonb_agg(to_jsonb(h) order by h.account_id, h.ticker) from public.holdings h where h.user_id = input_user_id), '[]'::jsonb)
  );
$$;


ALTER FUNCTION "public"."app_portfolio_snapshot"("input_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_save_account"("input_account_id" bigint DEFAULT NULL::bigint, "input_name" "text" DEFAULT NULL::"text", "input_broker" "text" DEFAULT NULL::"text", "input_note" "text" DEFAULT NULL::"text", "input_source" "text" DEFAULT 'user'::"text", "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("account_id" bigint, "name" "text", "broker" "text", "note" "text", "is_active" boolean, "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    current_user_id uuid := auth.uid();
    normalized_source text := coalesce(nullif(trim(input_source), ''), 'user');
    before_row jsonb;
    after_row jsonb;
    saved_account_id bigint;
    event_id bigint;
    activity_type text;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    if normalized_source not in ('user', 'agent') then
        raise exception 'Invalid activity source';
    end if;

    if nullif(trim(coalesce(input_name, '')), '') is null then
        raise exception 'Account name is required';
    end if;

    if input_account_id is not null then
        select to_jsonb(a)
        into before_row
        from public.accounts a
        where a.id = input_account_id
          and a.user_id = current_user_id;

        if before_row is null then
            raise exception 'Account not found';
        end if;

        update public.accounts
        set name = trim(input_name),
            broker = nullif(trim(coalesce(input_broker, '')), ''),
            note = nullif(trim(coalesce(input_note, '')), ''),
            is_active = true
        where id = input_account_id
          and user_id = current_user_id
        returning id into saved_account_id;
    else
        insert into public.accounts (
            user_id,
            name,
            broker,
            note,
            is_active
        )
        values (
            current_user_id,
            trim(input_name),
            nullif(trim(coalesce(input_broker, '')), ''),
            nullif(trim(coalesce(input_note, '')), ''),
            true
        )
        returning id into saved_account_id;
    end if;

    select to_jsonb(a)
    into after_row
    from public.accounts a
    where a.id = saved_account_id
      and a.user_id = current_user_id;

    activity_type := case when before_row is null then 'create_account' else 'update_account' end;

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
        'accounts',
        saved_account_id::text,
        before_row,
        after_row,
        'succeeded'
    )
    returning id into event_id;

    return query
    select
        (after_row ->> 'id')::bigint,
        after_row ->> 'name',
        after_row ->> 'broker',
        after_row ->> 'note',
        (after_row ->> 'is_active')::boolean,
        event_id;
end;
$$;


ALTER FUNCTION "public"."app_save_account"("input_account_id" bigint, "input_name" "text", "input_broker" "text", "input_note" "text", "input_source" "text", "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_save_cash_holding"("input_holding_id" bigint DEFAULT NULL::bigint, "input_account_id" bigint DEFAULT NULL::bigint, "input_ticker" "text" DEFAULT NULL::"text", "input_balance" numeric DEFAULT NULL::numeric, "input_note" "text" DEFAULT NULL::"text", "input_source" "text" DEFAULT 'user'::"text", "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("holding_id" bigint, "account_id" bigint, "account_name" "text", "ticker" "text", "display_name" "text", "quantity" numeric, "avg_price" numeric, "purchase_amount" numeric, "valuation_amount" numeric, "note" "text", "activity_id" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select * from public.app_save_nonmarket_holding(input_holding_id, input_account_id, input_ticker, 'cash', null, null, input_balance, input_note, input_source, input_request);
$$;


ALTER FUNCTION "public"."app_save_cash_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_balance" numeric, "input_note" "text", "input_source" "text", "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_save_holding"("input_holding_id" bigint DEFAULT NULL::bigint, "input_account_id" bigint DEFAULT NULL::bigint, "input_ticker" "text" DEFAULT NULL::"text", "input_quantity" numeric DEFAULT NULL::numeric, "input_avg_price" numeric DEFAULT NULL::numeric, "input_note" "text" DEFAULT NULL::"text", "input_source" "text" DEFAULT 'user'::"text", "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("holding_id" bigint, "account_id" bigint, "account_name" "text", "ticker" "text", "display_name" "text", "quantity" numeric, "avg_price" numeric, "note" "text", "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."app_save_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_quantity" numeric, "input_avg_price" numeric, "input_note" "text", "input_source" "text", "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_save_instrument"("input_instrument_id" bigint DEFAULT NULL::bigint, "input_ticker" "text" DEFAULT NULL::"text", "input_display_name" "text" DEFAULT NULL::"text", "input_currency" "text" DEFAULT 'KRW'::"text", "input_instrument_type" "text" DEFAULT 'market'::"text", "input_price" numeric DEFAULT NULL::numeric, "input_price_date" "date" DEFAULT NULL::"date", "input_tag_id" bigint DEFAULT NULL::bigint, "input_source" "text" DEFAULT 'user'::"text", "input_request" "text" DEFAULT NULL::"text", "input_price_source" "text" DEFAULT 'manual'::"text", "input_note" "text" DEFAULT NULL::"text") RETURNS TABLE("instrument_id" bigint, "ticker" "text", "display_name" "text", "currency" "text", "instrument_type" "text", "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    current_user_id uuid := auth.uid();
    normalized_source text := coalesce(nullif(trim(input_source), ''), 'user');
    normalized_ticker text := upper(trim(coalesce(input_ticker, '')));
    normalized_type text := case lower(trim(coalesce(input_instrument_type, 'market')))
        when 'valuation' then 'valuation'
        when 'cash' then 'cash'
        when 'fx' then 'fx'
        else 'market'
    end;
    before_row jsonb;
    after_row jsonb;
    saved_instrument_id bigint;
    event_id bigint;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if normalized_source not in ('user', 'agent') then raise exception 'Invalid activity source'; end if;
    if normalized_ticker = '' then raise exception 'Ticker is required'; end if;
    if nullif(trim(coalesce(input_display_name, '')), '') is null then raise exception 'Display name is required'; end if;
    if input_price is not null and input_price <= 0 then raise exception 'Price must be greater than zero'; end if;
    if input_tag_id is not null and not exists (select 1 from public.tags t where t.id = input_tag_id and t.user_id = current_user_id) then raise exception 'Tag not found'; end if;

    if input_instrument_id is not null then
        select to_jsonb(i) into before_row from public.instruments i where i.id = input_instrument_id and i.user_id = current_user_id;
        if before_row is null then raise exception 'Instrument not found'; end if;
        update public.instruments i
        set display_name = trim(input_display_name), currency = coalesce(nullif(trim(input_currency), ''), 'KRW'),
            instrument_type = normalized_type, price_source = coalesce(nullif(trim(input_price_source), ''), 'manual'),
            note = nullif(trim(coalesce(input_note, '')), '')
        where i.id = input_instrument_id and i.user_id = current_user_id
        returning i.id, i.ticker into saved_instrument_id, normalized_ticker;
    else
        select to_jsonb(i) into before_row from public.instruments i where i.user_id = current_user_id and i.ticker = normalized_ticker;
        if before_row is null then
            insert into public.instruments (user_id, ticker, display_name, currency, instrument_type, price_source, note)
            values (current_user_id, normalized_ticker, trim(input_display_name), coalesce(nullif(trim(input_currency), ''), 'KRW'), normalized_type, coalesce(nullif(trim(input_price_source), ''), 'manual'), nullif(trim(coalesce(input_note, '')), ''))
            returning id into saved_instrument_id;
        else
            update public.instruments i
            set display_name = trim(input_display_name), currency = coalesce(nullif(trim(input_currency), ''), 'KRW'),
                instrument_type = normalized_type, price_source = coalesce(nullif(trim(input_price_source), ''), 'manual'),
                note = nullif(trim(coalesce(input_note, '')), '')
            where i.user_id = current_user_id and i.ticker = normalized_ticker
            returning i.id into saved_instrument_id;
        end if;
    end if;

    if input_price is not null then
        insert into public.holding_prices_daily (user_id, ticker, price_date, close_price, source)
        values (current_user_id, normalized_ticker, coalesce(input_price_date, current_date), input_price, coalesce(nullif(trim(input_price_source), ''), 'manual'))
        on conflict on constraint holding_prices_daily_user_id_ticker_price_date_key do update
        set close_price = excluded.close_price, source = excluded.source;
    end if;

    delete from public.instrument_tags it where it.user_id = current_user_id and it.ticker = normalized_ticker;
    if input_tag_id is not null then
        insert into public.instrument_tags (user_id, ticker, tag_id) values (current_user_id, normalized_ticker, input_tag_id);
    end if;

    select to_jsonb(i) into after_row from public.instruments i where i.id = saved_instrument_id and i.user_id = current_user_id;
    insert into public.activity_events (user_id, source, action_type, natural_language_request, target_table, target_id, before_data, after_data, status)
    values (current_user_id, normalized_source, case when before_row is null then 'create_instrument' else 'update_instrument' end,
        nullif(trim(coalesce(input_request, '')), ''), 'instruments', saved_instrument_id::text, before_row, after_row, 'succeeded')
    returning id into event_id;

    return query select (after_row ->> 'id')::bigint, after_row ->> 'ticker', after_row ->> 'display_name', after_row ->> 'currency', after_row ->> 'instrument_type', event_id;
end;
$$;


ALTER FUNCTION "public"."app_save_instrument"("input_instrument_id" bigint, "input_ticker" "text", "input_display_name" "text", "input_currency" "text", "input_instrument_type" "text", "input_price" numeric, "input_price_date" "date", "input_tag_id" bigint, "input_source" "text", "input_request" "text", "input_price_source" "text", "input_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_save_nonmarket_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_kind" "text", "input_quantity" numeric, "input_purchase_amount" numeric, "input_valuation_amount" numeric, "input_note" "text", "input_source" "text", "input_request" "text") RETURNS TABLE("holding_id" bigint, "account_id" bigint, "account_name" "text", "ticker" "text", "display_name" "text", "quantity" numeric, "avg_price" numeric, "purchase_amount" numeric, "valuation_amount" numeric, "note" "text", "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
      valuation_amount = input_valuation_amount, note = nullif(trim(coalesce(input_note, '')), '')
    where id = input_holding_id and user_id = current_user_id returning id into saved_holding_id;
  else
    insert into public.holdings (user_id, account_id, ticker, quantity, avg_price, purchase_amount, valuation_amount, note)
    values (current_user_id, input_account_id, normalized_ticker, null, null,
      case when input_kind = 'valuation' then input_purchase_amount else null end, input_valuation_amount, nullif(trim(coalesce(input_note, '')), ''))
    on conflict on constraint holdings_account_id_ticker_key do update set quantity = null, avg_price = null, purchase_amount = excluded.purchase_amount, valuation_amount = excluded.valuation_amount, note = excluded.note
    returning id into saved_holding_id;
  end if;
  select to_jsonb(h) into after_row from public.holdings h where h.id = saved_holding_id and h.user_id = current_user_id;
  insert into public.activity_events (user_id, source, action_type, natural_language_request, target_table, target_id, before_data, after_data, status)
  values (current_user_id, input_source, case when before_row is null then 'create_holding' else 'update_holding' end, nullif(trim(coalesce(input_request, '')), ''), 'holdings', saved_holding_id::text, before_row, after_row, 'succeeded') returning id into event_id;
  return query select h.id, h.account_id, a.name, h.ticker, i.display_name, h.quantity, h.avg_price, h.purchase_amount, h.valuation_amount, h.note, event_id
  from public.holdings h join public.accounts a on a.id = h.account_id join public.instruments i on i.user_id = h.user_id and i.ticker = h.ticker where h.id = saved_holding_id;
end; $$;


ALTER FUNCTION "public"."app_save_nonmarket_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_kind" "text", "input_quantity" numeric, "input_purchase_amount" numeric, "input_valuation_amount" numeric, "input_note" "text", "input_source" "text", "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_save_strategy"("input_name" "text", "input_monthly_contribution" numeric, "input_review_day" integer, "input_drift_threshold" numeric, "input_buckets" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."app_save_strategy"("input_name" "text", "input_monthly_contribution" numeric, "input_review_day" integer, "input_drift_threshold" numeric, "input_buckets" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_save_tag"("input_tag_id" bigint DEFAULT NULL::bigint, "input_name" "text" DEFAULT NULL::"text", "input_sort_order" integer DEFAULT 0, "input_source" "text" DEFAULT 'user'::"text", "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("tag_id" bigint, "name" "text", "sort_order" integer, "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."app_save_tag"("input_tag_id" bigint, "input_name" "text", "input_sort_order" integer, "input_source" "text", "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."app_save_valuation_holding"("input_holding_id" bigint DEFAULT NULL::bigint, "input_account_id" bigint DEFAULT NULL::bigint, "input_ticker" "text" DEFAULT NULL::"text", "input_purchase_amount" numeric DEFAULT NULL::numeric, "input_valuation_amount" numeric DEFAULT NULL::numeric, "input_note" "text" DEFAULT NULL::"text", "input_source" "text" DEFAULT 'user'::"text", "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("holding_id" bigint, "account_id" bigint, "account_name" "text", "ticker" "text", "display_name" "text", "quantity" numeric, "avg_price" numeric, "purchase_amount" numeric, "valuation_amount" numeric, "note" "text", "activity_id" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select * from public.app_save_nonmarket_holding(input_holding_id, input_account_id, input_ticker, 'valuation', null, input_purchase_amount, input_valuation_amount, input_note, input_source, input_request);
$$;


ALTER FUNCTION "public"."app_save_valuation_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_purchase_amount" numeric, "input_valuation_amount" numeric, "input_note" "text", "input_source" "text", "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_owner"("owner_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    select
        owner_id = auth.uid()
        or exists (
            select 1
            from public.friendships f
            join public.profiles p
              on p.user_id = f.owner_user_id
            where f.viewer_user_id = auth.uid()
              and f.owner_user_id = owner_id
              and p.sharing_enabled
        )
        or exists (
            select 1
            from public.viewer_sessions vs
            join public.profiles p
              on p.user_id = vs.owner_user_id
            where vs.viewer_user_id = auth.uid()
              and vs.owner_user_id = owner_id
              and vs.expires_at > now()
              and p.sharing_enabled
              and vs.password_version = p.viewer_password_updated_at
        );
$$;


ALTER FUNCTION "public"."can_view_owner"("owner_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_viewer_access"() RETURNS TABLE("owner_user_id" "uuid", "owner_public_name" "text", "expires_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    select
        vs.owner_user_id,
        p.public_name,
        vs.expires_at
    from public.viewer_sessions vs
    join public.profiles p
      on p.user_id = vs.owner_user_id
    where vs.viewer_user_id = auth.uid()
      and vs.expires_at > now()
      and p.sharing_enabled
      and vs.password_version = p.viewer_password_updated_at
    order by vs.expires_at desc
    limit 1;
$$;


ALTER FUNCTION "public"."get_active_viewer_access"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_friends"() RETURNS TABLE("owner_user_id" "uuid", "owner_public_name" "text", "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    select f.owner_user_id, p.public_name, f.created_at
    from public.friendships f
    join public.profiles p
      on p.user_id = f.owner_user_id
    where f.viewer_user_id = auth.uid()
      and p.sharing_enabled
    order by lower(p.public_name), f.created_at;
$$;


ALTER FUNCTION "public"."list_friends"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_adopt_agent_token"("input_token_hash" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    resolved_user_id uuid;
begin
    resolved_user_id := public.mcp_touch_agent_token(input_token_hash);
    perform set_config('request.jwt.claim.sub', resolved_user_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    return resolved_user_id;
end;
$$;


ALTER FUNCTION "public"."mcp_adopt_agent_token"("input_token_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_delete_account"("input_token_hash" "text", "input_account_id" bigint, "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("account_id" bigint, "name" "text", "broker" "text", "note" "text", "is_active" boolean, "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return query
    select *
    from public.app_delete_account(input_account_id, 'agent', input_request);
end;
$$;


ALTER FUNCTION "public"."mcp_delete_account"("input_token_hash" "text", "input_account_id" bigint, "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_delete_holding"("input_token_hash" "text", "input_holding_id" bigint, "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("holding_id" bigint, "account_id" bigint, "account_name" "text", "ticker" "text", "display_name" "text", "quantity" numeric, "avg_price" numeric, "note" "text", "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return query
    select *
    from public.app_delete_holding(input_holding_id, 'agent', input_request);
end;
$$;


ALTER FUNCTION "public"."mcp_delete_holding"("input_token_hash" "text", "input_holding_id" bigint, "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_delete_instrument"("input_token_hash" "text", "input_instrument_id" bigint, "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("instrument_id" bigint, "ticker" "text", "display_name" "text", "currency" "text", "instrument_type" "text", "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return query
    select *
    from public.app_delete_instrument(input_instrument_id, 'agent', input_request);
end;
$$;


ALTER FUNCTION "public"."mcp_delete_instrument"("input_token_hash" "text", "input_instrument_id" bigint, "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_delete_tag"("input_token_hash" "text", "input_tag_id" bigint, "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("tag_id" bigint, "unlinked_instrument_count" integer, "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.mcp_adopt_agent_token(input_token_hash);
  return query
  select * from public.app_delete_tag(input_tag_id, 'agent', input_request);
end;
$$;


ALTER FUNCTION "public"."mcp_delete_tag"("input_token_hash" "text", "input_tag_id" bigint, "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_find_holdings"("input_token_hash" "text", "input_query" "text" DEFAULT NULL::"text") RETURNS TABLE("holding_id" bigint, "account_id" bigint, "account_name" "text", "ticker" "text", "display_name" "text", "quantity" numeric, "avg_price" numeric, "note" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."mcp_find_holdings"("input_token_hash" "text", "input_query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_get_portfolio_state"("input_token_hash" "text") RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."mcp_get_portfolio_state"("input_token_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_get_price_sync_targets"("input_token_hash" "text", "input_tickers" "text"[] DEFAULT NULL::"text"[]) RETURNS TABLE("ticker" "text", "source_symbol" "text", "first_price_date" "date", "last_price_date" "date")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with current_user_ctx as (select public.mcp_touch_agent_token(input_token_hash) as user_id),
  requested_tickers as (
    select distinct upper(trim(value)) as ticker from unnest(coalesce(input_tickers, array[]::text[])) as value
    where nullif(trim(value), '') is not null
  ),
  holding_tickers as (
    select distinct h.ticker from public.holdings h join current_user_ctx ctx on ctx.user_id = h.user_id
    join public.instruments i on i.user_id = h.user_id and i.ticker = h.ticker and i.instrument_type = 'market'
    where not exists (select 1 from requested_tickers) or h.ticker in (select ticker from requested_tickers)
  ),
  fx_tickers as (
    select distinct i.ticker from public.instruments i join current_user_ctx ctx on ctx.user_id = i.user_id
    where i.instrument_type = 'fx' and (not exists (select 1 from requested_tickers) or i.ticker in (select ticker from requested_tickers))
  ),
  target_tickers as (select ticker from holding_tickers union select ticker from fx_tickers union select ticker from requested_tickers)
  select tt.ticker, i.source_symbol, min(hpd.price_date) as first_price_date,
    max(hpd.price_date) filter (where hpd.source <> 'holiday') as last_price_date
  from target_tickers tt join current_user_ctx ctx on true
  left join public.instruments i on i.user_id = ctx.user_id and i.ticker = tt.ticker
  left join public.holding_prices_daily hpd on hpd.user_id = ctx.user_id and hpd.ticker = tt.ticker
  where i.instrument_type in ('market', 'fx')
  group by tt.ticker, i.source_symbol order by tt.ticker;
$$;


ALTER FUNCTION "public"."mcp_get_price_sync_targets"("input_token_hash" "text", "input_tickers" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_list_recent_activity"("input_token_hash" "text", "limit_count" integer DEFAULT 20) RETURNS TABLE("id" bigint, "source" "text", "action_type" "text", "natural_language_request" "text", "target_table" "text", "target_id" "text", "before_data" "jsonb", "after_data" "jsonb", "status" "text", "error_message" "text", "created_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."mcp_list_recent_activity"("input_token_hash" "text", "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_record_sync_run"("input_token_hash" "text", "input_total_count" integer, "input_synced_count" integer, "input_failed" "jsonb" DEFAULT '[]'::"jsonb") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    resolved_user_id uuid;
    saved_sync_run_id bigint;
begin
    resolved_user_id := public.mcp_touch_agent_token(input_token_hash);

    insert into public.sync_runs (
        user_id,
        total_count,
        synced_count,
        failed_count,
        failed,
        started_by
    )
    values (
        resolved_user_id,
        coalesce(input_total_count, 0),
        coalesce(input_synced_count, 0),
        jsonb_array_length(coalesce(input_failed, '[]'::jsonb)),
        coalesce(input_failed, '[]'::jsonb),
        'agent'
    )
    returning id into saved_sync_run_id;

    insert into public.activity_events (
        user_id,
        source,
        action_type,
        target_table,
        target_id,
        after_data,
        status
    )
    values (
        resolved_user_id,
        'agent',
        'sync_prices',
        'holding_prices_daily',
        saved_sync_run_id::text,
        jsonb_build_object(
            'total_count', coalesce(input_total_count, 0),
            'synced_count', coalesce(input_synced_count, 0),
            'failed_count', jsonb_array_length(coalesce(input_failed, '[]'::jsonb))
        ),
        case when jsonb_array_length(coalesce(input_failed, '[]'::jsonb)) > 0 then 'partial' else 'succeeded' end
    );

    return saved_sync_run_id;
end;
$$;


ALTER FUNCTION "public"."mcp_record_sync_run"("input_token_hash" "text", "input_total_count" integer, "input_synced_count" integer, "input_failed" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_save_account"("input_token_hash" "text", "input_account_id" bigint DEFAULT NULL::bigint, "input_name" "text" DEFAULT NULL::"text", "input_broker" "text" DEFAULT NULL::"text", "input_note" "text" DEFAULT NULL::"text", "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("account_id" bigint, "name" "text", "broker" "text", "note" "text", "is_active" boolean, "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return query
    select *
    from public.app_save_account(
        input_account_id,
        input_name,
        input_broker,
        input_note,
        'agent',
        input_request
    );
end;
$$;


ALTER FUNCTION "public"."mcp_save_account"("input_token_hash" "text", "input_account_id" bigint, "input_name" "text", "input_broker" "text", "input_note" "text", "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_save_holding"("input_token_hash" "text", "input_holding_id" bigint DEFAULT NULL::bigint, "input_account_id" bigint DEFAULT NULL::bigint, "input_ticker" "text" DEFAULT NULL::"text", "input_quantity" numeric DEFAULT NULL::numeric, "input_avg_price" numeric DEFAULT NULL::numeric, "input_purchase_amount" numeric DEFAULT NULL::numeric, "input_valuation_amount" numeric DEFAULT NULL::numeric, "input_note" "text" DEFAULT NULL::"text", "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("holding_id" bigint, "account_id" bigint, "account_name" "text", "ticker" "text", "display_name" "text", "instrument_type" "text", "quantity" numeric, "avg_price" numeric, "purchase_amount" numeric, "valuation_amount" numeric, "note" "text", "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare type_value text;
begin
  perform public.mcp_adopt_agent_token(input_token_hash);
  select instrument_type into type_value from public.instruments where user_id = auth.uid() and ticker = upper(trim(coalesce(input_ticker, '')));
  if type_value = 'valuation' then
    return query select h.holding_id, h.account_id, h.account_name, h.ticker, h.display_name, type_value, h.quantity, h.avg_price, h.purchase_amount, h.valuation_amount, h.note, h.activity_id from public.app_save_valuation_holding(input_holding_id, input_account_id, input_ticker, input_purchase_amount, input_valuation_amount, input_note, 'agent', input_request) h;
  elsif type_value = 'cash' then
    return query select h.holding_id, h.account_id, h.account_name, h.ticker, h.display_name, type_value, h.quantity, h.avg_price, h.purchase_amount, h.valuation_amount, h.note, h.activity_id from public.app_save_cash_holding(input_holding_id, input_account_id, input_ticker, input_valuation_amount, input_note, 'agent', input_request) h;
  elsif type_value = 'market' then
    return query select h.holding_id, h.account_id, h.account_name, h.ticker, h.display_name, type_value, h.quantity, h.avg_price, null::numeric, null::numeric, h.note, h.activity_id from public.app_save_holding(input_holding_id, input_account_id, input_ticker, input_quantity, input_avg_price, input_note, 'agent', input_request) h;
  else raise exception 'Instrument not found or cannot be held'; end if;
end; $$;


ALTER FUNCTION "public"."mcp_save_holding"("input_token_hash" "text", "input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_quantity" numeric, "input_avg_price" numeric, "input_purchase_amount" numeric, "input_valuation_amount" numeric, "input_note" "text", "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_save_instrument"("input_token_hash" "text", "input_instrument_id" bigint DEFAULT NULL::bigint, "input_ticker" "text" DEFAULT NULL::"text", "input_display_name" "text" DEFAULT NULL::"text", "input_currency" "text" DEFAULT 'KRW'::"text", "input_instrument_type" "text" DEFAULT 'etf'::"text", "input_price" numeric DEFAULT NULL::numeric, "input_price_date" "date" DEFAULT NULL::"date", "input_tag_id" bigint DEFAULT NULL::bigint, "input_request" "text" DEFAULT NULL::"text", "input_price_source" "text" DEFAULT 'manual'::"text", "input_note" "text" DEFAULT NULL::"text") RETURNS TABLE("instrument_id" bigint, "ticker" "text", "display_name" "text", "currency" "text", "instrument_type" "text", "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return query
    select *
    from public.app_save_instrument(
        input_instrument_id,
        input_ticker,
        input_display_name,
        input_currency,
        input_instrument_type,
        input_price,
        input_price_date,
        input_tag_id,
        'agent',
        input_request,
        input_price_source,
        input_note
    );
end;
$$;


ALTER FUNCTION "public"."mcp_save_instrument"("input_token_hash" "text", "input_instrument_id" bigint, "input_ticker" "text", "input_display_name" "text", "input_currency" "text", "input_instrument_type" "text", "input_price" numeric, "input_price_date" "date", "input_tag_id" bigint, "input_request" "text", "input_price_source" "text", "input_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_save_tag"("input_token_hash" "text", "input_tag_id" bigint DEFAULT NULL::bigint, "input_name" "text" DEFAULT NULL::"text", "input_sort_order" integer DEFAULT 0, "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("tag_id" bigint, "name" "text", "sort_order" integer, "activity_id" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.mcp_adopt_agent_token(input_token_hash);
  return query
  select * from public.app_save_tag(input_tag_id, input_name, input_sort_order, 'agent', input_request);
end;
$$;


ALTER FUNCTION "public"."mcp_save_tag"("input_token_hash" "text", "input_tag_id" bigint, "input_name" "text", "input_sort_order" integer, "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_touch_agent_token"("input_token_hash" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."mcp_touch_agent_token"("input_token_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_update_holding_avg_price"("input_token_hash" "text", "input_holding_id" bigint, "input_avg_price" numeric, "input_request" "text" DEFAULT NULL::"text") RETURNS TABLE("action_id" bigint, "holding_id" bigint, "account_name" "text", "ticker" "text", "display_name" "text", "previous_avg_price" numeric, "next_avg_price" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."mcp_update_holding_avg_price"("input_token_hash" "text", "input_holding_id" bigint, "input_avg_price" numeric, "input_request" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mcp_upsert_price_rows"("input_token_hash" "text", "input_ticker" "text", "input_prices" "jsonb" DEFAULT '[]'::"jsonb", "input_holidays" "jsonb" DEFAULT '[]'::"jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    resolved_user_id uuid;
    normalized_ticker text := upper(trim(coalesce(input_ticker, '')));
    affected_count integer := 0;
begin
    resolved_user_id := public.mcp_touch_agent_token(input_token_hash);

    if normalized_ticker = '' then
        raise exception 'Ticker is required';
    end if;

    insert into public.holding_prices_daily (
        user_id,
        ticker,
        price_date,
        close_price,
        source
    )
    select
        resolved_user_id,
        normalized_ticker,
        (row_data ->> 'date')::date,
        (row_data ->> 'close')::numeric,
        'yfinance'
    from jsonb_array_elements(coalesce(input_prices, '[]'::jsonb)) as row_data
    where nullif(row_data ->> 'date', '') is not null
      and nullif(row_data ->> 'close', '') is not null
    on conflict on constraint holding_prices_daily_user_id_ticker_price_date_key do update
    set close_price = excluded.close_price,
        source = excluded.source;

    get diagnostics affected_count = row_count;

    insert into public.holding_prices_daily (
        user_id,
        ticker,
        price_date,
        close_price,
        source
    )
    select
        resolved_user_id,
        normalized_ticker,
        (row_data ->> 'date')::date,
        null,
        'holiday'
    from jsonb_array_elements(coalesce(input_holidays, '[]'::jsonb)) as row_data
    where nullif(row_data ->> 'date', '') is not null
    on conflict on constraint holding_prices_daily_user_id_ticker_price_date_key do nothing;

    return affected_count;
end;
$$;


ALTER FUNCTION "public"."mcp_upsert_price_rows"("input_token_hash" "text", "input_ticker" "text", "input_prices" "jsonb", "input_holidays" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_public_name"("input_name" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
    select nullif(lower(trim(input_name)), '');
$$;


ALTER FUNCTION "public"."normalize_public_name"("input_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalc_holding"("p_account_id" bigint, "p_ticker" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    r RECORD;
    total_qty REAL := 0;
    total_cost REAL := 0;
    avg_price REAL := 0;
BEGIN
    FOR r IN
        SELECT trade_type, quantity, price FROM transactions
        WHERE account_id = p_account_id AND ticker = p_ticker
        ORDER BY trade_date, created_at
    LOOP
        IF r.trade_type = 'BUY' THEN
            total_qty  := total_qty + r.quantity;
            total_cost := total_cost + r.quantity * r.price;
            IF total_qty > 0 THEN avg_price := total_cost / total_qty; END IF;
        ELSIF r.trade_type = 'SELL' THEN
            IF r.quantity > total_qty THEN
                RAISE EXCEPTION 'Sell quantity exceeds holdings for %, %', p_account_id, p_ticker;
            END IF;
            total_qty  := total_qty - r.quantity;
            total_cost := avg_price * total_qty;
        END IF;
    END LOOP;
    INSERT INTO holdings (account_id, ticker, quantity, avg_price, updated_at)
    VALUES (p_account_id, p_ticker, total_qty, avg_price, NOW())
    ON CONFLICT (account_id, ticker)
    DO UPDATE SET quantity = EXCLUDED.quantity, avg_price = EXCLUDED.avg_price, updated_at = NOW();
END;
$$;


ALTER FUNCTION "public"."recalc_holding"("p_account_id" bigint, "p_ticker" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalc_holding"("p_user_id" "uuid", "p_account_id" bigint, "p_ticker" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    r          RECORD;
    total_qty  REAL := 0;
    total_cost REAL := 0;
    avg_price  REAL := 0;
BEGIN
    FOR r IN
        SELECT trade_type, quantity, price FROM transactions
        WHERE user_id = p_user_id AND account_id = p_account_id AND ticker = p_ticker
        ORDER BY trade_date, created_at
    LOOP
        IF r.trade_type IN ('BUY', 'INITIAL') THEN
            total_qty  := total_qty + r.quantity;
            total_cost := total_cost + r.quantity * r.price;
            IF total_qty > 0 THEN avg_price := total_cost / total_qty; END IF;
        ELSIF r.trade_type = 'SELL' THEN
            IF r.quantity > total_qty THEN
                RAISE EXCEPTION 'Sell quantity exceeds holdings for %, %', p_account_id, p_ticker;
            END IF;
            total_qty  := total_qty - r.quantity;
            total_cost := avg_price * total_qty;
        END IF;
    END LOOP;

    INSERT INTO holdings (user_id, account_id, ticker, quantity, avg_price, updated_at)
    VALUES (p_user_id, p_account_id, p_ticker, total_qty, avg_price, NOW())
    ON CONFLICT (account_id, ticker)
    DO UPDATE SET quantity = EXCLUDED.quantity, avg_price = EXCLUDED.avg_price, updated_at = NOW();
END;
$$;


ALTER FUNCTION "public"."recalc_holding"("p_user_id" "uuid", "p_account_id" bigint, "p_ticker" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_friend"("input_owner_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    with deleted as (
        delete from public.friendships
        where viewer_user_id = auth.uid()
          and owner_user_id = input_owner_user_id
        returning 1
    )
    select exists(select 1 from deleted);
$$;


ALTER FUNCTION "public"."remove_friend"("input_owner_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_profile_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
    new.updated_at = now();
    return new;
end;
$$;


ALTER FUNCTION "public"."set_profile_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "uuid" NOT NULL,
    "public_name" "text",
    "public_name_normalized" "text",
    "viewer_password_hash" "text",
    "viewer_password_updated_at" timestamp with time zone,
    "sharing_enabled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_viewer_profile"("input_public_name" "text", "input_viewer_password" "text", "input_sharing_enabled" boolean) RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    current_user_id uuid := auth.uid();
    normalized_name text := public.normalize_public_name(input_public_name);
    trimmed_password text := nullif(trim(coalesce(input_viewer_password, '')), '');
    existing_profile public.profiles;
    next_password_hash text;
    next_password_updated_at timestamptz;
    result_row public.profiles;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;

    if normalized_name is not null
       and (
            char_length(normalized_name) < 2
            or char_length(normalized_name) > 32
            or normalized_name ~ '\s'
       ) then
        raise exception 'Public name must be 2-32 characters with no spaces';
    end if;

    select * into existing_profile from public.profiles where user_id = current_user_id;

    if input_sharing_enabled and normalized_name is null then
        raise exception 'Public name is required when sharing is enabled';
    end if;

    if trimmed_password is not null and length(trimmed_password) < 4 then
        raise exception 'Viewer password must be at least 4 characters';
    end if;

    if input_sharing_enabled and trimmed_password is null and coalesce(existing_profile.viewer_password_hash, '') = '' then
        raise exception 'Viewer password is required when sharing is enabled';
    end if;

    if trimmed_password is not null then
        next_password_hash := extensions.crypt(trimmed_password, extensions.gen_salt('bf'));
        next_password_updated_at := now();
    else
        next_password_hash := existing_profile.viewer_password_hash;
        next_password_updated_at := existing_profile.viewer_password_updated_at;
    end if;

    insert into public.profiles (user_id, public_name, public_name_normalized, viewer_password_hash, viewer_password_updated_at, sharing_enabled)
    values (current_user_id, nullif(trim(input_public_name), ''), normalized_name, next_password_hash, next_password_updated_at, coalesce(input_sharing_enabled, false))
    on conflict (user_id) do update
    set public_name = excluded.public_name,
        public_name_normalized = excluded.public_name_normalized,
        viewer_password_hash = excluded.viewer_password_hash,
        viewer_password_updated_at = excluded.viewer_password_updated_at,
        sharing_enabled = excluded.sharing_enabled,
        updated_at = now()
    returning * into result_row;

    return result_row;
end;
$$;


ALTER FUNCTION "public"."set_viewer_profile"("input_public_name" "text", "input_viewer_password" "text", "input_sharing_enabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transactions_recalc_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM recalc_holding(OLD.user_id, OLD.account_id, OLD.ticker);
        RETURN OLD;
    ELSE
        PERFORM recalc_holding(NEW.user_id, NEW.account_id, NEW.ticker);
        IF TG_OP = 'UPDATE' AND (OLD.account_id <> NEW.account_id OR OLD.ticker <> NEW.ticker) THEN
            PERFORM recalc_holding(OLD.user_id, OLD.account_id, OLD.ticker);
        END IF;
        RETURN NEW;
    END IF;
END;
$$;


ALTER FUNCTION "public"."transactions_recalc_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unlock_viewer_access"("input_public_name" "text", "input_viewer_password" "text") RETURNS TABLE("owner_user_id" "uuid", "owner_public_name" "text", "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
    current_viewer_id uuid := auth.uid();
    owner_profile public.profiles;
    session_expires_at timestamptz := now() + interval '7 days';
begin
    if current_viewer_id is null then
        raise exception 'Authentication required';
    end if;

    select * into owner_profile
    from public.profiles
    where public_name_normalized = public.normalize_public_name(input_public_name)
      and sharing_enabled;

    if owner_profile.user_id is null then
        raise exception 'Shared profile not found';
    end if;

    if owner_profile.user_id = current_viewer_id then
        raise exception 'Cannot unlock your own profile as a viewer';
    end if;

    if coalesce(owner_profile.viewer_password_hash, '') = '' then
        raise exception 'Invalid viewer password';
    end if;

    if owner_profile.viewer_password_hash like '$2%' then
        if owner_profile.viewer_password_hash <> extensions.crypt(coalesce(input_viewer_password, ''), owner_profile.viewer_password_hash) then
            raise exception 'Invalid viewer password';
        end if;
    elsif owner_profile.viewer_password_hash <> encode(extensions.digest(coalesce(input_viewer_password, ''), 'sha256'), 'hex') then
        raise exception 'Invalid viewer password';
    end if;

    insert into public.viewer_sessions (viewer_user_id, owner_user_id, password_version, expires_at)
    values (current_viewer_id, owner_profile.user_id, owner_profile.viewer_password_updated_at, session_expires_at)
    on conflict on constraint viewer_sessions_viewer_owner_key do update
    set password_version = excluded.password_version,
        expires_at = excluded.expires_at;

    return query select owner_profile.user_id, owner_profile.public_name, session_expires_at;
end;
$_$;


ALTER FUNCTION "public"."unlock_viewer_access"("input_public_name" "text", "input_viewer_password" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."accounts" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "broker" "text",
    "note" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."accounts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."accounts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."accounts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."accounts_id_seq" OWNED BY "public"."accounts"."id";



CREATE TABLE IF NOT EXISTS "public"."activity_events" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'agent'::"text" NOT NULL,
    "action_type" "text" NOT NULL,
    "natural_language_request" "text",
    "target_table" "text",
    "target_id" "text",
    "before_data" "jsonb",
    "after_data" "jsonb",
    "status" "text" DEFAULT 'succeeded'::"text" NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "activity_events_source_check" CHECK (("source" = ANY (ARRAY['user'::"text", 'agent'::"text"]))),
    CONSTRAINT "activity_events_status_check" CHECK (("status" = ANY (ARRAY['succeeded'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."activity_events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."activity_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."activity_events_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."activity_events_id_seq" OWNED BY "public"."activity_events"."id";



CREATE TABLE IF NOT EXISTS "public"."agent_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "token_prefix" "text" NOT NULL,
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."agent_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_reports" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "report_date" "date" NOT NULL,
    "headline" "text",
    "market_impact_summary" "text",
    "trade_suggestions" "jsonb",
    "risk_warnings" "jsonb",
    "cycle_phase" "text",
    "indicators" "jsonb",
    "news_count" integer,
    "storage_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "daily_reports_cycle_phase_check" CHECK (("cycle_phase" = ANY (ARRAY['recovery'::"text", 'caution'::"text", 'neutral'::"text"])))
);


ALTER TABLE "public"."daily_reports" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."daily_reports_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."daily_reports_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."daily_reports_id_seq" OWNED BY "public"."daily_reports"."id";



CREATE TABLE IF NOT EXISTS "public"."friendships" (
    "viewer_user_id" "uuid" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "friendships_not_self" CHECK (("viewer_user_id" <> "owner_user_id"))
);


ALTER TABLE "public"."friendships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."holding_prices_daily" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "ticker" "text" NOT NULL,
    "price_date" "date" NOT NULL,
    "close_price" real NOT NULL,
    "source" "text" DEFAULT 'manual'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."holding_prices_daily" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."holding_prices_daily_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."holding_prices_daily_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."holding_prices_daily_id_seq" OWNED BY "public"."holding_prices_daily"."id";



CREATE TABLE IF NOT EXISTS "public"."holdings" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "account_id" bigint,
    "ticker" "text" NOT NULL,
    "quantity" real,
    "avg_price" real,
    "note" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "purchase_amount" numeric,
    "valuation_amount" numeric,
    CONSTRAINT "holdings_purchase_amount_nonnegative" CHECK ((("purchase_amount" IS NULL) OR ("purchase_amount" >= (0)::numeric))),
    CONSTRAINT "holdings_valuation_amount_nonnegative" CHECK ((("valuation_amount" IS NULL) OR ("valuation_amount" >= (0)::numeric)))
);


ALTER TABLE "public"."holdings" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."holdings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."holdings_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."holdings_id_seq" OWNED BY "public"."holdings"."id";



CREATE TABLE IF NOT EXISTS "public"."instrument_tags" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "ticker" "text" NOT NULL,
    "tag_id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."instrument_tags" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."instrument_tags_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."instrument_tags_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."instrument_tags_id_seq" OWNED BY "public"."instrument_tags"."id";



CREATE TABLE IF NOT EXISTS "public"."instruments" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "ticker" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "instrument_type" "text" NOT NULL,
    "currency" "text" NOT NULL,
    "price_source" "text" DEFAULT 'yfinance'::"text",
    "source_symbol" "text",
    "note" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "instruments_instrument_type_check" CHECK (("instrument_type" = ANY (ARRAY['market'::"text", 'valuation'::"text", 'cash'::"text", 'fx'::"text"])))
);


ALTER TABLE "public"."instruments" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."instruments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."instruments_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."instruments_id_seq" OWNED BY "public"."instruments"."id";



CREATE TABLE IF NOT EXISTS "public"."portfolio_snapshots" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "snapshot_date" "date" NOT NULL,
    "total_value_krw" real NOT NULL,
    "unrealized_pnl_krw" real,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."portfolio_snapshots" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."portfolio_snapshots_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."portfolio_snapshots_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."portfolio_snapshots_id_seq" OWNED BY "public"."portfolio_snapshots"."id";



CREATE OR REPLACE VIEW "public"."portfolio_view" WITH ("security_invoker"='true') AS
 WITH "latest_price" AS (
         SELECT DISTINCT ON ("holding_prices_daily"."user_id", "holding_prices_daily"."ticker") "holding_prices_daily"."user_id",
            "holding_prices_daily"."ticker",
            "holding_prices_daily"."price_date",
            "holding_prices_daily"."close_price"
           FROM "public"."holding_prices_daily"
          ORDER BY "holding_prices_daily"."user_id", "holding_prices_daily"."ticker", "holding_prices_daily"."price_date" DESC
        ), "fx" AS (
         SELECT "holding_prices_daily"."user_id",
            "holding_prices_daily"."price_date",
            "holding_prices_daily"."close_price" AS "usdkrw"
           FROM "public"."holding_prices_daily"
          WHERE ("holding_prices_daily"."ticker" = 'USDKRW=X'::"text")
        )
 SELECT "h"."id",
    "h"."user_id",
    "h"."account_id",
    "a"."name" AS "account_name",
    "h"."ticker",
    "i"."display_name",
    "i"."currency",
    "i"."instrument_type",
    "h"."quantity",
    "h"."avg_price",
    "h"."note",
    "p"."close_price",
    "p"."price_date",
    ("h"."quantity" * "p"."close_price") AS "market_value_native",
        CASE
            WHEN ("i"."currency" = 'KRW'::"text") THEN ("h"."quantity" * "p"."close_price")
            WHEN ("i"."currency" = 'USD'::"text") THEN (("h"."quantity" * "p"."close_price") * COALESCE(( SELECT "fx"."usdkrw"
               FROM "fx"
              WHERE (("fx"."user_id" = "h"."user_id") AND ("fx"."price_date" = "p"."price_date"))), ( SELECT "fx"."usdkrw"
               FROM "fx"
              WHERE (("fx"."user_id" = "h"."user_id") AND ("fx"."price_date" <= "p"."price_date"))
              ORDER BY "fx"."price_date" DESC
             LIMIT 1)))
            ELSE NULL::real
        END AS "market_value_krw",
        CASE
            WHEN ("i"."currency" = 'KRW'::"text") THEN ("h"."quantity" * ("p"."close_price" - "h"."avg_price"))
            WHEN ("i"."currency" = 'USD'::"text") THEN (("h"."quantity" * ("p"."close_price" - "h"."avg_price")) * COALESCE(( SELECT "fx"."usdkrw"
               FROM "fx"
              WHERE (("fx"."user_id" = "h"."user_id") AND ("fx"."price_date" = "p"."price_date"))), ( SELECT "fx"."usdkrw"
               FROM "fx"
              WHERE (("fx"."user_id" = "h"."user_id") AND ("fx"."price_date" <= "p"."price_date"))
              ORDER BY "fx"."price_date" DESC
             LIMIT 1)))
            ELSE NULL::real
        END AS "unrealized_pnl_krw"
   FROM ((("public"."holdings" "h"
     JOIN "public"."instruments" "i" ON ((("i"."user_id" = "h"."user_id") AND ("i"."ticker" = "h"."ticker"))))
     JOIN "public"."accounts" "a" ON ((("a"."user_id" = "h"."user_id") AND ("a"."id" = "h"."account_id"))))
     LEFT JOIN "latest_price" "p" ON ((("p"."user_id" = "h"."user_id") AND ("p"."ticker" = "h"."ticker"))));


ALTER VIEW "public"."portfolio_view" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rebalance_suggestions" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "suggestion_date" "date" NOT NULL,
    "investment_amount" real,
    "reasoning" "text",
    "actions" "jsonb",
    "based_on_reports" "jsonb",
    "storage_path" "text",
    "user_decision" "jsonb",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "rebalance_suggestions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'rejected'::"text", 'partial'::"text"])))
);


ALTER TABLE "public"."rebalance_suggestions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."rebalance_suggestions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."rebalance_suggestions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."rebalance_suggestions_id_seq" OWNED BY "public"."rebalance_suggestions"."id";



CREATE TABLE IF NOT EXISTS "public"."strategies" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "monthly_contribution" numeric DEFAULT 0 NOT NULL,
    "review_day" integer DEFAULT 1 NOT NULL,
    "drift_threshold" numeric DEFAULT 5 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "strategies_drift_threshold_check" CHECK ((("drift_threshold" > (0)::numeric) AND ("drift_threshold" <= (100)::numeric))),
    CONSTRAINT "strategies_monthly_contribution_check" CHECK (("monthly_contribution" >= (0)::numeric)),
    CONSTRAINT "strategies_review_day_check" CHECK ((("review_day" >= 1) AND ("review_day" <= 28)))
);


ALTER TABLE "public"."strategies" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."strategies_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."strategies_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."strategies_id_seq" OWNED BY "public"."strategies"."id";



CREATE TABLE IF NOT EXISTS "public"."strategy_bucket_tags" (
    "bucket_id" bigint NOT NULL,
    "tag_id" bigint NOT NULL
);


ALTER TABLE "public"."strategy_bucket_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."strategy_buckets" (
    "id" bigint NOT NULL,
    "strategy_id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "target_percentage" numeric NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "strategy_buckets_target_percentage_check" CHECK ((("target_percentage" >= (0)::numeric) AND ("target_percentage" <= (100)::numeric)))
);


ALTER TABLE "public"."strategy_buckets" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."strategy_buckets_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."strategy_buckets_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."strategy_buckets_id_seq" OWNED BY "public"."strategy_buckets"."id";



CREATE TABLE IF NOT EXISTS "public"."sync_runs" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "run_at" timestamp with time zone DEFAULT "now"(),
    "total_count" integer DEFAULT 0 NOT NULL,
    "synced_count" integer DEFAULT 0 NOT NULL,
    "failed_count" integer DEFAULT 0 NOT NULL,
    "failed" "jsonb" DEFAULT '[]'::"jsonb",
    "started_by" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "sync_runs_started_by_check" CHECK (("started_by" = ANY (ARRAY['web'::"text", 'market-analysis-skill'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."sync_runs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."sync_runs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sync_runs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sync_runs_id_seq" OWNED BY "public"."sync_runs"."id";



CREATE TABLE IF NOT EXISTS "public"."tags" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."tags" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."tags_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."tags_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."tags_id_seq" OWNED BY "public"."tags"."id";



CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" bigint NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "account_id" bigint,
    "trade_date" "date" NOT NULL,
    "ticker" "text" NOT NULL,
    "trade_type" "text" NOT NULL,
    "quantity" real NOT NULL,
    "price" real NOT NULL,
    "amount" real NOT NULL,
    "fee" real DEFAULT 0,
    "realized_pnl_krw" real,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "transactions_trade_type_check" CHECK (("trade_type" = ANY (ARRAY['BUY'::"text", 'SELL'::"text", 'INITIAL'::"text"])))
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."transactions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."transactions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."transactions_id_seq" OWNED BY "public"."transactions"."id";



CREATE TABLE IF NOT EXISTS "public"."viewer_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "viewer_user_id" "uuid" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "password_version" timestamp with time zone NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "viewer_sessions_not_self" CHECK (("viewer_user_id" <> "owner_user_id"))
);


ALTER TABLE "public"."viewer_sessions" OWNER TO "postgres";


ALTER TABLE ONLY "public"."accounts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."accounts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."activity_events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."activity_events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."daily_reports" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."daily_reports_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."holding_prices_daily" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."holding_prices_daily_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."holdings" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."holdings_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."instrument_tags" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."instrument_tags_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."instruments" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."instruments_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."portfolio_snapshots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."portfolio_snapshots_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."rebalance_suggestions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."rebalance_suggestions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."strategies" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."strategies_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."strategy_buckets" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."strategy_buckets_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sync_runs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sync_runs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."tags" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."tags_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."transactions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."transactions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_user_id_name_key" UNIQUE ("user_id", "name");



ALTER TABLE ONLY "public"."activity_events"
    ADD CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_tokens"
    ADD CONSTRAINT "agent_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_tokens"
    ADD CONSTRAINT "agent_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."daily_reports"
    ADD CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_reports"
    ADD CONSTRAINT "daily_reports_user_id_report_date_key" UNIQUE ("user_id", "report_date");



ALTER TABLE ONLY "public"."friendships"
    ADD CONSTRAINT "friendships_pkey" PRIMARY KEY ("viewer_user_id", "owner_user_id");



ALTER TABLE ONLY "public"."holding_prices_daily"
    ADD CONSTRAINT "holding_prices_daily_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."holding_prices_daily"
    ADD CONSTRAINT "holding_prices_daily_user_id_ticker_price_date_key" UNIQUE ("user_id", "ticker", "price_date");



ALTER TABLE ONLY "public"."holdings"
    ADD CONSTRAINT "holdings_account_id_ticker_key" UNIQUE ("account_id", "ticker");



ALTER TABLE ONLY "public"."holdings"
    ADD CONSTRAINT "holdings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."instrument_tags"
    ADD CONSTRAINT "instrument_tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."instrument_tags"
    ADD CONSTRAINT "instrument_tags_user_id_ticker_key" UNIQUE ("user_id", "ticker");



ALTER TABLE ONLY "public"."instrument_tags"
    ADD CONSTRAINT "instrument_tags_user_id_ticker_tag_id_key" UNIQUE ("user_id", "ticker", "tag_id");



ALTER TABLE ONLY "public"."instruments"
    ADD CONSTRAINT "instruments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."instruments"
    ADD CONSTRAINT "instruments_user_id_ticker_key" UNIQUE ("user_id", "ticker");



ALTER TABLE ONLY "public"."portfolio_snapshots"
    ADD CONSTRAINT "portfolio_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."portfolio_snapshots"
    ADD CONSTRAINT "portfolio_snapshots_user_id_snapshot_date_key" UNIQUE ("user_id", "snapshot_date");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."rebalance_suggestions"
    ADD CONSTRAINT "rebalance_suggestions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."strategies"
    ADD CONSTRAINT "strategies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."strategies"
    ADD CONSTRAINT "strategies_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."strategy_bucket_tags"
    ADD CONSTRAINT "strategy_bucket_tags_pkey" PRIMARY KEY ("bucket_id", "tag_id");



ALTER TABLE ONLY "public"."strategy_bucket_tags"
    ADD CONSTRAINT "strategy_bucket_tags_tag_id_key" UNIQUE ("tag_id");



ALTER TABLE ONLY "public"."strategy_buckets"
    ADD CONSTRAINT "strategy_buckets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sync_runs"
    ADD CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_user_id_name_key" UNIQUE ("user_id", "name");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."viewer_sessions"
    ADD CONSTRAINT "viewer_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."viewer_sessions"
    ADD CONSTRAINT "viewer_sessions_viewer_owner_key" UNIQUE ("viewer_user_id", "owner_user_id");



CREATE INDEX "activity_events_user_created_at_idx" ON "public"."activity_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "agent_tokens_active_hash_idx" ON "public"."agent_tokens" USING "btree" ("token_hash") WHERE ("revoked_at" IS NULL);



CREATE INDEX "agent_tokens_user_created_at_idx" ON "public"."agent_tokens" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "friendships_viewer_created_at_idx" ON "public"."friendships" USING "btree" ("viewer_user_id", "created_at" DESC);



CREATE UNIQUE INDEX "profiles_public_name_normalized_key" ON "public"."profiles" USING "btree" ("public_name_normalized") WHERE ("public_name_normalized" IS NOT NULL);



CREATE INDEX "viewer_sessions_owner_lookup_idx" ON "public"."viewer_sessions" USING "btree" ("owner_user_id", "viewer_user_id", "expires_at" DESC);



CREATE OR REPLACE TRIGGER "set_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_profile_updated_at"();



CREATE OR REPLACE TRIGGER "transactions_recalc" AFTER INSERT OR DELETE OR UPDATE ON "public"."transactions" FOR EACH ROW EXECUTE FUNCTION "public"."transactions_recalc_trigger"();



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."activity_events"
    ADD CONSTRAINT "activity_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_tokens"
    ADD CONSTRAINT "agent_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_reports"
    ADD CONSTRAINT "daily_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."friendships"
    ADD CONSTRAINT "friendships_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."friendships"
    ADD CONSTRAINT "friendships_viewer_user_id_fkey" FOREIGN KEY ("viewer_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."holding_prices_daily"
    ADD CONSTRAINT "holding_prices_daily_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."holding_prices_daily"
    ADD CONSTRAINT "holding_prices_daily_user_id_ticker_fkey" FOREIGN KEY ("user_id", "ticker") REFERENCES "public"."instruments"("user_id", "ticker");



ALTER TABLE ONLY "public"."holdings"
    ADD CONSTRAINT "holdings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."holdings"
    ADD CONSTRAINT "holdings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."holdings"
    ADD CONSTRAINT "holdings_user_id_ticker_fkey" FOREIGN KEY ("user_id", "ticker") REFERENCES "public"."instruments"("user_id", "ticker");



ALTER TABLE ONLY "public"."instrument_tags"
    ADD CONSTRAINT "instrument_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."instrument_tags"
    ADD CONSTRAINT "instrument_tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."instrument_tags"
    ADD CONSTRAINT "instrument_tags_user_id_ticker_fkey" FOREIGN KEY ("user_id", "ticker") REFERENCES "public"."instruments"("user_id", "ticker");



ALTER TABLE ONLY "public"."instruments"
    ADD CONSTRAINT "instruments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."portfolio_snapshots"
    ADD CONSTRAINT "portfolio_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rebalance_suggestions"
    ADD CONSTRAINT "rebalance_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."strategies"
    ADD CONSTRAINT "strategies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."strategy_bucket_tags"
    ADD CONSTRAINT "strategy_bucket_tags_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "public"."strategy_buckets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."strategy_bucket_tags"
    ADD CONSTRAINT "strategy_bucket_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."strategy_buckets"
    ADD CONSTRAINT "strategy_buckets_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sync_runs"
    ADD CONSTRAINT "sync_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."tags"
    ADD CONSTRAINT "tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_user_id_ticker_fkey" FOREIGN KEY ("user_id", "ticker") REFERENCES "public"."instruments"("user_id", "ticker");



ALTER TABLE ONLY "public"."viewer_sessions"
    ADD CONSTRAINT "viewer_sessions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."viewer_sessions"
    ADD CONSTRAINT "viewer_sessions_viewer_user_id_fkey" FOREIGN KEY ("viewer_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "accounts_shared_select" ON "public"."accounts" FOR SELECT TO "authenticated", "anon" USING ("public"."can_view_owner"("user_id"));



ALTER TABLE "public"."activity_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_events_select_own" ON "public"."activity_events" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."agent_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agent_tokens_select_own" ON "public"."agent_tokens" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."daily_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."friendships" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "friendships_delete_own" ON "public"."friendships" FOR DELETE TO "authenticated" USING (("viewer_user_id" = "auth"."uid"()));



CREATE POLICY "friendships_select_own" ON "public"."friendships" FOR SELECT TO "authenticated" USING (("viewer_user_id" = "auth"."uid"()));



ALTER TABLE "public"."holding_prices_daily" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "holding_prices_daily_shared_select" ON "public"."holding_prices_daily" FOR SELECT TO "authenticated", "anon" USING ("public"."can_view_owner"("user_id"));



ALTER TABLE "public"."holdings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "holdings_shared_select" ON "public"."holdings" FOR SELECT TO "authenticated", "anon" USING ("public"."can_view_owner"("user_id"));



ALTER TABLE "public"."instrument_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "instrument_tags_shared_select" ON "public"."instrument_tags" FOR SELECT TO "authenticated", "anon" USING ("public"."can_view_owner"("user_id"));



ALTER TABLE "public"."instruments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "instruments_shared_select" ON "public"."instruments" FOR SELECT TO "authenticated", "anon" USING ("public"."can_view_owner"("user_id"));



CREATE POLICY "owner_all" ON "public"."accounts" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_all" ON "public"."daily_reports" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_all" ON "public"."holding_prices_daily" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_all" ON "public"."holdings" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_all" ON "public"."instrument_tags" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_all" ON "public"."instruments" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_all" ON "public"."portfolio_snapshots" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_all" ON "public"."rebalance_suggestions" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_all" ON "public"."sync_runs" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_all" ON "public"."tags" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_all" ON "public"."transactions" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."portfolio_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert_own" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "profiles_select_own" ON "public"."profiles" FOR SELECT TO "authenticated", "anon" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."rebalance_suggestions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."strategies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "strategies_delete_own" ON "public"."strategies" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "strategies_insert_own" ON "public"."strategies" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "strategies_select_own" ON "public"."strategies" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "strategies_update_own" ON "public"."strategies" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."strategy_bucket_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "strategy_bucket_tags_select_own" ON "public"."strategy_bucket_tags" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."strategy_buckets" "b"
     JOIN "public"."strategies" "s" ON (("s"."id" = "b"."strategy_id")))
  WHERE (("b"."id" = "strategy_bucket_tags"."bucket_id") AND ("s"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."strategy_buckets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "strategy_buckets_select_own" ON "public"."strategy_buckets" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."strategies" "s"
  WHERE (("s"."id" = "strategy_buckets"."strategy_id") AND ("s"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."sync_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tags_shared_select" ON "public"."tags" FOR SELECT TO "authenticated", "anon" USING ("public"."can_view_owner"("user_id"));



ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."viewer_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "viewer_sessions_select_own" ON "public"."viewer_sessions" FOR SELECT TO "authenticated", "anon" USING ((("viewer_user_id" = "auth"."uid"()) OR ("owner_user_id" = "auth"."uid"())));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."activity_list_recent_events"("limit_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."activity_list_recent_events"("limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."activity_list_recent_events"("limit_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."activity_record_user_event"("input_action_type" "text", "input_target_table" "text", "input_target_id" "text", "input_before_data" "jsonb", "input_after_data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."activity_record_user_event"("input_action_type" "text", "input_target_table" "text", "input_target_id" "text", "input_before_data" "jsonb", "input_after_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."activity_record_user_event"("input_action_type" "text", "input_target_table" "text", "input_target_id" "text", "input_before_data" "jsonb", "input_after_data" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."add_friend"("input_public_name" "text", "input_viewer_password" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."add_friend"("input_public_name" "text", "input_viewer_password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_friend"("input_public_name" "text", "input_viewer_password" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."agent_create_token"("input_name" "text", "input_token_hash" "text", "input_token_prefix" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."agent_create_token"("input_name" "text", "input_token_hash" "text", "input_token_prefix" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."agent_create_token"("input_name" "text", "input_token_hash" "text", "input_token_prefix" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."agent_find_holdings"("input_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."agent_find_holdings"("input_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."agent_find_holdings"("input_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."agent_list_tokens"() TO "anon";
GRANT ALL ON FUNCTION "public"."agent_list_tokens"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."agent_list_tokens"() TO "service_role";



GRANT ALL ON FUNCTION "public"."agent_revoke_token"("input_token_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."agent_revoke_token"("input_token_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."agent_revoke_token"("input_token_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."agent_update_holding_avg_price"("input_holding_id" bigint, "input_avg_price" numeric, "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."agent_update_holding_avg_price"("input_holding_id" bigint, "input_avg_price" numeric, "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."agent_update_holding_avg_price"("input_holding_id" bigint, "input_avg_price" numeric, "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_bulk_save_portfolio_rows"("input_rows" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."app_bulk_save_portfolio_rows"("input_rows" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_bulk_save_portfolio_rows"("input_rows" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_delete_account"("input_account_id" bigint, "input_source" "text", "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."app_delete_account"("input_account_id" bigint, "input_source" "text", "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_delete_account"("input_account_id" bigint, "input_source" "text", "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_delete_holding"("input_holding_id" bigint, "input_source" "text", "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."app_delete_holding"("input_holding_id" bigint, "input_source" "text", "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_delete_holding"("input_holding_id" bigint, "input_source" "text", "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_delete_instrument"("input_instrument_id" bigint, "input_source" "text", "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."app_delete_instrument"("input_instrument_id" bigint, "input_source" "text", "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_delete_instrument"("input_instrument_id" bigint, "input_source" "text", "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_delete_tag"("input_tag_id" bigint, "input_source" "text", "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."app_delete_tag"("input_tag_id" bigint, "input_source" "text", "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_delete_tag"("input_tag_id" bigint, "input_source" "text", "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_find_holdings"("input_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."app_find_holdings"("input_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_find_holdings"("input_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_get_portfolio_state"("input_owner_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."app_get_portfolio_state"("input_owner_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_get_portfolio_state"("input_owner_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_get_strategy_state"("input_owner_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."app_get_strategy_state"("input_owner_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_get_strategy_state"("input_owner_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_list_recent_activity"("limit_count" integer, "input_owner_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."app_list_recent_activity"("limit_count" integer, "input_owner_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_list_recent_activity"("limit_count" integer, "input_owner_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."app_portfolio_snapshot"("input_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."app_portfolio_snapshot"("input_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."app_portfolio_snapshot"("input_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_portfolio_snapshot"("input_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_save_account"("input_account_id" bigint, "input_name" "text", "input_broker" "text", "input_note" "text", "input_source" "text", "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."app_save_account"("input_account_id" bigint, "input_name" "text", "input_broker" "text", "input_note" "text", "input_source" "text", "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_save_account"("input_account_id" bigint, "input_name" "text", "input_broker" "text", "input_note" "text", "input_source" "text", "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_save_cash_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_balance" numeric, "input_note" "text", "input_source" "text", "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."app_save_cash_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_balance" numeric, "input_note" "text", "input_source" "text", "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_save_cash_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_balance" numeric, "input_note" "text", "input_source" "text", "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_save_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_quantity" numeric, "input_avg_price" numeric, "input_note" "text", "input_source" "text", "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."app_save_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_quantity" numeric, "input_avg_price" numeric, "input_note" "text", "input_source" "text", "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_save_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_quantity" numeric, "input_avg_price" numeric, "input_note" "text", "input_source" "text", "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_save_instrument"("input_instrument_id" bigint, "input_ticker" "text", "input_display_name" "text", "input_currency" "text", "input_instrument_type" "text", "input_price" numeric, "input_price_date" "date", "input_tag_id" bigint, "input_source" "text", "input_request" "text", "input_price_source" "text", "input_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."app_save_instrument"("input_instrument_id" bigint, "input_ticker" "text", "input_display_name" "text", "input_currency" "text", "input_instrument_type" "text", "input_price" numeric, "input_price_date" "date", "input_tag_id" bigint, "input_source" "text", "input_request" "text", "input_price_source" "text", "input_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_save_instrument"("input_instrument_id" bigint, "input_ticker" "text", "input_display_name" "text", "input_currency" "text", "input_instrument_type" "text", "input_price" numeric, "input_price_date" "date", "input_tag_id" bigint, "input_source" "text", "input_request" "text", "input_price_source" "text", "input_note" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_save_nonmarket_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_kind" "text", "input_quantity" numeric, "input_purchase_amount" numeric, "input_valuation_amount" numeric, "input_note" "text", "input_source" "text", "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."app_save_nonmarket_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_kind" "text", "input_quantity" numeric, "input_purchase_amount" numeric, "input_valuation_amount" numeric, "input_note" "text", "input_source" "text", "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_save_nonmarket_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_kind" "text", "input_quantity" numeric, "input_purchase_amount" numeric, "input_valuation_amount" numeric, "input_note" "text", "input_source" "text", "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_save_strategy"("input_name" "text", "input_monthly_contribution" numeric, "input_review_day" integer, "input_drift_threshold" numeric, "input_buckets" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."app_save_strategy"("input_name" "text", "input_monthly_contribution" numeric, "input_review_day" integer, "input_drift_threshold" numeric, "input_buckets" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_save_strategy"("input_name" "text", "input_monthly_contribution" numeric, "input_review_day" integer, "input_drift_threshold" numeric, "input_buckets" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_save_tag"("input_tag_id" bigint, "input_name" "text", "input_sort_order" integer, "input_source" "text", "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."app_save_tag"("input_tag_id" bigint, "input_name" "text", "input_sort_order" integer, "input_source" "text", "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_save_tag"("input_tag_id" bigint, "input_name" "text", "input_sort_order" integer, "input_source" "text", "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."app_save_valuation_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_purchase_amount" numeric, "input_valuation_amount" numeric, "input_note" "text", "input_source" "text", "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."app_save_valuation_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_purchase_amount" numeric, "input_valuation_amount" numeric, "input_note" "text", "input_source" "text", "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."app_save_valuation_holding"("input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_purchase_amount" numeric, "input_valuation_amount" numeric, "input_note" "text", "input_source" "text", "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_view_owner"("owner_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."can_view_owner"("owner_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_owner"("owner_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_active_viewer_access"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_active_viewer_access"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_viewer_access"() TO "service_role";



GRANT ALL ON FUNCTION "public"."list_friends"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_friends"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_friends"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_adopt_agent_token"("input_token_hash" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_adopt_agent_token"("input_token_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_adopt_agent_token"("input_token_hash" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_delete_account"("input_token_hash" "text", "input_account_id" bigint, "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_delete_account"("input_token_hash" "text", "input_account_id" bigint, "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_delete_account"("input_token_hash" "text", "input_account_id" bigint, "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_delete_holding"("input_token_hash" "text", "input_holding_id" bigint, "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_delete_holding"("input_token_hash" "text", "input_holding_id" bigint, "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_delete_holding"("input_token_hash" "text", "input_holding_id" bigint, "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_delete_instrument"("input_token_hash" "text", "input_instrument_id" bigint, "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_delete_instrument"("input_token_hash" "text", "input_instrument_id" bigint, "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_delete_instrument"("input_token_hash" "text", "input_instrument_id" bigint, "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_delete_tag"("input_token_hash" "text", "input_tag_id" bigint, "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_delete_tag"("input_token_hash" "text", "input_tag_id" bigint, "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_delete_tag"("input_token_hash" "text", "input_tag_id" bigint, "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_find_holdings"("input_token_hash" "text", "input_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_find_holdings"("input_token_hash" "text", "input_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_find_holdings"("input_token_hash" "text", "input_query" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_get_portfolio_state"("input_token_hash" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_get_portfolio_state"("input_token_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_get_portfolio_state"("input_token_hash" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_get_price_sync_targets"("input_token_hash" "text", "input_tickers" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_get_price_sync_targets"("input_token_hash" "text", "input_tickers" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_get_price_sync_targets"("input_token_hash" "text", "input_tickers" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_list_recent_activity"("input_token_hash" "text", "limit_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_list_recent_activity"("input_token_hash" "text", "limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_list_recent_activity"("input_token_hash" "text", "limit_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_record_sync_run"("input_token_hash" "text", "input_total_count" integer, "input_synced_count" integer, "input_failed" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_record_sync_run"("input_token_hash" "text", "input_total_count" integer, "input_synced_count" integer, "input_failed" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_record_sync_run"("input_token_hash" "text", "input_total_count" integer, "input_synced_count" integer, "input_failed" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_save_account"("input_token_hash" "text", "input_account_id" bigint, "input_name" "text", "input_broker" "text", "input_note" "text", "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_save_account"("input_token_hash" "text", "input_account_id" bigint, "input_name" "text", "input_broker" "text", "input_note" "text", "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_save_account"("input_token_hash" "text", "input_account_id" bigint, "input_name" "text", "input_broker" "text", "input_note" "text", "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_save_holding"("input_token_hash" "text", "input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_quantity" numeric, "input_avg_price" numeric, "input_purchase_amount" numeric, "input_valuation_amount" numeric, "input_note" "text", "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_save_holding"("input_token_hash" "text", "input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_quantity" numeric, "input_avg_price" numeric, "input_purchase_amount" numeric, "input_valuation_amount" numeric, "input_note" "text", "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_save_holding"("input_token_hash" "text", "input_holding_id" bigint, "input_account_id" bigint, "input_ticker" "text", "input_quantity" numeric, "input_avg_price" numeric, "input_purchase_amount" numeric, "input_valuation_amount" numeric, "input_note" "text", "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_save_instrument"("input_token_hash" "text", "input_instrument_id" bigint, "input_ticker" "text", "input_display_name" "text", "input_currency" "text", "input_instrument_type" "text", "input_price" numeric, "input_price_date" "date", "input_tag_id" bigint, "input_request" "text", "input_price_source" "text", "input_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_save_instrument"("input_token_hash" "text", "input_instrument_id" bigint, "input_ticker" "text", "input_display_name" "text", "input_currency" "text", "input_instrument_type" "text", "input_price" numeric, "input_price_date" "date", "input_tag_id" bigint, "input_request" "text", "input_price_source" "text", "input_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_save_instrument"("input_token_hash" "text", "input_instrument_id" bigint, "input_ticker" "text", "input_display_name" "text", "input_currency" "text", "input_instrument_type" "text", "input_price" numeric, "input_price_date" "date", "input_tag_id" bigint, "input_request" "text", "input_price_source" "text", "input_note" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_save_tag"("input_token_hash" "text", "input_tag_id" bigint, "input_name" "text", "input_sort_order" integer, "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_save_tag"("input_token_hash" "text", "input_tag_id" bigint, "input_name" "text", "input_sort_order" integer, "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_save_tag"("input_token_hash" "text", "input_tag_id" bigint, "input_name" "text", "input_sort_order" integer, "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_touch_agent_token"("input_token_hash" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_touch_agent_token"("input_token_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_touch_agent_token"("input_token_hash" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_update_holding_avg_price"("input_token_hash" "text", "input_holding_id" bigint, "input_avg_price" numeric, "input_request" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_update_holding_avg_price"("input_token_hash" "text", "input_holding_id" bigint, "input_avg_price" numeric, "input_request" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_update_holding_avg_price"("input_token_hash" "text", "input_holding_id" bigint, "input_avg_price" numeric, "input_request" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."mcp_upsert_price_rows"("input_token_hash" "text", "input_ticker" "text", "input_prices" "jsonb", "input_holidays" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."mcp_upsert_price_rows"("input_token_hash" "text", "input_ticker" "text", "input_prices" "jsonb", "input_holidays" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mcp_upsert_price_rows"("input_token_hash" "text", "input_ticker" "text", "input_prices" "jsonb", "input_holidays" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_public_name"("input_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_public_name"("input_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_public_name"("input_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."recalc_holding"("p_account_id" bigint, "p_ticker" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."recalc_holding"("p_account_id" bigint, "p_ticker" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalc_holding"("p_account_id" bigint, "p_ticker" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."recalc_holding"("p_user_id" "uuid", "p_account_id" bigint, "p_ticker" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."recalc_holding"("p_user_id" "uuid", "p_account_id" bigint, "p_ticker" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalc_holding"("p_user_id" "uuid", "p_account_id" bigint, "p_ticker" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."remove_friend"("input_owner_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."remove_friend"("input_owner_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_friend"("input_owner_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_profile_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_profile_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_profile_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON FUNCTION "public"."set_viewer_profile"("input_public_name" "text", "input_viewer_password" "text", "input_sharing_enabled" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."set_viewer_profile"("input_public_name" "text", "input_viewer_password" "text", "input_sharing_enabled" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_viewer_profile"("input_public_name" "text", "input_viewer_password" "text", "input_sharing_enabled" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."transactions_recalc_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."transactions_recalc_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."transactions_recalc_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."unlock_viewer_access"("input_public_name" "text", "input_viewer_password" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."unlock_viewer_access"("input_public_name" "text", "input_viewer_password" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unlock_viewer_access"("input_public_name" "text", "input_viewer_password" "text") TO "service_role";



GRANT ALL ON TABLE "public"."accounts" TO "anon";
GRANT ALL ON TABLE "public"."accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."accounts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."accounts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."accounts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."accounts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."activity_events" TO "anon";
GRANT ALL ON TABLE "public"."activity_events" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."activity_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."activity_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."activity_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."agent_tokens" TO "anon";
GRANT ALL ON TABLE "public"."agent_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."daily_reports" TO "anon";
GRANT ALL ON TABLE "public"."daily_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_reports" TO "service_role";



GRANT ALL ON SEQUENCE "public"."daily_reports_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."daily_reports_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."daily_reports_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."friendships" TO "anon";
GRANT ALL ON TABLE "public"."friendships" TO "authenticated";
GRANT ALL ON TABLE "public"."friendships" TO "service_role";



GRANT ALL ON TABLE "public"."holding_prices_daily" TO "anon";
GRANT ALL ON TABLE "public"."holding_prices_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."holding_prices_daily" TO "service_role";



GRANT ALL ON SEQUENCE "public"."holding_prices_daily_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."holding_prices_daily_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."holding_prices_daily_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."holdings" TO "anon";
GRANT ALL ON TABLE "public"."holdings" TO "authenticated";
GRANT ALL ON TABLE "public"."holdings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."holdings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."holdings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."holdings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."instrument_tags" TO "anon";
GRANT ALL ON TABLE "public"."instrument_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."instrument_tags" TO "service_role";



GRANT ALL ON SEQUENCE "public"."instrument_tags_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."instrument_tags_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."instrument_tags_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."instruments" TO "anon";
GRANT ALL ON TABLE "public"."instruments" TO "authenticated";
GRANT ALL ON TABLE "public"."instruments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."instruments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."instruments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."instruments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."portfolio_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."portfolio_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio_snapshots" TO "service_role";



GRANT ALL ON SEQUENCE "public"."portfolio_snapshots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."portfolio_snapshots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."portfolio_snapshots_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."portfolio_view" TO "anon";
GRANT ALL ON TABLE "public"."portfolio_view" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio_view" TO "service_role";



GRANT ALL ON TABLE "public"."rebalance_suggestions" TO "anon";
GRANT ALL ON TABLE "public"."rebalance_suggestions" TO "authenticated";
GRANT ALL ON TABLE "public"."rebalance_suggestions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."rebalance_suggestions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."rebalance_suggestions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."rebalance_suggestions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."strategies" TO "anon";
GRANT ALL ON TABLE "public"."strategies" TO "authenticated";
GRANT ALL ON TABLE "public"."strategies" TO "service_role";



GRANT ALL ON SEQUENCE "public"."strategies_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."strategies_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."strategies_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."strategy_bucket_tags" TO "anon";
GRANT ALL ON TABLE "public"."strategy_bucket_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."strategy_bucket_tags" TO "service_role";



GRANT ALL ON TABLE "public"."strategy_buckets" TO "anon";
GRANT ALL ON TABLE "public"."strategy_buckets" TO "authenticated";
GRANT ALL ON TABLE "public"."strategy_buckets" TO "service_role";



GRANT ALL ON SEQUENCE "public"."strategy_buckets_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."strategy_buckets_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."strategy_buckets_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sync_runs" TO "anon";
GRANT ALL ON TABLE "public"."sync_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."sync_runs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sync_runs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sync_runs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sync_runs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tags" TO "anon";
GRANT ALL ON TABLE "public"."tags" TO "authenticated";
GRANT ALL ON TABLE "public"."tags" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tags_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tags_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tags_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."transactions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."transactions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."transactions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."viewer_sessions" TO "anon";
GRANT ALL ON TABLE "public"."viewer_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."viewer_sessions" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







