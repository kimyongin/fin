-- The completed event keeps its task_id. Future tasks no longer point back to
-- arbitrary activity events; existing task rows remain intact.
create or replace function public.app_get_activity_without_tags(
    input_activity_id bigint,
    input_owner_user_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
    selected_owner uuid := coalesce(input_owner_user_id, auth.uid());
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    if selected_owner is null then raise exception 'Owner is required'; end if;
    if selected_owner <> auth.uid() and not public.can_view_feature(selected_owner, 'activity') then return null; end if;

    return (
        select jsonb_build_object(
            'id', event.id,
            'version', event.version,
            'record_kind', event.record_kind,
            'title', event.title,
            'note', event.note,
            'result', event.result,
            'conclusion', event.conclusion,
            'instrument_id', event.instrument_id,
            'account_id', event.account_id,
            'source', event.source,
            'action_type', event.action_type,
            'target_table', event.target_table,
            'target_id', event.target_id,
            'task_id', event.task_id,
            'before_data', event.before_data,
            'after_data', event.after_data,
            'occurred_at', event.occurred_at,
            'occurrence_on', event.occurrence_on,
            'created_at', event.created_at,
            'updated_at', event.updated_at,
            'editable_fields', case
                when selected_owner <> auth.uid() then '[]'::jsonb
                when event.action_type = 'record_manual_activity'
                    then jsonb_build_array('title', 'note', 'result', 'conclusion', 'occurred_at', 'instrument_id', 'account_id', 'record_kind', 'context')
                when event.action_type = 'complete_general_task'
                    then jsonb_build_array('title', 'note', 'result', 'conclusion', 'occurred_at', 'instrument_id', 'account_id')
                else jsonb_build_array('note')
            end,
            'origin_task', case
                when event.task_id is null or
                     (selected_owner <> auth.uid() and not public.can_view_feature(selected_owner, 'tasks'))
                then null
                else (
                    select jsonb_build_object(
                        'id', task.id,
                        'title', task.title,
                        'kind', task.kind,
                        'trigger_text', task.trigger_text,
                        'due_date', task.due_date,
                        'recurrence_kind', task.recurrence_kind,
                        'recurrence_start_on', task.recurrence_start_on
                    )
                    from public.portfolio_tasks task
                    where task.user_id = event.user_id and task.id = event.task_id
                )
            end
        )
        from public.activity_events event
        where event.id = input_activity_id
          and event.user_id = selected_owner
          and event.status = 'succeeded'
          and (selected_owner = auth.uid() or event.record_kind not in
               ('research', 'review', 'decision', 'retrospective', 'trade', 'reconciliation'))
    );
end;
$$;

drop function if exists public.app_create_activity_follow_up(bigint, uuid, jsonb);
drop index if exists public.portfolio_tasks_origin_event_idx;
alter table public.portfolio_tasks drop column if exists origin_event_id;
