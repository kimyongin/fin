-- Registration is create-only. A lookup or a duplicate request must never mutate an existing instrument.
create function public.app_create_instrument(
  input_ticker text, input_display_name text, input_currency text,
  input_instrument_type text, input_tag_id bigint default null, input_note text default null
) returns table (instrument_id bigint, ticker text, display_name text, currency text,
  instrument_type text, activity_id bigint)
language plpgsql security definer set search_path = public as $$
declare
  owner_id uuid := auth.uid();
  normalized_ticker text := upper(trim(coalesce(input_ticker, '')));
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if normalized_ticker = '' then raise exception 'Ticker is required'; end if;
  if input_instrument_type not in ('market', 'valuation', 'cash') then
    raise exception 'Invalid instrument type';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':instrument:' || normalized_ticker, 0));
  if exists(select 1 from public.instruments i where i.user_id = owner_id and i.ticker = normalized_ticker) then
    raise exception 'Instrument already registered';
  end if;
  return query select saved.instrument_id, saved.ticker, saved.display_name,
    saved.currency, saved.instrument_type, saved.activity_id
  from public.app_save_instrument(
    input_instrument_id => null, input_ticker => normalized_ticker,
    input_display_name => input_display_name, input_currency => input_currency,
    input_instrument_type => input_instrument_type, input_price => null,
    input_price_date => null, input_tag_id => input_tag_id, input_source => 'user',
    input_request => null, input_price_source => 'manual', input_note => input_note
  ) saved;
end;
$$;

-- Preserve the proven atomic holding write, but retire its public manual-price input.
alter function public.app_save_asset_detail_current(bigint,jsonb,jsonb,jsonb,uuid,text)
  rename to app_save_asset_detail_internal;
revoke all on function public.app_save_asset_detail_internal(bigint,jsonb,jsonb,jsonb,uuid,text)
  from public, anon, authenticated;
create function public.app_save_asset_detail_current(
  input_instrument_id bigint, input_expected jsonb, input_instrument jsonb,
  input_holdings jsonb, input_idempotency_key uuid, input_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if input_instrument ? 'manual_price' or input_instrument ? 'manual_price_date' then
    raise exception 'Manual price is not accepted in asset detail';
  end if;
  return public.app_save_asset_detail_internal(input_instrument_id, input_expected,
    input_instrument, input_holdings, input_idempotency_key, input_reason);
end;
$$;
revoke all on function public.app_save_asset_detail_current(bigint,jsonb,jsonb,jsonb,uuid,text) from public, anon;
grant execute on function public.app_save_asset_detail_current(bigint,jsonb,jsonb,jsonb,uuid,text) to authenticated;
revoke all on function public.app_create_instrument(text,text,text,text,bigint,text) from public, anon;
grant execute on function public.app_create_instrument(text,text,text,text,bigint,text) to authenticated;

-- Price refresh covers registered market instruments even before the first holding.
create or replace function public.app_get_price_sync_targets(input_tickers text[] default null)
returns table (ticker text, source_symbol text, last_price_date date)
language plpgsql stable security definer set search_path = public as $$
declare owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  return query
  with requested as (
    select distinct upper(trim(value)) as ticker
    from unnest(coalesce(input_tickers, array[]::text[])) as value
    where nullif(trim(value), '') is not null
  )
  select i.ticker, i.source_symbol, max(p.price_date)
  from public.instruments i
  left join public.holding_prices_daily p on p.user_id = owner_id and p.ticker = i.ticker
  where i.user_id = owner_id and i.instrument_type in ('market', 'fx')
    and (not exists(select 1 from requested) or i.ticker in (select r.ticker from requested r))
  group by i.ticker, i.source_symbol
  order by i.ticker;
end;
$$;
