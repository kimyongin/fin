-- A manual narrative can be removed without deleting its event identity: follow-up
-- tasks and older report references retain their FK, while all searchable content
-- and embeddings disappear. Financial and task-completion events are not deletable.
alter table public.activity_events drop constraint activity_events_status_check;
alter table public.activity_events add constraint activity_events_status_check
    check (status in ('succeeded', 'failed', 'deleted'));

create or replace function public.app_delete_manual_activity(
    input_activity_id bigint,
    input_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    selected_event public.activity_events%rowtype;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    select * into selected_event
    from public.activity_events event
    where event.id = input_activity_id and event.user_id = current_user_id
    for update;
    if not found or selected_event.action_type <> 'record_manual_activity' then
        raise exception 'Manual activity was not found';
    end if;
    if selected_event.status = 'deleted' then
        return jsonb_build_object('id', input_activity_id, 'deleted', true);
    end if;
    if selected_event.status <> 'succeeded' then raise exception 'Manual activity was not found'; end if;
    if input_expected_version is null or selected_event.version <> input_expected_version then
        raise exception 'Activity version conflict';
    end if;

    delete from public.activity_embeddings embedding
    where embedding.user_id = current_user_id and embedding.activity_event_id = input_activity_id;
    delete from public.activity_event_tags relation
    where relation.user_id = current_user_id and relation.activity_event_id = input_activity_id;
    -- Keep used idempotency keys sealed so a delayed retry cannot recreate a
    -- deleted record, but remove the original request and cached narrative.
    update public.activity_mutation_receipts receipt set
        request_payload = jsonb_build_object('deleted_activity_id', input_activity_id),
        response_payload = jsonb_build_object('id', input_activity_id, 'deleted', true)
    where receipt.user_id = current_user_id
      and receipt.operation in ('create_activity', 'update_activity', 'set_activity_tags')
      and receipt.response_payload ->> 'id' = input_activity_id::text;
    update public.activity_events event set
        status = 'deleted',
        title = null, note = null, result = null, conclusion = null,
        natural_language_request = null,
        before_data = null, after_data = '{}'::jsonb,
        instrument_id = null, account_id = null,
        version = event.version + 1,
        updated_at = clock_timestamp()
    where event.id = input_activity_id and event.user_id = current_user_id;
    return jsonb_build_object('id', input_activity_id, 'deleted', true);
end;
$$;

revoke all on function public.app_delete_manual_activity(bigint, integer) from public, anon;
grant execute on function public.app_delete_manual_activity(bigint, integer) to authenticated;

-- This legacy feed previously included every status, unlike the newer search,
-- timeline and detail RPCs. Keep tombstones out of it as well.
create or replace function public.app_list_recent_activity(
    limit_count integer default 20,
    input_owner_user_id uuid default null
)
returns table(
    id bigint, source text, action_type text, natural_language_request text,
    target_table text, target_id text, before_data jsonb, after_data jsonb,
    status text, error_message text, created_at timestamptz
)
language sql
stable security definer
set search_path = public
as $$
    with requested_owner as (
        select coalesce(input_owner_user_id, auth.uid()) as user_id
    ), current_user_ctx as (
        select user_id from requested_owner where public.can_view_owner(user_id)
    )
    select ae.id, ae.source, ae.action_type, ae.natural_language_request,
           ae.target_table, ae.target_id, ae.before_data, ae.after_data,
           ae.status, ae.error_message, ae.created_at
    from public.activity_events ae
    join current_user_ctx ctx on ctx.user_id = ae.user_id
    where ae.status <> 'deleted'
      and (ae.user_id = auth.uid() or ae.record_kind not in ('research','review','decision','retrospective'))
    order by ae.created_at desc
    limit least(greatest(coalesce(limit_count, 20), 1), 100);
$$;
