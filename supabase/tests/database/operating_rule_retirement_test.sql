begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(6);

select extensions.ok(to_regclass('public.operating_rules') is null, 'parallel operating-rule table is removed');
select extensions.ok(to_regclass('public.operating_rule_history') is null, 'parallel rule history is removed');
select extensions.ok(to_regclass('public.operating_rule_mutation_receipts') is null, 'parallel rule receipts are removed');
select extensions.ok(to_regprocedure('public.app_list_operating_rules(text,boolean)') is null,
    'parallel rule list RPC is removed');
select extensions.ok(to_regprocedure('public.app_save_operating_rule(uuid,integer,uuid,text,text,text,text,text,text)') is null,
    'parallel rule write RPC is removed');
select extensions.ok(to_regprocedure('public.app_list_principles(date,text,boolean)') is not null,
    'current principle read path remains');

select * from extensions.finish();
rollback;
