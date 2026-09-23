begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(5);

select extensions.ok(to_regclass('public.trade_reversals') is null, 'reversal history table is removed');
select extensions.ok(to_regclass('public.trade_reversal_previews') is null, 'reversal preview table is removed');
select extensions.ok(to_regclass('public.trade_reversal_mutation_receipts') is null, 'reversal receipt table is removed');
select extensions.ok(to_regprocedure('public.app_reverse_trade_entry(uuid,uuid,text)') is null, 'reversal write RPC is removed');
select extensions.ok(to_regprocedure('public.app_preview_trade_reversal(uuid,text)') is null, 'reversal preview RPC is removed');

select * from extensions.finish();
rollback;
