-- These zero-row legacy outputs have no current application or migration-time
-- consumer. Do not silently discard rows added after the inventory audit.
do $$
declare
  legacy_name text;
  row_count bigint;
begin
  foreach legacy_name in array array[
    'transactions', 'portfolio_snapshots', 'daily_reports', 'rebalance_suggestions'
  ] loop
    if to_regclass('public.' || legacy_name) is not null then
      execute format('select count(*) from public.%I', legacy_name) into row_count;
      if row_count <> 0 then
        raise exception 'Legacy table % contains % rows; inspect before retirement', legacy_name, row_count;
      end if;
      execute format('drop table public.%I', legacy_name);
    end if;
  end loop;
end;
$$;
