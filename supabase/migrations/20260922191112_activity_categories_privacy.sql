-- A single activity source for manual research, reviews, decisions and
-- retrospective notes. Existing financial activities keep server classification.
alter table public.activity_events
    add column record_kind text not null default 'general'
    check (record_kind in ('general','research','review','decision','retrospective','trade','reconciliation','task'));

update public.activity_events
set record_kind=case
    when action_type in ('record_investment_decision','transition_investment_decision') then 'decision'
    when action_type in ('save_daily_briefing','create_daily_review','record_daily_review') then 'review'
    when action_type in ('save_news_fact','update_news_fact','record_news_fact') then 'research'
    when action_type in ('save_activity_report') then 'retrospective'
    when action_type in ('log_completed_trade','confirm_trade_entry','record_trade_entry','reverse_trade_entry') then 'trade'
    when action_type in ('reconcile_holding','verify_holding') then 'reconciliation'
    when action_type in ('complete_general_task','transition_portfolio_task') then 'task'
    else 'general' end;

create index activity_events_kind_time_idx
    on public.activity_events(user_id,record_kind,occurred_at desc,id desc);

create function public.app_classify_activity_kind()
returns trigger language plpgsql set search_path=public
as $$
begin
    if new.action_type='record_manual_activity' then
        if new.record_kind not in ('general','research','review','decision','retrospective') then
            raise exception 'Manual activity cannot claim a financial or task action';
        end if;
    else
        new.record_kind:=case
            when new.action_type in ('record_investment_decision','transition_investment_decision') then 'decision'
            when new.action_type in ('save_daily_briefing','create_daily_review','record_daily_review') then 'review'
            when new.action_type in ('save_news_fact','update_news_fact','record_news_fact') then 'research'
            when new.action_type='save_activity_report' then 'retrospective'
            when new.action_type in ('log_completed_trade','confirm_trade_entry','record_trade_entry','reverse_trade_entry') then 'trade'
            when new.action_type in ('reconcile_holding','verify_holding') then 'reconciliation'
            when new.action_type in ('complete_general_task','transition_portfolio_task') then 'task'
            else 'general' end;
    end if;
    return new;
end;
$$;
create trigger activity_events_classify_kind
before insert or update of action_type,record_kind on public.activity_events
for each row execute function public.app_classify_activity_kind();

-- The following existing read/write RPC bodies gain record_kind and a
-- pre-pagination friend filter. Owner access and public general/financial
-- activity behavior are unchanged. Internal helpers keep their old grants.
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
          and (selected_owner=auth.uid() or event.record_kind not in ('research','review','decision','retrospective'))
    );
end;
$function$;


CREATE OR REPLACE FUNCTION public.app_create_activity(input_idempotency_key uuid, input_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    current_user_id uuid := auth.uid();
    stored_receipt public.activity_mutation_receipts%rowtype;
    normalized_title text;
    normalized_kind text;
    record_context jsonb;
    source_item jsonb;
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
    normalized_kind := lower(trim(coalesce(input_payload ->> 'category', 'general')));
    record_context := input_payload -> 'context';
    normalized_note := nullif(trim(coalesce(input_payload ->> 'note', '')), '');
    normalized_result := nullif(trim(coalesce(input_payload ->> 'result', '')), '');
    normalized_conclusion := nullif(trim(coalesce(input_payload ->> 'conclusion', '')), '');
    normalized_timezone := trim(coalesce(input_payload ->> 'timezone', 'Asia/Seoul'));
    authored_channel := trim(coalesce(input_payload ->> 'authored_via', 'agent'));
    effective_at := coalesce(nullif(input_payload ->> 'occurred_at', '')::timestamptz, clock_timestamp());
    selected_instrument_id := nullif(input_payload ->> 'instrument_id', '')::bigint;
    selected_account_id := nullif(input_payload ->> 'account_id', '')::bigint;

    if normalized_kind not in ('general','research','review','decision','retrospective') then raise exception 'Invalid manual activity category'; end if;
    if record_context is not null and jsonb_typeof(record_context) not in ('object','null') then raise exception 'Activity context must be an object'; end if;
    if record_context is not null and octet_length(record_context::text)>10000 then raise exception 'Activity context is too large'; end if;
    if record_context ? 'sources' then
      if jsonb_typeof(record_context->'sources') <> 'array' or jsonb_array_length(record_context->'sources')>20 then raise exception 'Activity sources must be an array of at most 20'; end if;
      for source_item in select value from jsonb_array_elements(record_context->'sources') loop
        if jsonb_typeof(source_item)<>'object' or char_length(trim(coalesce(source_item->>'title',''))) not between 1 and 300
           or char_length(coalesce(source_item->>'url','')) not between 8 and 2000
           or (source_item->>'url') !~* '^https?://' then raise exception 'Invalid activity source'; end if;
      end loop;
    end if;
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
        instrument_id, account_id, updated_at, record_kind
    ) values (
        current_user_id, case when authored_channel = 'app' then 'user' else 'agent' end,
        'record_manual_activity', 'manual_activities',
        jsonb_strip_nulls(jsonb_build_object(
            'title', normalized_title, 'note', normalized_note, 'result', normalized_result,
            'conclusion', normalized_conclusion, 'reported', true, 'context', record_context
        )), 'succeeded', effective_at, (effective_at at time zone normalized_timezone)::date,
        normalized_title, normalized_note, normalized_result, normalized_conclusion,
        selected_instrument_id, selected_account_id, clock_timestamp(), normalized_kind
    ) returning id into event_id;

    response_payload := public.app_get_activity(event_id, null);
    insert into public.activity_mutation_receipts(user_id, operation, idempotency_key, request_payload, response_payload)
    values(current_user_id, 'create_activity', input_idempotency_key, request_payload, response_payload);
    return response_payload;
