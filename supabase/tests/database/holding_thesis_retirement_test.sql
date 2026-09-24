begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(9);

select extensions.ok(to_regclass('public.holding_theses') is null, 'parallel thesis table is removed');
select extensions.ok(to_regclass('public.holding_thesis_history') is null, 'parallel thesis history is removed');
select extensions.ok(to_regclass('public.holding_thesis_mutation_receipts') is null, 'parallel thesis receipts are removed');
select extensions.ok(to_regclass('public.holding_thesis_tasks') is null, 'parallel thesis task links are removed');
select extensions.ok(to_regclass('public.holding_thesis_task_receipts') is null, 'parallel thesis task receipts are removed');
select extensions.ok(to_regprocedure('public.app_save_holding_thesis(bigint,bigint,integer,uuid,jsonb,text,text)') is null,
    'parallel thesis write RPC is removed');
select extensions.ok(to_regprocedure('public.app_link_task_to_holding_thesis(uuid,uuid,integer,integer,uuid)') is null,
    'parallel thesis task-link RPC is removed');
select extensions.ok(not exists (
    select 1 from pg_trigger where tgname = 'deactivate_theses_after_position_close_trigger' and not tgisinternal
), 'position-close thesis trigger is removed');
select extensions.ok(to_regprocedure('public.app_list_private_holding_notes()') is null,
    'private holding-note read path is retired');

select * from extensions.finish();
rollback;
