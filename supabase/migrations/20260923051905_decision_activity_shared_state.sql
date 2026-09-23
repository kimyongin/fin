-- Preserve the existing decisions sharing grant without exposing private notes,
-- research scope, sources, or arbitrary activity context.
create or replace function public.app_list_narrative_activities(
    input_kind text,
    input_owner_user_id uuid default null,
    input_limit integer default 20,
    input_cursor jsonb default null
)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
    selected_owner uuid := coalesce(input_owner_user_id, auth.uid());
    feature_key text;
    page_limit integer := greatest(1, least(coalesce(input_limit, 20), 100));
    cursor_at timestamptz;
    cursor_id bigint;
    page_rows jsonb;
    next_cursor jsonb;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    if input_kind not in ('review', 'decision') then raise exception 'Invalid narrative activity kind'; end if;
    feature_key := case input_kind when 'review' then 'briefings' else 'decisions' end;
    if selected_owner <> auth.uid() and not public.can_view_feature(selected_owner, feature_key) then
        return jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null);
    end if;
    if input_cursor is not null then
        if jsonb_typeof(input_cursor) <> 'object' or not (input_cursor ? 'occurred_at' and input_cursor ? 'id') then
            raise exception 'Invalid narrative activity cursor';
        end if;
        begin
            cursor_at := (input_cursor->>'occurred_at')::timestamptz;
            cursor_id := (input_cursor->>'id')::bigint;
        exception when others then
            raise exception 'Invalid narrative activity cursor';
        end;
    end if;

    with selected as (
        select event.id, event.title, event.note, event.result, event.conclusion,
               event.occurred_at, event.updated_at, event.after_data->'context' as context
        from public.activity_events event
        where event.user_id = selected_owner
          and event.status = 'succeeded'
          and event.action_type = 'record_manual_activity'
          and event.record_kind = input_kind
          and (cursor_at is null or (event.occurred_at, event.id) < (cursor_at, cursor_id))
        order by event.occurred_at desc, event.id desc
        limit page_limit + 1
    ), numbered as (
        select selected.*, row_number() over (order by occurred_at desc, id desc) as position
        from selected
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', id, 'title', title, 'result', result, 'conclusion', conclusion,
             'occurred_at', occurred_at, 'updated_at', updated_at,
             'note', case when selected_owner = auth.uid() then note else null end,
             'context', case when selected_owner = auth.uid() then context else
               jsonb_strip_nulls(jsonb_build_object(
                 'status', case when context->>'status' in ('no_action','attention','insufficient_data') then context->>'status' end,
                 'coverage_status', case when context->>'coverage_status' in ('complete','partial','failed') then context->>'coverage_status' end,
                 'decision_state', case when context->>'decision_state' in ('proposed','adopted','dismissed') then context->>'decision_state' end
               )) end
           ) order by occurred_at desc, id desc) filter (where position <= page_limit), '[]'::jsonb),
           (select jsonb_build_object('occurred_at', occurred_at, 'id', id)
            from numbered where position = page_limit and exists (select 1 from numbered where position > page_limit))
    into page_rows, next_cursor
    from numbered;

    return jsonb_build_object('items', page_rows, 'next_cursor', next_cursor);
end;
$$;

revoke all on function public.app_list_narrative_activities(text,uuid,integer,jsonb) from public, anon;
grant execute on function public.app_list_narrative_activities(text,uuid,integer,jsonb) to authenticated;
