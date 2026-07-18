update public.holdings h
set valuation_amount = coalesce(h.valuation_amount, h.quantity),
    quantity = null,
    avg_price = null
from public.instruments i
where i.user_id = h.user_id
  and i.ticker = h.ticker
  and i.instrument_type = 'cash';

create or replace function public.app_save_nonmarket_holding(
    input_holding_id bigint, input_account_id bigint, input_ticker text, input_kind text, input_quantity numeric,
    input_purchase_amount numeric, input_valuation_amount numeric, input_note text, input_source text, input_request text
)
returns table (holding_id bigint, account_id bigint, account_name text, ticker text, display_name text, quantity numeric, avg_price numeric, purchase_amount numeric, valuation_amount numeric, note text, activity_id bigint)
language plpgsql security definer set search_path = public as $$
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

create or replace function public.app_save_cash_holding(
    input_holding_id bigint default null, input_account_id bigint default null, input_ticker text default null,
    input_balance numeric default null, input_note text default null, input_source text default 'user', input_request text default null
)
returns table (holding_id bigint, account_id bigint, account_name text, ticker text, display_name text, quantity numeric, avg_price numeric, purchase_amount numeric, valuation_amount numeric, note text, activity_id bigint)
language sql security definer set search_path = public as $$
  select * from public.app_save_nonmarket_holding(input_holding_id, input_account_id, input_ticker, 'cash', null, null, input_balance, input_note, input_source, input_request);
$$;

create or replace function public.app_bulk_save_portfolio_rows(input_rows jsonb default '[]'::jsonb)
returns table (account_count integer, instrument_count integer, holding_count integer, activity_id bigint)
language plpgsql security definer set search_path = public as $$
declare current_user_id uuid := auth.uid(); input_row jsonb; type_value text; ticker_value text; account_value text; name_value text; account_id_value bigint; instrument_id_value bigint; tag_id_value bigint; holding_id_value bigint; before_rows jsonb := '[]'::jsonb; after_rows jsonb := '[]'::jsonb; row_data jsonb; created_accounts integer := 0; created_instruments integer := 0; saved_holdings integer := 0; event_id bigint; quantity_value numeric; average_value numeric; purchase_value numeric; valuation_value numeric;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(input_rows) <> 'array' or jsonb_array_length(input_rows) = 0 or jsonb_array_length(input_rows) > 200 then raise exception 'Provide 1 to 200 rows'; end if;
  for input_row in select value from jsonb_array_elements(input_rows) loop
    account_value := trim(coalesce(input_row ->> 'account_name', '')); name_value := trim(coalesce(input_row ->> 'display_name', '')); type_value := lower(trim(coalesce(input_row ->> 'instrument_type', 'market'))); ticker_value := upper(trim(coalesce(input_row ->> 'ticker', ''))); quantity_value := nullif(input_row ->> 'quantity', '')::numeric; average_value := nullif(input_row ->> 'avg_price', '')::numeric; purchase_value := nullif(input_row ->> 'purchase_amount', '')::numeric; valuation_value := nullif(input_row ->> 'valuation_amount', '')::numeric;
    if account_value = '' or name_value = '' then raise exception 'Account name and instrument name are required'; end if;
    if type_value not in ('market', 'valuation', 'cash') then raise exception 'Invalid instrument type'; end if;
    if type_value = 'market' and (ticker_value = '' or quantity_value is null or quantity_value < 0 or average_value is null or average_value < 0) then raise exception 'Market investments require ticker, quantity, and average price'; end if;
    if type_value = 'valuation' and (purchase_value is null or purchase_value < 0 or valuation_value is null or valuation_value < 0) then raise exception 'Valuation investments require purchase and valuation amounts'; end if;
    if type_value = 'cash' and (valuation_value is null or valuation_value < 0) then raise exception 'Cash requires a nonnegative valuation amount'; end if;
    if ticker_value = '' then ticker_value := case when type_value = 'cash' then 'CASH:' else 'VALUATION:' end || upper(substr(md5(account_value || '|' || name_value || '|' || coalesce(input_row ->> 'currency', 'KRW')), 1, 20)); end if;
    select id into account_id_value from public.accounts where user_id = current_user_id and lower(name) = lower(account_value) limit 1;
    if account_id_value is null then insert into public.accounts (user_id, name, broker, is_active) values (current_user_id, account_value, nullif(trim(coalesce(input_row ->> 'broker', '')), ''), true) returning id into account_id_value; created_accounts := created_accounts + 1; else update public.accounts set broker = nullif(trim(coalesce(input_row ->> 'broker', '')), '') where id = account_id_value; end if;
    select id into instrument_id_value from public.instruments where user_id = current_user_id and ticker = ticker_value;
    if instrument_id_value is null then insert into public.instruments (user_id, ticker, display_name, currency, instrument_type, price_source) values (current_user_id, ticker_value, name_value, upper(coalesce(input_row ->> 'currency', 'KRW')), type_value, 'manual') returning id into instrument_id_value; created_instruments := created_instruments + 1; else update public.instruments set display_name = name_value, currency = upper(coalesce(input_row ->> 'currency', 'KRW')), instrument_type = type_value where id = instrument_id_value; end if;
    tag_id_value := nullif(input_row ->> 'tag_id', '')::bigint; if tag_id_value is not null and not exists (select 1 from public.tags where id = tag_id_value and user_id = current_user_id) then raise exception 'Tag not found'; end if;
    delete from public.instrument_tags where user_id = current_user_id and ticker = ticker_value; if tag_id_value is not null then insert into public.instrument_tags (user_id, ticker, tag_id) values (current_user_id, ticker_value, tag_id_value); end if;
    select to_jsonb(h) into row_data from public.holdings h where h.user_id = current_user_id and h.account_id = account_id_value and h.ticker = ticker_value; if row_data is not null then before_rows := before_rows || jsonb_build_array(row_data); end if;
    insert into public.holdings (user_id, account_id, ticker, quantity, avg_price, purchase_amount, valuation_amount, note) values (current_user_id, account_id_value, ticker_value, case when type_value = 'market' then quantity_value else null end, case when type_value = 'market' then average_value else null end, case when type_value = 'valuation' then purchase_value else null end, case when type_value in ('valuation', 'cash') then valuation_value else null end, nullif(trim(coalesce(input_row ->> 'note', '')), '')) on conflict on constraint holdings_account_id_ticker_key do update set quantity = excluded.quantity, avg_price = excluded.avg_price, purchase_amount = excluded.purchase_amount, valuation_amount = excluded.valuation_amount, note = excluded.note returning id into holding_id_value;
    select to_jsonb(h) into row_data from public.holdings h where h.id = holding_id_value; after_rows := after_rows || jsonb_build_array(row_data); saved_holdings := saved_holdings + 1;
  end loop;
  insert into public.activity_events (user_id, source, action_type, target_table, before_data, after_data, status) values (current_user_id, 'user', 'bulk_edit_portfolio', 'portfolio', jsonb_build_object('holdings', before_rows), jsonb_build_object('holdings', after_rows, 'row_count', saved_holdings), 'succeeded') returning id into event_id;
  return query select created_accounts, created_instruments, saved_holdings, event_id;
end; $$;
