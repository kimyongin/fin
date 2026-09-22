-- Allow an owner to correct the category and source context of a manual activity
-- in place. Financial and task-generated classifications stay protected.
create or replace function public.app_update_activity(
    input_activity_id bigint,
    input_expected_version integer,
    input_idempotency_key uuid,
    input_patch jsonb,
    input_authored_via text default 'agent'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    current_event public.activity_events%rowtype;
    stored_receipt public.activity_mutation_receipts%rowtype;
    allowed_fields text[];
    supplied_field text;
    next_title text;
    next_note text;
    next_result text;
    next_conclusion text;
    next_occurred_at timestamptz;
    next_occurrence_on date;
    next_instrument_id bigint;
    next_account_id bigint;
    normalized_timezone text;
    next_after_data jsonb;
    next_kind text;
    next_context jsonb;
    source_item jsonb;
    request_payload jsonb;
    response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_expected_version is null or input_expected_version < 1 then raise exception 'Expected version is required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if coalesce(jsonb_typeof(input_patch), 'null') <> 'object' then raise exception 'Activity patch must be an object'; end if;
    if input_authored_via not in ('app', 'agent') then raise exception 'Invalid authored_via'; end if;

    request_payload := jsonb_build_object('activity_id', input_activity_id, 'expected_version', input_expected_version, 'patch', input_patch, 'authored_via', input_authored_via);
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':update_activity:' || input_idempotency_key::text, 0));
    select * into stored_receipt from public.activity_mutation_receipts
    where user_id = current_user_id and operation = 'update_activity' and idempotency_key = input_idempotency_key;
    if found then
        if stored_receipt.request_payload <> request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
        return stored_receipt.response_payload;
    end if;

    select * into current_event from public.activity_events event
    where event.id = input_activity_id and event.user_id = current_user_id and event.status = 'succeeded'
    for update;
    if not found then raise exception 'Activity was not found'; end if;
    if current_event.version <> input_expected_version then raise exception 'Activity version conflict'; end if;

    if current_event.action_type = 'record_manual_activity' then
        allowed_fields := array['title', 'note', 'result', 'conclusion', 'occurred_at', 'timezone', 'instrument_id', 'account_id', 'record_kind', 'context'];
    elsif current_event.action_type = 'complete_general_task' then
        allowed_fields := array['title', 'note', 'result', 'conclusion', 'occurred_at', 'timezone', 'instrument_id', 'account_id'];
    else
        allowed_fields := array['note'];
    end if;
    for supplied_field in select jsonb_object_keys(input_patch) loop
        if not (supplied_field = any(allowed_fields)) then raise exception 'Activity field is protected: %', supplied_field; end if;
    end loop;
    if input_patch = '{}'::jsonb then raise exception 'Activity patch is empty'; end if;

    next_title := case when input_patch ? 'title' then nullif(trim(coalesce(input_patch ->> 'title', '')), '') else current_event.title end;
    next_note := case when input_patch ? 'note' then nullif(trim(coalesce(input_patch ->> 'note', '')), '') else current_event.note end;
    next_result := case when input_patch ? 'result' then nullif(trim(coalesce(input_patch ->> 'result', '')), '') else current_event.result end;
    next_conclusion := case when input_patch ? 'conclusion' then nullif(trim(coalesce(input_patch ->> 'conclusion', '')), '') else current_event.conclusion end;
    next_occurred_at := case when input_patch ? 'occurred_at' then (input_patch ->> 'occurred_at')::timestamptz else current_event.occurred_at end;
    normalized_timezone := trim(coalesce(input_patch ->> 'timezone', 'Asia/Seoul'));
    next_instrument_id := case when input_patch ? 'instrument_id' then nullif(input_patch ->> 'instrument_id', '')::bigint else current_event.instrument_id end;
    next_account_id := case when input_patch ? 'account_id' then nullif(input_patch ->> 'account_id', '')::bigint else current_event.account_id end;
    next_occurrence_on := case when input_patch ? 'occurred_at' then (next_occurred_at at time zone normalized_timezone)::date else current_event.occurrence_on end;
    next_kind := case when input_patch ? 'record_kind' then lower(trim(coalesce(input_patch ->> 'record_kind',''))) else current_event.record_kind end;
    next_context := case when input_patch ? 'context' then input_patch -> 'context' else current_event.after_data -> 'context' end;

    if current_event.action_type in ('record_manual_activity', 'complete_general_task')
       and (next_title is null or char_length(next_title) > 500) then
        raise exception 'Activity title is required and must be at most 500 characters';
    end if;
    if next_kind not in ('general','research','review','decision','retrospective','trade','reconciliation','task') then raise exception 'Invalid activity category'; end if;
    if next_context is not null and jsonb_typeof(next_context) not in ('object','null') then raise exception 'Activity context must be an object'; end if;
    if next_context is not null and octet_length(next_context::text)>10000 then raise exception 'Activity context is too large'; end if;
    if next_context ? 'sources' then
      if jsonb_typeof(next_context->'sources') <> 'array' or jsonb_array_length(next_context->'sources')>20 then raise exception 'Activity sources must be an array of at most 20'; end if;
      for source_item in select value from jsonb_array_elements(next_context->'sources') loop
        if jsonb_typeof(source_item)<>'object' or char_length(trim(coalesce(source_item->>'title',''))) not between 1 and 300
           or char_length(coalesce(source_item->>'url','')) not between 8 and 2000
           or (source_item->>'url') !~* '^https?://' then raise exception 'Invalid activity source'; end if;
      end loop;
    end if;
    if next_note is not null and char_length(next_note) > 4000 then raise exception 'Activity note is too long'; end if;
    if next_result is not null and char_length(next_result) > 4000 then raise exception 'Activity result is too long'; end if;
    if next_conclusion is not null and char_length(next_conclusion) > 4000 then raise exception 'Activity conclusion is too long'; end if;
    if next_occurred_at > clock_timestamp() + interval '5 minutes' then raise exception 'Activity cannot be in the future'; end if;
    if input_patch ? 'timezone' and not exists (select 1 from pg_timezone_names where name = normalized_timezone) then raise exception 'Invalid timezone'; end if;
    if next_instrument_id is not null and not exists (
        select 1 from public.instruments instrument where instrument.id = next_instrument_id and instrument.user_id = current_user_id
    ) then raise exception 'Instrument was not found'; end if;
    if next_account_id is not null and not exists (
        select 1 from public.accounts account where account.id = next_account_id and account.user_id = current_user_id
    ) then raise exception 'Account was not found'; end if;

    next_after_data := coalesce(current_event.after_data, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'title', next_title, 'note', next_note, 'result', next_result, 'conclusion', next_conclusion
    ));
    if next_note is null then next_after_data := next_after_data - 'note'; end if;
    if next_result is null then next_after_data := next_after_data - 'result'; end if;
    if next_conclusion is null then next_after_data := next_after_data - 'conclusion'; end if;
    if input_patch ? 'context' then
      if next_context is null or jsonb_typeof(next_context)='null' then next_after_data := next_after_data - 'context';
      else next_after_data := jsonb_set(next_after_data,'{context}',next_context,true); end if;
    end if;

    update public.activity_events
    set title = next_title,
        note = next_note,
        result = next_result,
        conclusion = next_conclusion,
        occurred_at = next_occurred_at,
        occurrence_on = next_occurrence_on,
        instrument_id = next_instrument_id,
        account_id = next_account_id,
        after_data = next_after_data,
        record_kind = next_kind,
        version = version + 1,
        updated_at = clock_timestamp()
    where id = current_event.id and user_id = current_user_id;

    response_payload := public.app_get_activity(current_event.id, null);
    insert into public.activity_mutation_receipts(user_id, operation, idempotency_key, request_payload, response_payload)
    values(current_user_id, 'update_activity', input_idempotency_key, request_payload, response_payload);
    return response_payload;
