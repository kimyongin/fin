begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(4);

select extensions.is(to_regclass('public.transactions'), null::regclass,
  'unused legacy transactions table is absent');
select extensions.is(to_regclass('public.portfolio_snapshots'), null::regclass,
  'unused legacy portfolio snapshots table is absent');
select extensions.is(to_regclass('public.daily_reports'), null::regclass,
  'unused legacy daily reports table is absent');
select extensions.is(to_regclass('public.rebalance_suggestions'), null::regclass,
  'unused legacy rebalance suggestions table is absent');

select * from extensions.finish();
rollback;
