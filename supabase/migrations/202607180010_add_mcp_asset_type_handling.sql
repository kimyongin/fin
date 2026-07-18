drop function if exists public.mcp_save_holding(text, bigint, bigint, text, numeric, numeric, text, text);

create function public.mcp_save_holding(
    input_token_hash text,
    input_holding_id bigint default null,
    input_account_id bigint default null,
    input_ticker text default null,
    input_quantity numeric default null,
    input_avg_price numeric default null,
    input_purchase_amount numeric default null,
    input_valuation_amount numeric default null,
    input_note text default null,
    input_request text default null
)
returns table (
    holding_id bigint, account_id bigint, account_name text, ticker text, display_name text,
    instrument_type text, quantity numeric, avg_price numeric, purchase_amount numeric, valuation_amount numeric,
    note text, activity_id bigint
)
language plpgsql security definer set search_path = public as $$
declare
    type_value text;
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    select instrument_type into type_value from public.instruments where user_id = auth.uid() and ticker = upper(trim(coalesce(input_ticker, '')));
    if type_value = 'valuation' then
      return query select h.holding_id, h.account_id, h.account_name, h.ticker, h.display_name, type_value, h.quantity, h.avg_price, h.purchase_amount, h.valuation_amount, h.note, h.activity_id
      from public.app_save_valuation_holding(input_holding_id, input_account_id, input_ticker, input_purchase_amount, input_valuation_amount, input_note, 'agent', input_request) h;
    elsif type_value = 'cash' then
      return query select h.holding_id, h.account_id, h.account_name, h.ticker, h.display_name, type_value, h.quantity, h.avg_price, h.purchase_amount, h.valuation_amount, h.note, h.activity_id
      from public.app_save_cash_holding(input_holding_id, input_account_id, input_ticker, input_quantity, input_note, 'agent', input_request) h;
    elsif type_value = 'market' then
      return query select h.holding_id, h.account_id, h.account_name, h.ticker, h.display_name, type_value, h.quantity, h.avg_price, null::numeric, null::numeric, h.note, h.activity_id
      from public.app_save_holding(input_holding_id, input_account_id, input_ticker, input_quantity, input_avg_price, input_note, 'agent', input_request) h;
    else
      raise exception 'Instrument not found or cannot be held';
    end if;
end; $$;

grant execute on function public.mcp_save_holding(text, bigint, bigint, text, numeric, numeric, numeric, numeric, text, text) to anon, authenticated;