end;
$function$;


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
        select event.id,event.version,event.record_kind,event.title,event.note,event.result,event.conclusion,
          event.instrument_id,event.account_id,event.source,event.action_type,event.natural_language_request,
          event.target_table,event.target_id,event.task_id,event.before_data,event.after_data,
          event.status,event.error_message,event.occurred_at,event.occurrence_on,event.created_at,event.updated_at,
          case when selected_owner=auth.uid() and event.action_type in ('record_manual_activity','complete_general_task')
            then jsonb_build_array('title','note','result','conclusion','occurred_at','instrument_id','account_id')
            when selected_owner=auth.uid() then jsonb_build_array('note') else '[]'::jsonb end editable_fields,
          coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date) display_date,
          case
            when event.record_kind='research' then '조사'
            when event.record_kind='review' then '점검'
            when event.record_kind='decision' then '판단'
            when event.record_kind='retrospective' then '회고'
            when event.action_type in ('complete_general_task','transition_portfolio_task','transition_execution_task') then '완료'
            when event.action_type in ('confirm_trade_entry','record_trade_entry') then coalesce(event.after_data->>'side','매매')
            when event.action_type in ('verify_holding','reconcile_holding') then '확인'
            when event.action_type='record_manual_activity' then '활동'
            else '변경'
          end category
        from public.activity_events event
        where activity_allowed and normalized_filter in ('all','done')
          and event.user_id=selected_owner and event.status='succeeded'
          and (selected_owner=auth.uid() or event.record_kind not in ('research','review','decision','retrospective'))
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

