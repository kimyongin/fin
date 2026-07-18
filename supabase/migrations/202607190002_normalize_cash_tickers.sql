insert into public.instruments (
  user_id,
  ticker,
  display_name,
  currency,
  instrument_type,
  price_source,
  note
)
select
  legacy.user_id,
  'KRW',
  legacy.display_name,
  'KRW',
  legacy.instrument_type,
  legacy.price_source,
  legacy.note
from public.instruments legacy
where legacy.ticker = 'CASH-KRW'
on conflict (user_id, ticker) do nothing;

update public.holdings canonical
set valuation_amount = coalesce(canonical.valuation_amount, 0) + coalesce(legacy.valuation_amount, 0)
from public.holdings legacy
where legacy.user_id = canonical.user_id
  and legacy.account_id = canonical.account_id
  and legacy.ticker = 'CASH-KRW'
  and canonical.ticker = 'KRW';

delete from public.holdings h
where h.ticker = 'CASH-KRW'
  and exists (
    select 1 from public.holdings canonical
    where canonical.user_id = h.user_id
      and canonical.account_id = h.account_id
      and canonical.ticker = 'KRW'
  );

update public.holdings h set ticker = 'KRW' where h.ticker = 'CASH-KRW';

delete from public.instrument_tags it
where it.ticker = 'CASH-KRW'
  and exists (select 1 from public.instrument_tags existing where existing.user_id = it.user_id and existing.ticker = 'KRW');

update public.instrument_tags it set ticker = 'KRW' where it.ticker = 'CASH-KRW';

delete from public.holding_prices_daily hp
where hp.ticker = 'CASH-KRW'
  and exists (select 1 from public.holding_prices_daily existing where existing.user_id = hp.user_id and existing.ticker = 'KRW' and existing.price_date = hp.price_date);

update public.holding_prices_daily hp set ticker = 'KRW' where hp.ticker = 'CASH-KRW';

delete from public.instruments i where i.ticker = 'CASH-KRW';
