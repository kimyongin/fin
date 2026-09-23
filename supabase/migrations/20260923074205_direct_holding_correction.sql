-- Estimate an absolute correction without creating a preview row.
create or replace function public.app_preview_holding_reconciliation(
    input_holding_id bigint,
    input_values jsonb,
    input_reason text,
    input_effective_on date,
    input_confirmed_fields text[] default '{}'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
    current_user_id uuid := auth.uid();
    current_holding public.holdings%rowtype;
    instrument public.instruments%rowtype;
    before_value jsonb;
    after_value jsonb;
    allowed_fields text[];
    field text;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if coalesce(jsonb_typeof(input_values),'null') <> 'object' then raise exception 'Reconciliation values must be an object'; end if;
    if exists(select 1 from jsonb_each(input_values) item
      where jsonb_typeof(item.value)<>'string'
        or (item.value#>>'{}') !~ '^(0|[1-9][0-9]*)([.][0-9]{1,16})?$')
      then raise exception 'Reconciliation values must be nonnegative decimal strings with at most 16 decimal places'; end if;
    if char_length(trim(coalesce(input_reason,''))) not between 1 and 1000 then raise exception 'Reconciliation reason is required'; end if;
    if input_effective_on is null or input_effective_on > current_date then raise exception 'Reconciliation date is required and cannot be in the future'; end if;
    select * into current_holding from public.holdings where id=input_holding_id and user_id=current_user_id;
    if not found then raise exception 'Holding was not found or is not accessible'; end if;
    select * into instrument from public.instruments where user_id=current_user_id and ticker=current_holding.ticker;
    if instrument.instrument_type='market' then
        allowed_fields := array['quantity','avg_price'];
        if not (input_values ? 'quantity') or not (input_values ? 'avg_price') then raise exception 'Market reconciliation requires quantity and avg_price'; end if;
        if (input_values->>'quantity')::numeric < 0 or (input_values->>'avg_price')::numeric < 0 then raise exception 'Reconciliation values cannot be negative'; end if;
        before_value := jsonb_build_object('quantity',current_holding.ledger_quantity::text,'avg_price',case when current_holding.ledger_quantity=0 then null else (current_holding.ledger_cost_pool/current_holding.ledger_quantity)::text end);
        after_value := jsonb_build_object('quantity',((input_values->>'quantity')::numeric)::text,'avg_price',case when (input_values->>'quantity')::numeric=0 then null else ((input_values->>'avg_price')::numeric)::text end);
    elsif instrument.instrument_type='valuation' then
        allowed_fields := array['purchase_amount','valuation_amount'];
        if not (input_values ? 'purchase_amount') or not (input_values ? 'valuation_amount') then raise exception 'Valuation reconciliation requires purchase_amount and valuation_amount'; end if;
        if (input_values->>'purchase_amount')::numeric < 0 or (input_values->>'valuation_amount')::numeric < 0 then raise exception 'Reconciliation values cannot be negative'; end if;
        before_value := jsonb_build_object('purchase_amount',current_holding.purchase_amount::text,'valuation_amount',current_holding.valuation_amount::text);
        after_value := jsonb_build_object('purchase_amount',((input_values->>'purchase_amount')::numeric)::text,'valuation_amount',((input_values->>'valuation_amount')::numeric)::text);
    elsif instrument.instrument_type='cash' then
        allowed_fields := array['valuation_amount'];
        if not (input_values ? 'valuation_amount') or (input_values->>'valuation_amount')::numeric < 0 then raise exception 'Cash reconciliation requires a nonnegative valuation_amount'; end if;
        before_value := jsonb_build_object('valuation_amount',current_holding.valuation_amount::text);
        after_value := jsonb_build_object('valuation_amount',((input_values->>'valuation_amount')::numeric)::text);
    else raise exception 'This instrument type does not support reconciliation'; end if;
    if exists(select 1 from jsonb_object_keys(input_values) key where not key=any(allowed_fields)) then raise exception 'Reconciliation contains an unsupported field'; end if;
    foreach field in array coalesce(input_confirmed_fields,'{}') loop
        if not field=any(allowed_fields) then raise exception 'Confirmed field is invalid for this holding type'; end if;
    end loop;
    return jsonb_build_object('holding_id',current_holding.id,'holding_state_version',current_holding.state_version,
      'instrument_id',instrument.id,'instrument_type',instrument.instrument_type,
      'before',before_value,'after',after_value,'confirmed_fields',coalesce(input_confirmed_fields,'{}'),
      'reason',trim(input_reason),'effective_on',input_effective_on);
end; $$;

-- The activity grant must not expose brokerage correction values/reasons.
create or replace function public.app_list_action_timeline(
    input_owner_user_id uuid default null,
    input_filter text default 'all',
    input_from date default null,
    input_to date default null,
    input_limit integer default 30,
    input_cursor jsonb default null,
    input_timezone text default 'Asia/Seoul'
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
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
          task.trigger_text,task.control_state,task.recurrence_kind,task.recurrence_start_on,
          case when task.recurrence_kind='daily' then (clock_timestamp() at time zone task.timezone)::date else null end occurrence_on,
          coalesce(occurrence.status,'open') status,task.created_at,task.updated_at
        from public.portfolio_tasks task
        left join public.general_task_occurrence_states occurrence
          on occurrence.user_id=task.user_id and occurrence.task_id=task.id
         and occurrence.occurrence_key=case when task.recurrence_kind='daily'
           then (clock_timestamp() at time zone task.timezone)::date else date '0001-01-01' end
        where tasks_allowed and normalized_filter in ('all','pending')
          and task.user_id=selected_owner and task.kind='general' and task.control_state='active'
          and (task.recurrence_kind<>'daily' or (clock_timestamp() at time zone task.timezone)::date>=task.recurrence_start_on)
          and coalesce(occurrence.status,'open')='open'
      ),
      eligible_events as (
        select event.id,event.source,event.action_type,event.natural_language_request,
          event.target_table,event.target_id,event.task_id,event.before_data,event.after_data,
          event.status,event.error_message,event.occurred_at,event.occurrence_on,event.created_at,
          coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date) display_date,
          case
            when event.action_type in ('complete_general_task','transition_portfolio_task','transition_execution_task') then '완료'
            when event.action_type in ('confirm_trade_entry','record_trade_entry') then coalesce(event.after_data->>'side','매매')
            when event.action_type in ('verify_holding','reconcile_holding') then '확인'
            when event.action_type='record_manual_activity' then '기록'
            else '수정'
          end category
        from public.activity_events event
        where activity_allowed and normalized_filter in ('all','done')
          and event.user_id=selected_owner and event.status='succeeded'
          and (selected_owner=auth.uid() or event.record_kind not in ('research','review','decision','retrospective','trade','reconciliation'))
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
        and coalesce(state.status,'open')='open'
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
        and (selected_owner=auth.uid() or event.record_kind not in ('research','review','decision','retrospective','trade','reconciliation'))
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
          and (selected_owner=auth.uid() or event.record_kind not in ('research','review','decision','retrospective','trade','reconciliation'))
    );
end;
$function$;

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
      and (ae.user_id = auth.uid() or ae.record_kind not in ('research','review','decision','retrospective','trade','reconciliation'))
    order by ae.created_at desc
    limit least(greatest(coalesce(limit_count, 20), 1), 100);
$$;

-- Recheck the current row while it is locked; the estimate is not a promise.
create function public.app_apply_holding_correction(
  input_holding_id bigint,input_values jsonb,input_reason text,
  input_effective_on date,input_confirmed_fields text[],
  input_expected_version bigint,input_idempotency_key uuid,
  input_authored_via text default 'app'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  holding public.holdings%rowtype;
  saved_holding public.holdings%rowtype;
  instrument public.instruments%rowtype;
  estimate jsonb;
  receipt public.holding_integrity_mutation_receipts%rowtype;
  request_payload jsonb;
  response_payload jsonb;
  verification_id uuid;
  activity_id bigint;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if input_authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
  if input_expected_version is null or input_expected_version<1 then raise exception 'Expected holding version is required'; end if;
  request_payload:=jsonb_build_object(
    'holding_id',input_holding_id,'values',input_values,'reason',trim(coalesce(input_reason,'')),
    'effective_on',input_effective_on,'confirmed_fields',coalesce(input_confirmed_fields,'{}'::text[]),
    'expected_version',input_expected_version,'authored_via',input_authored_via);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':reconcile:'||input_idempotency_key::text,0));
  select * into receipt from public.holding_integrity_mutation_receipts
    where user_id=owner_id and idempotency_key=input_idempotency_key;
  if found then
    if receipt.operation<>'reconcile' or receipt.request_payload<>request_payload
      then raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;
  select * into holding from public.holdings where id=input_holding_id and user_id=owner_id for update;
  if not found then raise exception 'Holding was not found or is not accessible'; end if;
  if holding.state_version<>input_expected_version then raise exception 'Holding version conflict'; end if;
  estimate:=public.app_preview_holding_reconciliation(
    input_holding_id,input_values,input_reason,input_effective_on,input_confirmed_fields);
  select * into instrument from public.instruments
    where id=(estimate->>'instrument_id')::bigint and user_id=owner_id;
  if instrument.instrument_type='market' then
    update public.holdings set
      ledger_quantity=(estimate#>>'{after,quantity}')::numeric,
      ledger_cost_pool=case when (estimate#>>'{after,quantity}')::numeric=0 then 0
        else (estimate#>>'{after,quantity}')::numeric*(estimate#>>'{after,avg_price}')::numeric end,
      ledger_checkpoint_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=holding.id and user_id=owner_id returning * into saved_holding;
  elsif instrument.instrument_type='valuation' then
    update public.holdings set
      purchase_amount=(estimate#>>'{after,purchase_amount}')::numeric,
      valuation_amount=(estimate#>>'{after,valuation_amount}')::numeric,
      ledger_checkpoint_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=holding.id and user_id=owner_id returning * into saved_holding;
  else
    update public.holdings set
      valuation_amount=(estimate#>>'{after,valuation_amount}')::numeric,
      ledger_checkpoint_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=holding.id and user_id=owner_id returning * into saved_holding;
  end if;
  if cardinality(coalesce(input_confirmed_fields,'{}'::text[]))>0 then
    insert into public.holding_verifications(
      user_id,holding_id,instrument_id,holding_state_version,verified_fields,
      value_snapshot,verified_on,note,source
    ) values (
      owner_id,holding.id,instrument.id,saved_holding.state_version,
      input_confirmed_fields,estimate->'after',input_effective_on,
      '보정과 함께 실제 잔고를 확인함','reconciliation'
    ) returning id into verification_id;
  end if;
  insert into public.activity_events(
    user_id,source,action_type,target_table,target_id,instrument_id,account_id,
    title,before_data,after_data,status,occurrence_on
  ) values (
    owner_id,case when input_authored_via='app' then 'user' else 'agent' end,
    'reconcile_holding','holdings',holding.id::text,instrument.id,holding.account_id,
    instrument.display_name||' 잔고 보정',estimate->'before',
    (estimate->'after')||jsonb_build_object('reason',trim(input_reason),
      'confirmed_fields',coalesce(input_confirmed_fields,'{}'::text[]),'effective_on',input_effective_on),
    'succeeded',input_effective_on
  ) returning id into activity_id;
  response_payload:=jsonb_build_object(
    'activity_id',activity_id,'holding_id',holding.id,'holding_state_version',saved_holding.state_version,
    'before',estimate->'before','after',estimate->'after','verification_id',verification_id);
  insert into public.holding_integrity_mutation_receipts
    (user_id,idempotency_key,operation,request_payload,response_payload)
  values(owner_id,input_idempotency_key,'reconcile',request_payload,response_payload);
  return response_payload;
end; $$;

revoke all on function public.app_apply_holding_correction(bigint,jsonb,text,date,text[],bigint,uuid,text) from public,anon;
grant execute on function public.app_apply_holding_correction(bigint,jsonb,text,date,text[],bigint,uuid,text) to authenticated;

create or replace function public.app_get_holding_integrity(input_holding_id bigint)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'holding_id',holding.id,'state_version',holding.state_version,
    'last_reconciliation',(
      select jsonb_build_object('id',event.id,'effective_on',event.occurrence_on,
        'reason',event.after_data->>'reason','created_at',event.created_at)
      from public.activity_events event
      where event.user_id=auth.uid() and event.target_table='holdings'
        and event.target_id=holding.id::text and event.action_type='reconcile_holding'
        and event.status='succeeded'
      order by event.created_at desc,event.id desc limit 1),
    'last_verification',(
      select jsonb_build_object('id',verification.id,'holding_state_version',verification.holding_state_version,
        'verified_fields',verification.verified_fields,'value_snapshot',verification.value_snapshot,
        'verified_on',verification.verified_on,'note',verification.note,'source',verification.source,
        'created_at',verification.created_at,
        'changed_since',verification.holding_state_version<>holding.state_version)
      from public.holding_verifications verification
      where verification.user_id=auth.uid() and verification.holding_id=holding.id
      order by verification.created_at desc,verification.id desc limit 1)
  ) from public.holdings holding where holding.id=input_holding_id and holding.user_id=auth.uid();
$$;
