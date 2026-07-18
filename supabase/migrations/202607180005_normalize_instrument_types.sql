update public.instruments
set instrument_type = 'etf'
where instrument_type not in ('etf', 'cash', 'fx')
   or instrument_type is null;
