begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(3);

select extensions.ok(to_regprocedure('public.app_save_asset_detail(bigint,jsonb,jsonb,jsonb,uuid)') is null,
  'legacy detail writer with private notes is retired');
select extensions.ok(to_regprocedure('public.app_save_asset_detail_current(bigint,jsonb,jsonb,jsonb,uuid,text)') is not null,
  'direct-current-value writer remains');
select extensions.ok(not exists(select 1 from information_schema.columns
  where table_schema='public' and table_name in ('instruments','holdings') and column_name='private_note'),
  'private instrument and holding note columns are removed');

select * from extensions.finish();
rollback;
