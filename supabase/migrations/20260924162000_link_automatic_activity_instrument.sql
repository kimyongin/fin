-- Existing automatic holding writers identify the changed holding through
-- target_table/target_id. Give their records the same common instrument link
-- as manual records without changing financial execution targets.
create or replace function public.app_fill_activity_holding_reference()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  resolved_holding bigint;
  resolved_instrument bigint;
begin
  if new.target_table='holdings' and new.target_id ~ '^[0-9]+$' then
    select h.id,i.id into resolved_holding,resolved_instrument
    from public.holdings h
    left join public.instruments i on i.user_id=h.user_id and i.ticker=h.ticker
    where h.id=new.target_id::bigint and h.user_id=new.user_id;
    if found then
      new.holding_id:=coalesce(new.holding_id,resolved_holding);
      new.instrument_id:=coalesce(new.instrument_id,resolved_instrument);
    end if;
  end if;
  return new;
end;
$$;
