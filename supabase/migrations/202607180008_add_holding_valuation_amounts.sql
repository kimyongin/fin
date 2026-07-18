alter table public.instruments
drop constraint if exists instruments_instrument_type_check;

update public.instruments
set instrument_type = 'market'
where instrument_type = 'investment';

alter table public.instruments
add constraint instruments_instrument_type_check
check (instrument_type in ('market', 'valuation', 'cash', 'fx'));

alter table public.holdings
add column if not exists purchase_amount numeric,
add column if not exists valuation_amount numeric;

alter table public.holdings
alter column quantity drop not null,
alter column avg_price drop not null;

update public.holdings
set purchase_amount = quantity * avg_price
where purchase_amount is null
  and quantity is not null
  and avg_price is not null;

alter table public.holdings
add constraint holdings_purchase_amount_nonnegative
check (purchase_amount is null or purchase_amount >= 0) not valid,
add constraint holdings_valuation_amount_nonnegative
check (valuation_amount is null or valuation_amount >= 0) not valid;

alter table public.holdings
validate constraint holdings_purchase_amount_nonnegative,
validate constraint holdings_valuation_amount_nonnegative;

create or replace function public.app_bulk_save_portfolio_rows(input_rows jsonb default '[]'::jsonb)
returns table (account_count integer, instrument_count integer, holding_count integer, activity_id bigint)
language plpgsql security definer set search_path = public as $$
declare
  current_user_id uuid := auth.uid(); input_row jsonb; type_value text; ticker_value text;
  account_value text; name_value text; account_id_value bigint; instrument_id_value bigint;
  tag_id_value bigint; holding_id_value bigint; before_rows jsonb := '[]'::jsonb; after_rows jsonb := '[]'::jsonb;
  created_accounts integer := 0; created_instruments integer := 0; saved_holdings integer := 0; event_id bigint;
  quantity_value numeric; average_value numeric; purchase_value numeric; valuation_value numeric;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(input_rows) <> 'array' or jsonb_array_length(input_rows) = 0 or jsonb_array_length(input_rows) > 200 then raise exception 'Provide 1 to 200 rows'; end if;
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
    if type_value = 'market' and (ticker_value = '' or quantity_value is null or average_value is null) then raise exception 'Market investments require ticker, quantity, and average price'; end if;
    if type_value = 'valuation' and (purchase_value is null or valuation_value is null) then raise exception 'Valuation investments require purchase and valuation amounts'; end if;
    if type_value = 'cash' and quantity_value is null then raise exception 'Cash requires a balance'; end if;
    if ticker_value = '' then ticker_value := case when type_value = 'cash' then 'CASH:' else 'VALUATION:' end || upper(substr(md5(name_value || '|' || coalesce(input_row ->> 'currency', 'KRW')), 1, 20)); end if;
    select id into account_id_value from public.accounts where user_id = current_user_id and lower(name) = lower(account_value) limit 1;
    if account_id_value is null then insert into public.accounts (user_id, name, broker, is_active) values (current_user_id, account_value, nullif(trim(coalesce(input_row ->> 'broker', '')), ''), true) returning id into account_id_value; created_accounts := created_accounts + 1; end if;
    select id into instrument_id_value from public.instruments where user_id = current_user_id and ticker = ticker_value;
    if instrument_id_value is null then insert into public.instruments (user_id, ticker, display_name, currency, instrument_type, price_source) values (current_user_id, ticker_value, name_value, upper(coalesce(input_row ->> 'currency', 'KRW')), type_value, 'manual') returning id into instrument_id_value; created_instruments := created_instruments + 1;
    else update public.instruments set display_name = name_value, currency = upper(coalesce(input_row ->> 'currency', 'KRW')), instrument_type = type_value where id = instrument_id_value; end if;
    tag_id_value := nullif(input_row ->> 'tag_id', '')::bigint;
    delete from public.instrument_tags where user_id = current_user_id and ticker = ticker_value;
    if tag_id_value is not null then insert into public.instrument_tags (user_id, ticker, tag_id) values (current_user_id, ticker_value, tag_id_value); end if;
    select to_jsonb(h) into before_rows from public.holdings h where false;
    insert into public.holdings (user_id, account_id, ticker, quantity, avg_price, purchase_amount, valuation_amount, note)
    values (current_user_id, account_id_value, ticker_value, quantity_value, average_value, purchase_value, valuation_value, nullif(trim(coalesce(input_row ->> 'note', '')), ''))
    on conflict on constraint holdings_account_id_ticker_key do update set quantity = excluded.quantity, avg_price = excluded.avg_price, purchase_amount = excluded.purchase_amount, valuation_amount = excluded.valuation_amount, note = excluded.note
    returning id into holding_id_value;
    select to_jsonb(h) into after_rows from public.holdings h where h.id = holding_id_value;
    saved_holdings := saved_holdings + 1;
  end loop;
  insert into public.activity_events (user_id, source, action_type, target_table, after_data, status) values (current_user_id, 'user', 'bulk_edit_portfolio', 'portfolio', jsonb_build_object('holdings', after_rows, 'row_count', saved_holdings), 'succeeded') returning id into event_id;
  return query select created_accounts, created_instruments, saved_holdings, event_id;
end; $$;
