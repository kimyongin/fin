update public.instruments
set currency = 'USD'
where ticker in ('DGRW', 'QQQM', 'SPYM');

insert into public.instruments (user_id, ticker, display_name, currency, instrument_type, price_source)
select distinct user_id, 'USDKRW=X', 'USD/KRW', 'KRW', 'fx', 'manual'
from public.instruments
on conflict (user_id, ticker) do update
set display_name = excluded.display_name,
    currency = excluded.currency,
    instrument_type = excluded.instrument_type;

insert into public.holding_prices_daily (user_id, ticker, price_date, close_price, source)
select distinct user_id, 'USDKRW=X', date '2026-06-28', 1535.19, 'manual'
from public.instruments
on conflict (user_id, ticker, price_date) do update
set close_price = excluded.close_price,
    source = excluded.source;