CREATE OR REPLACE FUNCTION public.app_list_recent_activity(limit_count integer DEFAULT 20, input_owner_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id bigint, source text, action_type text, natural_language_request text, target_table text, target_id text, before_data jsonb, after_data jsonb, status text, error_message text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with requested_owner as (
        select coalesce(input_owner_user_id, auth.uid()) as user_id
    ),
    current_user_ctx as (
        select user_id
        from requested_owner
        where public.can_view_owner(user_id)
    )
    select
        ae.id,
        ae.source,
        ae.action_type,
        ae.natural_language_request,
        ae.target_table,
        ae.target_id,
        ae.before_data,
        ae.after_data,
        ae.status,
        ae.error_message,
        ae.created_at
    from public.activity_events ae
    join current_user_ctx ctx on ctx.user_id = ae.user_id
    where ae.user_id=auth.uid() or ae.record_kind not in ('research','review','decision','retrospective')
    order by ae.created_at desc
    limit least(greatest(coalesce(limit_count, 20), 1), 100);
$function$;


CREATE OR REPLACE FUNCTION public.app_search_activities(input_owner_user_id uuid DEFAULT NULL::uuid, input_query text DEFAULT NULL::text, input_from date DEFAULT NULL::date, input_to date DEFAULT NULL::date, input_record_state text DEFAULT 'all'::text, input_has_conclusion boolean DEFAULT NULL::boolean, input_instrument_id bigint DEFAULT NULL::bigint, input_account_id bigint DEFAULT NULL::bigint, input_tag_ids uuid[] DEFAULT NULL::uuid[], input_tag_match text DEFAULT 'all'::text, input_limit integer DEFAULT 30, input_cursor jsonb DEFAULT NULL::jsonb, input_timezone text DEFAULT 'Asia/Seoul'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
    normalized_query text:=nullif(lower(trim(coalesce(input_query,''))),'');
    normalized_state text:=lower(trim(coalesce(input_record_state,'all')));
    normalized_tag_match text:=lower(trim(coalesce(input_tag_match,'all')));
    selected_tag_ids uuid[]:=coalesce(input_tag_ids,array[]::uuid[]);
    page_limit integer:=greatest(1,least(coalesce(input_limit,30),100));
    cursor_sort_at timestamptz;
    cursor_key text;
    tasks_allowed boolean;
    activity_allowed boolean;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    if normalized_state not in ('all','todo','done') then raise exception 'Invalid activity record state'; end if;
    if normalized_tag_match not in ('all','any') then raise exception 'Invalid activity tag match'; end if;
    if input_from is not null and input_to is not null and input_from>input_to then raise exception 'Invalid activity search date range'; end if;
    if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
    if input_cursor is not null then
      if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'sort_at') or not(input_cursor?'key') then raise exception 'Invalid activity search cursor'; end if;
      begin cursor_sort_at:=(input_cursor->>'sort_at')::timestamptz; cursor_key:=input_cursor->>'key'; exception when others then raise exception 'Invalid activity search cursor'; end;
    end if;
    tasks_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks');
    activity_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity');
    return (with task_rows as (
      select 'todo'::text record_state,'task'::text record_type,task.id::text record_id,null::bigint activity_id,task.id task_id,
        task.title,null::text note,null::text result,null::text conclusion,null::text action_type,null::text record_kind,
        task.due_date,null::timestamptz occurred_at,task.created_at,task.updated_at,task.updated_at sort_at,'task:'||task.id::text record_key,
        task.version,task.subject,
        coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id) from public.portfolio_task_activity_tags relation join public.activity_tags tag on tag.user_id=relation.user_id and tag.id=relation.tag_id where relation.user_id=task.user_id and relation.task_id=task.id),'[]'::jsonb) tags
      from public.portfolio_tasks task
      left join public.general_task_occurrence_states state on state.user_id=task.user_id and state.task_id=task.id and state.occurrence_key=case when task.recurrence_kind='daily' then (clock_timestamp() at time zone task.timezone)::date else date '0001-01-01' end
      where tasks_allowed and normalized_state in ('all','todo') and task.user_id=selected_owner and task.control_state='active'
        and ((task.kind='general' and coalesce(state.status,'open')='open') or (task.kind='research' and task.research_state in ('open','waiting')) or task.kind='execution')
        and (input_from is null or task.due_date is null or task.due_date>=input_from)
        and (input_to is null or task.due_date is null or task.due_date<=input_to)
        and (input_has_conclusion is null or input_has_conclusion=false)
        and (input_instrument_id is null or (task.subject->>'instrument_id' ~ '^[0-9]+$' and (task.subject->>'instrument_id')::bigint=input_instrument_id))
        and (input_account_id is null or (task.subject->>'account_id' ~ '^[0-9]+$' and (task.subject->>'account_id')::bigint=input_account_id))
        and (normalized_query is null or strpos(lower(concat_ws(' ',task.title,task.trigger_text)),normalized_query)>0)
        and (cardinality(selected_tag_ids)=0 or case when normalized_tag_match='all' then
          (select count(distinct relation.tag_id) from public.portfolio_task_activity_tags relation where relation.user_id=task.user_id and relation.task_id=task.id and relation.tag_id=any(selected_tag_ids))=cardinality(selected_tag_ids)
          else exists(select 1 from public.portfolio_task_activity_tags relation where relation.user_id=task.user_id and relation.task_id=task.id and relation.tag_id=any(selected_tag_ids)) end)
    ), event_rows as (
      select 'done'::text record_state,'activity'::text record_type,event.id::text record_id,event.id activity_id,event.task_id,
        coalesce(event.title,event.after_data->>'title',event.after_data->>'question',event.action_type) title,event.note,event.result,event.conclusion,event.action_type,event.record_kind,
        null::date due_date,event.occurred_at,event.created_at,event.updated_at,event.occurred_at sort_at,'activity:'||event.id::text record_key,
        event.version,null::jsonb subject,
        coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id) from public.activity_event_tags relation join public.activity_tags tag on tag.user_id=relation.user_id and tag.id=relation.tag_id where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb) tags
      from public.activity_events event
      where activity_allowed and normalized_state in ('all','done') and event.user_id=selected_owner and event.status='succeeded'
        and (selected_owner=auth.uid() or event.record_kind not in ('research','review','decision','retrospective'))
        and event.action_type not in ('create_general_task','update_general_task') and (tasks_allowed or event.task_id is null)
        and (input_from is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)>=input_from)
        and (input_to is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)<=input_to)
        and (input_has_conclusion is null or (event.conclusion is not null)=input_has_conclusion)
        and (input_instrument_id is null or event.instrument_id=input_instrument_id)
        and (input_account_id is null or event.account_id=input_account_id)
        and (normalized_query is null or strpos(lower(concat_ws(' ',event.title,event.note,event.result,event.conclusion,event.after_data->>'question',event.after_data->>'selected_option')),normalized_query)>0)
        and (cardinality(selected_tag_ids)=0 or case when normalized_tag_match='all' then
          (select count(distinct relation.tag_id) from public.activity_event_tags relation where relation.user_id=event.user_id and relation.activity_event_id=event.id and relation.tag_id=any(selected_tag_ids))=cardinality(selected_tag_ids)
          else exists(select 1 from public.activity_event_tags relation where relation.user_id=event.user_id and relation.activity_event_id=event.id and relation.tag_id=any(selected_tag_ids)) end)
    ), combined as (
      select * from task_rows union all select * from event_rows
    ), bounded as (
      select * from combined where cursor_sort_at is null or (sort_at,record_key)<(cursor_sort_at,cursor_key)
      order by sort_at desc,record_key desc limit page_limit+1
    ), page as (select * from bounded order by sort_at desc,record_key desc limit page_limit)
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(to_jsonb(item)-'sort_at'-'record_key' order by sort_at desc,record_key desc) from page item),'[]'::jsonb),
      'next_cursor',case when (select count(*) from bounded)>page_limit then (select jsonb_build_object('sort_at',sort_at,'key',record_key) from page order by sort_at,record_key limit 1) else null end
    ));
