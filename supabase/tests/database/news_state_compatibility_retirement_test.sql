begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(2);

select extensions.ok(to_regprocedure('public.app_get_news_state(uuid)') is null,
  'empty legacy news-state compatibility RPC is removed');
select extensions.ok(to_regprocedure('public.app_get_daily_context(text,text[])') is not null,
  'current owner context read remains available without the news shim');

select * from extensions.finish();
rollback;
