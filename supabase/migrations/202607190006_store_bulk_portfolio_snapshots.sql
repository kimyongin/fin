create or replace function public.app_portfolio_snapshot(input_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.accounts a where a.user_id = input_user_id), '[]'::jsonb),
    'instruments', coalesce((select jsonb_agg(to_jsonb(i) order by i.ticker) from public.instruments i where i.user_id = input_user_id), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order, t.id) from public.tags t where t.user_id = input_user_id), '[]'::jsonb),
    'instrument_tags', coalesce((select jsonb_agg(to_jsonb(it) order by it.ticker) from public.instrument_tags it where it.user_id = input_user_id), '[]'::jsonb),
    'holdings', coalesce((select jsonb_agg(to_jsonb(h) order by h.account_id, h.ticker) from public.holdings h where h.user_id = input_user_id), '[]'::jsonb)
  );
$$;

revoke all on function public.app_portfolio_snapshot(uuid) from public;

create or replace function public.app_bulk_save_portfolio_rows(input_rows jsonb default '[]'::jsonb)
returns table (account_count integer, instrument_count integer, holding_count integer, activity_id bigint)
language plpgsql security definer set search_path = public as $$
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
