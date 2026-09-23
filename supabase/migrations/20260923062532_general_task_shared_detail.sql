-- Shared detail for the one remaining task concept. Friend DTO never exposes
-- mutation history or private activity payloads.
create function public.app_get_general_task_for_owner(input_owner_user_id uuid, input_task_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then null
    when input_owner_user_id = auth.uid() then public.app_get_general_task(input_task_id)
    when public.can_view_feature(input_owner_user_id, 'tasks') then (
      select jsonb_build_object(
        'id', task.id,
        'kind', task.kind,
        'version', task.version,
        'title', task.title,
        'subject', task.subject,
        'due_date', task.due_date,
        'timezone', task.timezone,
        'trigger_text', task.trigger_text,
        'control_state', task.control_state,
        'recurrence_kind', task.recurrence_kind,
        'recurrence_start_on', task.recurrence_start_on,
        'occurrence_on', case when task.recurrence_kind = 'daily'
          then (clock_timestamp() at time zone task.timezone)::date else null end,
        'status', case
          when task.control_state = 'cancelled' then 'cancelled'
          when task.recurrence_kind = 'daily'
            and (clock_timestamp() at time zone task.timezone)::date < task.recurrence_start_on then 'not_scheduled'
          else coalesce((select occurrence.status
            from public.general_task_occurrence_states occurrence
            where occurrence.user_id = task.user_id and occurrence.task_id = task.id
              and occurrence.occurrence_key = case when task.recurrence_kind = 'daily'
                then (clock_timestamp() at time zone task.timezone)::date else date '0001-01-01' end), 'open')
        end,
        'created_at', task.created_at,
        'updated_at', task.updated_at,
        'history', '[]'::jsonb,
        'events', '[]'::jsonb
      )
      from public.portfolio_tasks task
      where task.user_id = input_owner_user_id and task.id = input_task_id
        and task.kind = 'general'
    )
    else null
  end;
$$;

revoke all on function public.app_get_general_task_for_owner(uuid,uuid) from public, anon;
grant execute on function public.app_get_general_task_for_owner(uuid,uuid) to authenticated;
