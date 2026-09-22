begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(3);
select case when exists(select 1 from public.portfolio_tasks where id='19740000-0000-4000-8000-000000000001')
  then extensions.is((select control_state from public.portfolio_tasks where id='19740000-0000-4000-8000-000000000001'),
    'cancelled','existing paused general task is ended')
  else extensions.pass('E2E-only pre-migration fixture is absent from ordinary local DB') end;
select case when exists(select 1 from public.portfolio_tasks where id='19740000-0000-4000-8000-000000000001')
  then extensions.is((select version from public.portfolio_tasks where id='19740000-0000-4000-8000-000000000001'),
    3,'mapping advances the task version for stale clients')
  else extensions.pass('E2E-only pre-migration fixture is absent from ordinary local DB') end;
select case when exists(select 1 from public.portfolio_tasks where id='19740000-0000-4000-8000-000000000001')
  then extensions.is((select count(*) from public.activity_events where task_id='19740000-0000-4000-8000-000000000001' and action_type='complete_general_task'),
    1::bigint,'previously performed work survives the mapping without a new completion')
  else extensions.pass('E2E-only pre-migration fixture is absent from ordinary local DB') end;
select * from extensions.finish();
rollback;
