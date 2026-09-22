alter table public.activity_events
    add column title text,
    add column note text,
    add column result text,
    add column conclusion text,
    add column instrument_id bigint,
    add column account_id bigint,
    add column version integer not null default 1,
    add column updated_at timestamptz;

update public.activity_events
set title = nullif(trim(coalesce(after_data ->> 'title', after_data ->> 'question', '')), ''),
    note = nullif(trim(coalesce(after_data ->> 'note', '')), ''),
    result = nullif(trim(coalesce(after_data ->> 'result', after_data ->> 'answer', '')), ''),
    conclusion = nullif(trim(coalesce(after_data ->> 'conclusion', after_data ->> 'selected_option', after_data ->> 'reason', '')), ''),
    updated_at = created_at;

alter table public.activity_events
    alter column updated_at set default clock_timestamp(),
    alter column updated_at set not null,
    add constraint activity_events_version_check check (version > 0),
    add constraint activity_events_title_check check (title is null or char_length(trim(title)) between 1 and 500),
    add constraint activity_events_note_check check (note is null or char_length(note) <= 4000),
    add constraint activity_events_result_check check (result is null or char_length(result) <= 4000),
    add constraint activity_events_conclusion_check check (conclusion is null or char_length(conclusion) <= 4000),
    add constraint activity_events_user_id_id_key unique (user_id, id);

alter table public.portfolio_tasks
    add column origin_event_id bigint,
    add constraint portfolio_tasks_origin_event_fk
        foreign key (user_id, origin_event_id)
        references public.activity_events(user_id, id) on delete restrict;

create index activity_events_user_updated_idx
    on public.activity_events(user_id, updated_at desc, id desc);
create index portfolio_tasks_origin_event_idx
    on public.portfolio_tasks(user_id, origin_event_id)
    where origin_event_id is not null;

create table public.activity_mutation_receipts (
    user_id uuid not null references auth.users(id) on delete cascade,
    operation text not null,
    idempotency_key uuid not null,
    request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
    response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
    created_at timestamptz not null default clock_timestamp(),
    primary key (user_id, operation, idempotency_key)
);

alter table public.activity_mutation_receipts enable row level security;
create policy activity_mutation_receipts_select_own
    on public.activity_mutation_receipts for select to authenticated
    using ((select auth.uid()) = user_id);
revoke all on public.activity_mutation_receipts from public, anon, authenticated;
grant select on public.activity_mutation_receipts to authenticated;

create or replace function public.set_activity_current_content()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.title := coalesce(new.title, nullif(trim(coalesce(new.after_data ->> 'title', new.after_data ->> 'question', '')), ''));
    new.note := coalesce(new.note, nullif(trim(coalesce(new.after_data ->> 'note', '')), ''));
    new.result := coalesce(new.result, nullif(trim(coalesce(new.after_data ->> 'result', new.after_data ->> 'answer', '')), ''));
    new.conclusion := coalesce(new.conclusion, nullif(trim(coalesce(new.after_data ->> 'conclusion', new.after_data ->> 'selected_option', new.after_data ->> 'reason', '')), ''));
    new.updated_at := coalesce(new.updated_at, new.created_at, clock_timestamp());
    return new;
end;
$$;

create trigger activity_events_set_current_content
before insert on public.activity_events
for each row execute function public.set_activity_current_content();

create or replace function public.app_get_activity(
    input_activity_id bigint,
    input_owner_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
                when event.action_type in ('record_manual_activity', 'complete_general_task')
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
    );
end;
$$;

