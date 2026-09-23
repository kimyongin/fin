begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(6);

select extensions.is(to_regclass('public.investment_policy_profiles'), null::regclass,
  'parallel policy profile storage is retired');
select extensions.is(to_regclass('public.investment_policy_history'), null::regclass,
  'parallel policy snapshot history is retired');
select extensions.is(to_regclass('public.investment_policy_mutation_receipts'), null::regclass,
  'parallel policy receipts are retired');
select extensions.is(to_regprocedure('public.app_get_investment_policy()'), null::regprocedure,
  'parallel policy read RPC is retired');
select extensions.is(to_regprocedure('public.app_save_investment_policy(integer,uuid,jsonb,text,text)'), null::regprocedure,
  'parallel policy write RPC is retired');
select extensions.ok(to_regprocedure('public.app_list_principles(date,text,boolean)') is not null,
  'current and as-of personal principles remain readable');

select * from extensions.finish();
rollback;
