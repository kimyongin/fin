create or replace function public.app_save_nonmarket_holding(
    input_holding_id bigint, input_account_id bigint, input_ticker text, input_kind text, input_quantity numeric,
    input_purchase_amount numeric, input_valuation_amount numeric, input_note text, input_source text, input_request text
)
returns table (holding_id bigint, account_id bigint, account_name text, ticker text, display_name text, quantity numeric, avg_price numeric, purchase_amount numeric, valuation_amount numeric, note text, activity_id bigint)
language plpgsql security definer set search_path = public as $$
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
  return query select h.id, h.account_id, a.name, h.ticker, i.display_name, h.quantity::numeric, h.avg_price::numeric, h.purchase_amount, h.valuation_amount, h.note, event_id
  from public.holdings h join public.accounts a on a.id = h.account_id join public.instruments i on i.user_id = h.user_id and i.ticker = h.ticker where h.id = saved_holding_id;
end; $$;