create or replace function public.app_create_activity(
    input_idempotency_key uuid,
    input_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    stored_receipt public.activity_mutation_receipts%rowtype;
    normalized_title text;
    normalized_note text;
    normalized_result text;
    normalized_conclusion text;
    normalized_timezone text;
    authored_channel text;
    effective_at timestamptz;
    selected_instrument_id bigint;
    selected_account_id bigint;
    event_id bigint;
    request_payload jsonb;
    response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if coalesce(jsonb_typeof(input_payload), 'null') <> 'object' then raise exception 'Activity payload must be an object'; end if;

    normalized_title := trim(coalesce(input_payload ->> 'title', ''));
    normalized_note := nullif(trim(coalesce(input_payload ->> 'note', '')), '');
    normalized_result := nullif(trim(coalesce(input_payload ->> 'result', '')), '');
    normalized_conclusion := nullif(trim(coalesce(input_payload ->> 'conclusion', '')), '');
    normalized_timezone := trim(coalesce(input_payload ->> 'timezone', 'Asia/Seoul'));
    authored_channel := trim(coalesce(input_payload ->> 'authored_via', 'agent'));
    effective_at := coalesce(nullif(input_payload ->> 'occurred_at', '')::timestamptz, clock_timestamp());
    selected_instrument_id := nullif(input_payload ->> 'instrument_id', '')::bigint;
    selected_account_id := nullif(input_payload ->> 'account_id', '')::bigint;

    if char_length(normalized_title) not between 1 and 500 then raise exception 'Activity title is required and must be at most 500 characters'; end if;
    if normalized_note is not null and char_length(normalized_note) > 4000 then raise exception 'Activity note is too long'; end if;
    if normalized_result is not null and char_length(normalized_result) > 4000 then raise exception 'Activity result is too long'; end if;
    if normalized_conclusion is not null and char_length(normalized_conclusion) > 4000 then raise exception 'Activity conclusion is too long'; end if;
    if authored_channel not in ('app', 'agent') then raise exception 'Invalid authored_via'; end if;
    if not exists (select 1 from pg_timezone_names where name = normalized_timezone) then raise exception 'Invalid timezone'; end if;
    if effective_at > clock_timestamp() + interval '5 minutes' then raise exception 'Activity cannot be in the future'; end if;
    if selected_instrument_id is not null and not exists (
        select 1 from public.instruments instrument where instrument.id = selected_instrument_id and instrument.user_id = current_user_id
    ) then raise exception 'Instrument was not found'; end if;
    if selected_account_id is not null and not exists (
        select 1 from public.accounts account where account.id = selected_account_id and account.user_id = current_user_id
    ) then raise exception 'Account was not found'; end if;

    request_payload := jsonb_build_object('payload', input_payload);
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':create_activity:' || input_idempotency_key::text, 0));
    select * into stored_receipt from public.activity_mutation_receipts
    where user_id = current_user_id and operation = 'create_activity' and idempotency_key = input_idempotency_key;
    if found then
        if stored_receipt.request_payload <> request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
        return stored_receipt.response_payload;
    end if;

    insert into public.activity_events(
        user_id, source, action_type, target_table, after_data, status,
        occurred_at, occurrence_on, title, note, result, conclusion,
        instrument_id, account_id, updated_at
    ) values (
        current_user_id, case when authored_channel = 'app' then 'user' else 'agent' end,
        'record_manual_activity', 'manual_activities',
        jsonb_strip_nulls(jsonb_build_object(
            'title', normalized_title, 'note', normalized_note, 'result', normalized_result,
            'conclusion', normalized_conclusion, 'reported', true
        )), 'succeeded', effective_at, (effective_at at time zone normalized_timezone)::date,
        normalized_title, normalized_note, normalized_result, normalized_conclusion,
        selected_instrument_id, selected_account_id, clock_timestamp()
    ) returning id into event_id;

    response_payload := public.app_get_activity(event_id, null);
    insert into public.activity_mutation_receipts(user_id, operation, idempotency_key, request_payload, response_payload)
    values(current_user_id, 'create_activity', input_idempotency_key, request_payload, response_payload);
    return response_payload;
end;
$$;

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

    if current_event.action_type in ('record_manual_activity', 'complete_general_task') then
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

    if current_event.action_type in ('record_manual_activity', 'complete_general_task')
       and (next_title is null or char_length(next_title) > 500) then
        raise exception 'Activity title is required and must be at most 500 characters';
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
        version = version + 1,
        updated_at = clock_timestamp()
    where id = current_event.id and user_id = current_user_id;

    response_payload := public.app_get_activity(current_event.id, null);
    insert into public.activity_mutation_receipts(user_id, operation, idempotency_key, request_payload, response_payload)
    values(current_user_id, 'update_activity', input_idempotency_key, request_payload, response_payload);
    return response_payload;
