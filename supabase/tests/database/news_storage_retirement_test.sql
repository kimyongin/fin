begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(8);

select extensions.is(to_regclass('public.news_facts'), null::regclass,
  'separate news facts table is retired');
select extensions.is(to_regclass('public.news_fact_annotations'), null::regclass,
  'separate news opinion table is retired');
select extensions.is(to_regprocedure('public.app_save_news_fact(date,text,text,text,text,text,text)'), null::regprocedure,
  'old fact writer is retired');
select extensions.is(to_regprocedure('public.app_save_news_fact_annotation(bigint,text,text)'), null::regprocedure,
  'old opinion writer is retired');
select extensions.is(to_regprocedure('public.mcp_save_news_record(text,text,text,text)'), null::regprocedure,
  'old token news writer is retired');
select extensions.is(to_regprocedure('public.mcp_get_news_state(text)'), null::regprocedure,
  'old token news reader is retired');
select extensions.ok(to_regprocedure('public.app_create_activity(uuid,jsonb)') is not null,
  'research activities remain available');
select extensions.ok(to_regprocedure('public.app_get_news_state(uuid)') is not null,
  'daily-context base retains its temporary empty reader');

select * from extensions.finish();
rollback;
