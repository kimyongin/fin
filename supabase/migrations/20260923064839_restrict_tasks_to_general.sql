-- Obsolete research/execution task rows have no current UI/MCP reader. Keep
-- their already-recorded activity facts, but detach the retired task pointer.
update public.activity_events event
set task_id = null
where event.task_id is not null
  and exists (
    select 1 from public.portfolio_tasks task
    where task.user_id = event.user_id and task.id = event.task_id
      and task.kind <> 'general'
  );

delete from public.portfolio_tasks where kind <> 'general';

-- The old paused state is not a future scheduling mode. Current general-task
-- writers reject pause/resume and ended rows are represented as cancelled.
update public.portfolio_tasks set control_state = 'cancelled'
where kind = 'general' and control_state = 'paused';

alter table public.portfolio_tasks drop constraint portfolio_tasks_kind_check;
alter table public.portfolio_tasks add constraint portfolio_tasks_kind_check check (kind = 'general');
alter table public.portfolio_tasks drop constraint portfolio_tasks_kind_state_check;
alter table public.portfolio_tasks add constraint portfolio_tasks_kind_state_check check (research_state is null);
alter table public.portfolio_tasks drop constraint portfolio_tasks_control_state_check;
alter table public.portfolio_tasks add constraint portfolio_tasks_control_state_check check (control_state in ('active','cancelled'));