end;
$$;

create or replace function public.app_create_activity_follow_up(
    input_origin_event_id bigint,
    input_idempotency_key uuid,
    input_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    saved_task jsonb;
    task_id uuid;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if not exists (
        select 1 from public.activity_events event
        where event.id = input_origin_event_id and event.user_id = current_user_id and event.status = 'succeeded'
    ) then raise exception 'Origin activity was not found'; end if;

    saved_task := public.app_save_general_task(null, null, input_idempotency_key, input_payload);
    task_id := (saved_task ->> 'id')::uuid;
    update public.portfolio_tasks
    set origin_event_id = input_origin_event_id
    where id = task_id and user_id = current_user_id
      and (origin_event_id is null or origin_event_id = input_origin_event_id);
    if not found then raise exception 'Follow-up task origin conflict'; end if;
    return saved_task || jsonb_build_object('origin_event_id', input_origin_event_id);
end;
$$;

revoke all on function public.app_get_activity(bigint, uuid) from public, anon;
revoke all on function public.app_create_activity(uuid, jsonb) from public, anon;
revoke all on function public.app_update_activity(bigint, integer, uuid, jsonb, text) from public, anon;
revoke all on function public.app_create_activity_follow_up(bigint, uuid, jsonb) from public, anon;
grant execute on function public.app_get_activity(bigint, uuid) to authenticated;
grant execute on function public.app_create_activity(uuid, jsonb) to authenticated;
grant execute on function public.app_update_activity(bigint, integer, uuid, jsonb, text) to authenticated;
grant execute on function public.app_create_activity_follow_up(bigint, uuid, jsonb) to authenticated;

create or replace function public.app_list_action_timeline(
    input_owner_user_id uuid default null,
    input_filter text default 'all',
    input_from date default null,
    input_to date default null,
    input_limit integer default 30,
    input_cursor jsonb default null,
    input_timezone text default 'Asia/Seoul'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
    selected_owner uuid := coalesce(input_owner_user_id, auth.uid());
    normalized_filter text := lower(trim(coalesce(input_filter, 'all')));
    page_limit integer := greatest(1, least(coalesce(input_limit, 30), 100));
    cursor_occurred_at timestamptz;
    cursor_id bigint;
    tasks_allowed boolean;
    activity_allowed boolean;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    if selected_owner is null then raise exception 'Owner is required'; end if;
    if normalized_filter not in ('all','pending','done') then raise exception 'Invalid action timeline filter'; end if;
    if input_from is not null and input_to is not null and input_from > input_to then raise exception 'Invalid action timeline date range'; end if;
    if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
    if input_cursor is not null then
        if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'occurred_at') or not(input_cursor?'id') then
            raise exception 'Invalid action timeline cursor';
        end if;
        begin
            cursor_occurred_at := (input_cursor->>'occurred_at')::timestamptz;
            cursor_id := (input_cursor->>'id')::bigint;
        exception when others then
            raise exception 'Invalid action timeline cursor';
        end;
    end if;

    tasks_allowed := selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks');
    activity_allowed := selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity');

    return (
      with pending_rows as (
        select task.id,task.kind,task.version,task.title,task.subject,task.due_date,task.timezone,
          task.trigger_text,task.control_state,task.research_state,task.recurrence_kind,
          task.recurrence_start_on,task.origin_event_id,
          case when task.kind='general' and task.recurrence_kind='daily'
            then (clock_timestamp() at time zone task.timezone)::date else null end occurrence_on,
          case
            when task.kind='general' then case
              when task.recurrence_kind='daily' and (clock_timestamp() at time zone task.timezone)::date<task.recurrence_start_on then 'not_scheduled'
              else coalesce(occurrence.status,'open') end
            when task.kind='research' then task.research_state
            when task.kind='execution' then case
              when coalesce(fills.filled_quantity,0)=0 then 'planned'
              when coalesce(fills.filled_quantity,0)<plan.target_quantity then 'partial'
              else 'completed' end
          end status,
          case when task.kind='execution' then jsonb_build_object(
            'side',plan.side,'target_quantity',plan.target_quantity,
            'filled_quantity',coalesce(fills.filled_quantity,0),
            'remaining_quantity',greatest(plan.target_quantity-coalesce(fills.filled_quantity,0),0)
          ) else null end execution_plan,
          task.created_at,task.updated_at
        from public.portfolio_tasks task
        left join public.execution_plans plan on plan.user_id=task.user_id and plan.task_id=task.id
        left join lateral (
          select sum(entry.quantity) filled_quantity
          from public.task_fill_links link
          join public.trade_entries entry on entry.user_id=link.user_id and entry.id=link.trade_entry_id
          where link.user_id=task.user_id and link.task_id=task.id and entry.reversed_at is null
        ) fills on true
        left join public.general_task_occurrence_states occurrence
          on occurrence.user_id=task.user_id and occurrence.task_id=task.id
         and occurrence.occurrence_key=case when task.recurrence_kind='daily'
           then (clock_timestamp() at time zone task.timezone)::date else date '0001-01-01' end
        where tasks_allowed and normalized_filter in ('all','pending')
          and task.user_id=selected_owner and task.control_state='active'
          and (
            (task.kind='general' and coalesce(occurrence.status,'open')='open')
            or (task.kind='research' and task.research_state in ('open','waiting'))
            or (task.kind='execution' and coalesce(fills.filled_quantity,0)<plan.target_quantity)
          )
      ),
      eligible_events as (
        select event.id,event.version,event.title,event.note,event.result,event.conclusion,
          event.instrument_id,event.account_id,event.source,event.action_type,event.natural_language_request,
          event.target_table,event.target_id,event.task_id,event.before_data,event.after_data,
          event.status,event.error_message,event.occurred_at,event.occurrence_on,event.created_at,event.updated_at,
          case when selected_owner=auth.uid() and event.action_type in ('record_manual_activity','complete_general_task')
            then jsonb_build_array('title','note','result','conclusion','occurred_at','instrument_id','account_id')
            when selected_owner=auth.uid() then jsonb_build_array('note') else '[]'::jsonb end editable_fields,
          coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date) display_date,
          case
            when event.action_type in ('complete_general_task','transition_portfolio_task','transition_execution_task') then '완료'
            when event.action_type in ('confirm_trade_entry','record_trade_entry') then coalesce(event.after_data->>'side','매매')
            when event.action_type in ('verify_holding','reconcile_holding') then '확인'
            when event.action_type='record_manual_activity' then '활동'
            else '변경'
          end category
        from public.activity_events event
        where activity_allowed and normalized_filter in ('all','done')
          and event.user_id=selected_owner and event.status='succeeded'
          and event.action_type not in ('create_general_task','update_general_task')
          and (tasks_allowed or event.task_id is null)
          and (input_from is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)>=input_from)
          and (input_to is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)<=input_to)
          and (cursor_occurred_at is null or (event.occurred_at,event.id)<(cursor_occurred_at,cursor_id))
      ),
      bounded_events as (
        select * from eligible_events order by occurred_at desc,id desc limit page_limit+1
      ),
      event_page as (
        select * from bounded_events order by occurred_at desc,id desc limit page_limit
      ),
      event_days as (
        select display_date,count(*)::integer item_count,
          jsonb_object_agg(category,category_count order by category) counts,
          jsonb_agg(to_jsonb(item)-'display_date'-'category_count' order by occurred_at desc,id desc) items
        from (
          select page.*,count(*) over(partition by display_date,category)::integer category_count
          from event_page page
        ) item
        group by display_date
      )
      select jsonb_build_object(
        'pending',coalesce((select jsonb_agg(to_jsonb(item) order by item.due_date nulls last,item.updated_at desc,item.id desc) from pending_rows item),'[]'::jsonb),
        'days',coalesce((select jsonb_agg(jsonb_build_object('date',day.display_date,'item_count',day.item_count,'counts',day.counts,'items',day.items) order by day.display_date desc) from event_days day),'[]'::jsonb),
        'next_cursor',case when (select count(*) from bounded_events)>page_limit then (
          select jsonb_build_object('occurred_at',item.occurred_at,'id',item.id)
          from event_page item order by item.occurred_at,item.id limit 1
        ) else null end
      )
    );
end;
$$;
