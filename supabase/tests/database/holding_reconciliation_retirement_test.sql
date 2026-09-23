begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(4);

select extensions.ok(to_regclass('public.holding_reconciliations') is null, 'old correction ledger is removed');
select extensions.ok(to_regclass('public.holding_reconciliation_previews') is null, 'stored correction previews are removed');
select extensions.ok(to_regprocedure('public.app_reconcile_holding(uuid,uuid,text)') is null, 'old preview confirmation is removed');
select extensions.ok(to_regprocedure('public.app_apply_holding_correction(bigint,jsonb,text,date,text[],bigint,uuid,text)') is not null, 'direct correction remains available');

select * from extensions.finish();
rollback;