end;
$$;

CREATE OR REPLACE FUNCTION public.app_get_activity_without_tags(input_activity_id bigint, input_owner_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    selected_owner uuid := coalesce(input_owner_user_id, auth.uid());
    activity_allowed boolean;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    if selected_owner is null then raise exception 'Owner is required'; end if;
    activity_allowed := selected_owner = auth.uid() or public.can_view_feature(selected_owner, 'activity');
    if not activity_allowed then return null; end if;

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
            'origin_task', case when event.task_id is null then null else (
                select jsonb_build_object('id', task.id, 'title', task.title, 'kind', task.kind)
                from public.portfolio_tasks task
                where task.user_id = event.user_id and task.id = event.task_id
            ) end,
            'follow_up_tasks', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'id', task.id, 'title', task.title, 'kind', task.kind,
                    'due_date', task.due_date, 'control_state', task.control_state,
                    'created_at', task.created_at, 'updated_at', task.updated_at
                ) order by task.created_at, task.id)
                from public.portfolio_tasks task
                where task.user_id = event.user_id and task.origin_event_id = event.id
            ), '[]'::jsonb)
        )
        from public.activity_events event
        where event.id = input_activity_id
          and event.user_id = selected_owner
          and event.status = 'succeeded'
          and (selected_owner=auth.uid() or event.record_kind not in ('research','review','decision','retrospective'))
    );
end;
$function$;
