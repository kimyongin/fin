-- Activity detail exposes a common instrument link and an optional task link.
-- Account-specific financial facts remain in the event's readable body.
create or replace function public.app_get_activity_without_tags(
  input_activity_id bigint,input_owner_user_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
  owns boolean:=selected_owner=auth.uid();
  tasks_allowed boolean;
  assets_allowed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if selected_owner is null then raise exception 'Owner is required'; end if;
  if not owns and not public.can_view_feature(selected_owner,'activity') then return null; end if;
  tasks_allowed:=owns or public.can_view_feature(selected_owner,'tasks');
  assets_allowed:=owns or public.can_view_feature(selected_owner,'assets');
  return (select jsonb_build_object(
    'id',event.id,'version',case when owns then event.version end,
    'title',event.title,'body',event.body,'occurred_at',event.occurred_at,
    'occurrence_on',event.occurrence_on,'created_at',event.created_at,'updated_at',event.updated_at,
    'source',event.source,
    'instrument_id',case when assets_allowed then event.instrument_id end,
    'instrument_summary',case when not assets_allowed or event.instrument_id is null then null else
      (select jsonb_build_object('id',i.id,'display_name',i.display_name,'ticker',i.ticker)
       from public.instruments i where i.id=event.instrument_id and i.user_id=event.user_id) end,
    'task_id',case when tasks_allowed then event.task_id end,
    'origin_task',case when not tasks_allowed or event.task_id is null then null else
      (select jsonb_build_object('id',task.id,'title',task.title,'kind',task.kind,
        'trigger_text',task.trigger_text,'due_date',task.due_date,
        'recurrence_kind',task.recurrence_kind,'recurrence_start_on',task.recurrence_start_on)
       from public.portfolio_tasks task where task.id=event.task_id and task.user_id=event.user_id) end,
    'editable_fields',case when owns then jsonb_build_array('title','body','occurred_at','instrument_id','task_id') else '[]'::jsonb end,
    'action_type',case when owns then event.action_type end,
    'before_data',case when owns then event.before_data end,
    'after_data',case when owns then event.after_data end
  ) from public.activity_events event
  where event.id=input_activity_id and event.user_id=selected_owner and event.status='succeeded');
end;
$$;