end;
$function$;


CREATE OR REPLACE FUNCTION public.app_search_activity_semantic(input_query_embedding vector, input_owner_user_id uuid DEFAULT NULL::uuid, input_from date DEFAULT NULL::date, input_to date DEFAULT NULL::date, input_has_conclusion boolean DEFAULT NULL::boolean, input_instrument_id bigint DEFAULT NULL::bigint, input_account_id bigint DEFAULT NULL::bigint, input_tag_ids uuid[] DEFAULT NULL::uuid[], input_tag_match text DEFAULT 'all'::text, input_limit integer DEFAULT 30, input_timezone text DEFAULT 'Asia/Seoul'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
    selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
    selected_tag_ids uuid[]:=coalesce(input_tag_ids,array[]::uuid[]);
    normalized_tag_match text:=lower(trim(coalesce(input_tag_match,'all')));
    page_limit integer:=greatest(1,least(coalesce(input_limit,30),100));
    activity_allowed boolean;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    if normalized_tag_match not in ('all','any') then raise exception 'Invalid activity tag match'; end if;
    if input_from is not null and input_to is not null and input_from>input_to then raise exception 'Invalid activity search date range'; end if;
    if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
    activity_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity');
    if not activity_allowed then return jsonb_build_object('items','[]'::jsonb); end if;
    return jsonb_build_object('items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'record_state','done','record_type','activity','record_id',event.id::text,
        'activity_id',event.id,'task_id',event.task_id,'task_kind',null,
        'title',coalesce(event.title,event.after_data->>'title',event.after_data->>'question',event.action_type),
        'note',event.note,'result',event.result,'conclusion',event.conclusion,'action_type',event.action_type,'record_kind',event.record_kind,
        'occurred_at',event.occurred_at,'created_at',event.created_at,'updated_at',event.updated_at,'version',event.version,
        'tags',coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id) from public.activity_event_tags relation join public.activity_tags tag on tag.user_id=relation.user_id and tag.id=relation.tag_id where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb),
        'semantic_score',1-(event.embedding <=> input_query_embedding)
      ) order by event.embedding <=> input_query_embedding,event.occurred_at desc,event.id desc)
      from (
        select event.*,embedding.embedding
        from public.activity_events event
        join public.activity_embeddings embedding on embedding.user_id=event.user_id and embedding.activity_event_id=event.id
          and embedding.content_hash=public.activity_embedding_hash(event)
        where event.user_id=selected_owner and event.status='succeeded'
          and (selected_owner=auth.uid() or event.record_kind not in ('research','review','decision','retrospective'))
          and event.action_type not in ('create_general_task','update_general_task')
          and (input_from is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)>=input_from)
          and (input_to is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)<=input_to)
          and (input_has_conclusion is null or (event.conclusion is not null)=input_has_conclusion)
          and (input_instrument_id is null or event.instrument_id=input_instrument_id)
          and (input_account_id is null or event.account_id=input_account_id)
          and (cardinality(selected_tag_ids)=0 or case when normalized_tag_match='all' then
            (select count(distinct relation.tag_id) from public.activity_event_tags relation where relation.user_id=event.user_id and relation.activity_event_id=event.id and relation.tag_id=any(selected_tag_ids))=cardinality(selected_tag_ids)
            else exists(select 1 from public.activity_event_tags relation where relation.user_id=event.user_id and relation.activity_event_id=event.id and relation.tag_id=any(selected_tag_ids)) end)
        order by embedding.embedding <=> input_query_embedding,event.occurred_at desc,event.id desc
        limit page_limit
      ) event
    ),'[]'::jsonb));
end;
$function$;
