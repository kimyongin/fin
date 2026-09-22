create or replace function public.app_list_todo_bundles(
    input_filter text default 'active', input_limit integer default 20, input_cursor jsonb default null
)
returns jsonb language sql stable security definer set search_path = public as $$
    with candidates as (
        select bundle.*, public.app_todo_bundle_status(bundle.id) as derived_status
        from public.todo_bundles bundle
        where bundle.user_id = auth.uid()
          and (input_cursor is null or (bundle.updated_at, bundle.id) < ((input_cursor ->> 'updated_at')::timestamptz, (input_cursor ->> 'id')::uuid))
    ), filtered as (
        select * from candidates
        where input_filter = 'all'
           or (input_filter = 'active' and derived_status in ('in_progress', 'paused'))
           or (input_filter = 'paused' and derived_status = 'paused')
           or (input_filter = 'completed' and derived_status = 'completed')
           or (input_filter = 'cancelled' and derived_status = 'cancelled')
        order by updated_at desc, id desc limit least(greatest(coalesce(input_limit, 20), 1), 100) + 1
    ), page as (select * from filtered limit least(greatest(coalesce(input_limit, 20), 1), 100))
    select jsonb_build_object(
        'items', coalesce((select jsonb_agg(jsonb_build_object(
            'id', id, 'title', title, 'summary', summary, 'tags', to_jsonb(tags), 'version', version,
            'status', derived_status, 'item_count', (select count(*) from public.todo_items item where item.bundle_id = page.id),
            'created_at', created_at, 'updated_at', updated_at
        ) order by updated_at desc, id desc) from page), '[]'::jsonb),
        'next_cursor', case when (select count(*) from filtered) > least(greatest(coalesce(input_limit, 20), 1), 100)
            then (select jsonb_build_object('updated_at', updated_at, 'id', id) from page order by updated_at, id limit 1)
            else null end
    );
$$;

create or replace function public.app_list_todo_linked_task_ids()
returns jsonb language sql stable security definer set search_path = public as $$
    select coalesce(jsonb_agg(item.task_id order by item.task_id), '[]'::jsonb)
    from public.todo_items item
    where item.user_id = auth.uid() and item.kind = 'task';
$$;

grant execute on function public.app_list_todo_linked_task_ids() to authenticated;
