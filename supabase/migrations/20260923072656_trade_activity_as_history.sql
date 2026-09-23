-- The automatic activity is the performed trade fact; holdings are the current balance.
create or replace function public.app_record_completed_trade(
  input_account_id bigint, input_instrument_id bigint, input_side text,
  input_quantity numeric, input_unit_price numeric, input_executed_on date,
  input_expected_holding_id bigint, input_expected_version bigint,
  input_idempotency_key uuid, input_authored_via text default 'app'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  side text:=lower(trim(coalesce(input_side,'')));
  instrument public.instruments%rowtype;
  holding public.holdings%rowtype;
  saved_holding public.holdings%rowtype;
  saved_activity_id bigint;
  receipt public.trade_entry_mutation_receipts%rowtype;
  before_quantity numeric(38,16):=0;
  before_cost numeric(38,16):=0;
  after_quantity numeric(38,16);
  after_cost numeric(38,16);
  request_payload jsonb;
  response_payload jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if input_authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
  if side not in ('buy','sell') then raise exception 'Trade side must be buy or sell'; end if;
  if input_quantity is null or input_quantity<=0 or scale(input_quantity)>16 then raise exception 'Trade quantity must be positive with at most 16 decimal places'; end if;
  if input_unit_price is null or input_unit_price<=0 or scale(input_unit_price)>16 then raise exception 'Trade unit price must be positive with at most 16 decimal places'; end if;
  if input_executed_on is null or input_executed_on>current_date then raise exception 'Trade date is required and cannot be in the future'; end if;
  if input_expected_version is null or input_expected_version<0 then raise exception 'Expected holding version is required'; end if;
  request_payload:=jsonb_build_object(
    'account_id',input_account_id,'instrument_id',input_instrument_id,'side',side,
    'quantity',input_quantity::text,'unit_price',input_unit_price::text,'executed_on',input_executed_on,
    'expected_holding_id',input_expected_holding_id,'expected_version',input_expected_version,'authored_via',input_authored_via);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':log_trade:'||input_idempotency_key::text,0));
  select * into receipt from public.trade_entry_mutation_receipts
    where user_id=owner_id and idempotency_key=input_idempotency_key;
  if found then
    if receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;
  if not exists(select 1 from public.accounts where id=input_account_id and user_id=owner_id) then raise exception 'Account was not found or is not accessible'; end if;
  select * into instrument from public.instruments where id=input_instrument_id and user_id=owner_id;
  if not found then raise exception 'Instrument was not found or is not accessible'; end if;
  if instrument.instrument_type<>'market' then raise exception 'Only market instruments support trade entries'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    owner_id::text||':holding_stream:'||input_account_id::text||':'||input_instrument_id::text,0));
  select * into holding from public.holdings
    where user_id=owner_id and account_id=input_account_id and ticker=instrument.ticker for update;
  if found then
    if input_expected_holding_id is distinct from holding.id or input_expected_version<>holding.state_version
      then raise exception 'Trade estimate is stale; calculate it again'; end if;
    before_quantity:=holding.ledger_quantity;
    before_cost:=holding.ledger_cost_pool;
  elsif input_expected_holding_id is not null or input_expected_version<>0 then
    raise exception 'Trade estimate is stale; calculate it again';
  elsif side='sell' then
    raise exception 'Cannot sell an instrument that is not held in this account';
  end if;
  if side='buy' then
    after_quantity:=before_quantity+input_quantity;
    after_cost:=before_cost+input_quantity*input_unit_price;
  else
    if input_quantity>before_quantity then raise exception 'Trade would sell more than the current holding'; end if;
    after_quantity:=before_quantity-input_quantity;
    after_cost:=case when after_quantity=0 then 0 else before_cost*after_quantity/before_quantity end;
  end if;
  if holding.id is null then
    insert into public.holdings(user_id,account_id,ticker,quantity,avg_price,ledger_quantity,ledger_cost_pool)
    values(owner_id,input_account_id,instrument.ticker,after_quantity::real,(after_cost/after_quantity)::real,after_quantity,after_cost)
    returning * into saved_holding;
  else
    update public.holdings set ledger_quantity=after_quantity,ledger_cost_pool=after_cost,updated_at=clock_timestamp()
    where id=holding.id and user_id=owner_id returning * into saved_holding;
  end if;
  insert into public.activity_events(
    user_id,source,action_type,target_table,target_id,instrument_id,account_id,
    title,before_data,after_data,status,occurrence_on
  ) values (
    owner_id,case when input_authored_via='app' then 'user' else 'agent' end,
    'log_completed_trade','holdings',saved_holding.id::text,input_instrument_id,input_account_id,
    instrument.display_name||case when side='buy' then ' 매수' else ' 매도' end,
    jsonb_build_object('quantity',before_quantity::text,'avg_price',case when before_quantity=0 then null else (before_cost/before_quantity)::text end),
    jsonb_build_object('quantity',after_quantity::text,'avg_price',case when after_quantity=0 then null else (after_cost/after_quantity)::text end,
      'side',side,'trade_quantity',input_quantity::text,'unit_price',input_unit_price::text,'executed_on',input_executed_on,
      'account_id',input_account_id,'account_name',(select name from public.accounts where id=input_account_id and user_id=owner_id),
      'instrument_id',input_instrument_id,'instrument_name',instrument.display_name,'ticker',instrument.ticker),
    'succeeded',input_executed_on
  ) returning id into saved_activity_id;
  response_payload:=jsonb_build_object(
    'activity_id',saved_activity_id,'holding_id',saved_holding.id,'side',side,
    'quantity',input_quantity::text,'unit_price',input_unit_price::text,'executed_on',input_executed_on,
    'holding',jsonb_build_object('state_version',saved_holding.state_version,
      'quantity',saved_holding.ledger_quantity::text,
      'avg_price',case when saved_holding.ledger_quantity=0 then null else (saved_holding.ledger_cost_pool/saved_holding.ledger_quantity)::text end));
  insert into public.trade_entry_mutation_receipts(user_id,idempotency_key,request_payload,response_payload)
  values(owner_id,input_idempotency_key,request_payload,response_payload);
  return response_payload;
end; $$;

create or replace function public.app_list_transactions(
  input_limit integer default 50, input_before timestamptz default null
) returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc,item.id desc),'[]'::jsonb)
  from (
    select event.id::text id,event.account_id,
      coalesce(account.name,event.after_data->>'account_name') account_name,
      event.instrument_id,coalesce(instrument.ticker,event.after_data->>'ticker') ticker,
      coalesce(instrument.display_name,event.after_data->>'instrument_name') instrument_name,
      event.after_data->>'side' side,event.after_data->>'trade_quantity' quantity,
      event.after_data->>'unit_price' unit_price,event.after_data->>'executed_on' executed_on,
      event.before_data->>'quantity' before_quantity,event.after_data->>'quantity' after_quantity,
      event.after_data->>'avg_price' after_avg_price,
      case when event.source='agent' then 'agent' else 'app' end authored_via,
      event.created_at
    from public.activity_events event
    left join public.accounts account on account.id=event.account_id and account.user_id=event.user_id
    left join public.instruments instrument on instrument.id=event.instrument_id and instrument.user_id=event.user_id
    where event.user_id=auth.uid() and event.status='succeeded'
      and event.action_type='log_completed_trade' and event.after_data ? 'trade_quantity'
      and (input_before is null or event.created_at<input_before)
    order by event.created_at desc,event.id desc
    limit least(greatest(coalesce(input_limit,50),1),100)
  ) item;
$$;

create or replace function public.app_list_transaction_page(
  input_instrument_id bigint default null,input_account_id bigint default null,
  input_limit integer default 20,input_cursor jsonb default null
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  page_limit integer:=greatest(1,least(coalesce(input_limit,20),100));
  cursor_created_at timestamptz;
  cursor_id bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'created_at') or not(input_cursor?'id')
      then raise exception 'Invalid transaction cursor'; end if;
    begin
      cursor_created_at:=(input_cursor->>'created_at')::timestamptz;
      cursor_id:=(input_cursor->>'id')::bigint;
    exception when others then raise exception 'Invalid transaction cursor'; end;
  end if;
  return (
    with filtered as (
      select event.id event_id,event.id::text id,event.account_id,
        coalesce(account.name,event.after_data->>'account_name') account_name,
        event.instrument_id,coalesce(instrument.ticker,event.after_data->>'ticker') ticker,
        coalesce(instrument.display_name,event.after_data->>'instrument_name') instrument_name,
        event.after_data->>'side' side,event.after_data->>'trade_quantity' quantity,
        event.after_data->>'unit_price' unit_price,event.after_data->>'executed_on' executed_on,
        event.before_data->>'quantity' before_quantity,event.after_data->>'quantity' after_quantity,
        event.after_data->>'avg_price' after_avg_price,
        case when event.source='agent' then 'agent' else 'app' end authored_via,event.created_at
      from public.activity_events event
      left join public.accounts account on account.id=event.account_id and account.user_id=event.user_id
      left join public.instruments instrument on instrument.id=event.instrument_id and instrument.user_id=event.user_id
      where event.user_id=auth.uid() and event.status='succeeded'
        and event.action_type='log_completed_trade' and event.after_data ? 'trade_quantity'
        and (input_instrument_id is null or event.instrument_id=input_instrument_id)
        and (input_account_id is null or event.account_id=input_account_id)
        and (cursor_created_at is null or (event.created_at,event.id)<(cursor_created_at,cursor_id))
      order by event.created_at desc,event.id desc limit page_limit+1
    ), page as (select * from filtered order by created_at desc,event_id desc limit page_limit)
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(to_jsonb(item)-'event_id' order by item.created_at desc,item.event_id desc) from page item),'[]'::jsonb),
      'next_cursor',case when (select count(*) from filtered)>page_limit then
        (select jsonb_build_object('created_at',item.created_at,'id',item.event_id::text)
         from page item order by item.created_at,item.event_id limit 1) else null end
    )
  );
end; $$;

-- Keep old action facts and any follow-up task references, but do not leave a
-- link to the retired table. Old partial payloads are not misrepresented as
-- complete trade rows in the new transaction page.
update public.activity_events set target_table=null,target_id=null
where action_type='log_completed_trade' and target_table='trade_entries';
drop table public.trade_entries;

-- Trade activity details are owner-only; the activity grant does not grant a
-- friend the execution price, account, or exact quantity. Also restore the
-- private-kind filter missing from the action timeline.
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
          and (selected_owner=auth.uid() or event.record_kind not in ('research','review','decision','retrospective','trade'))
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
        and (selected_owner=auth.uid() or event.record_kind not in ('research','review','decision','retrospective','trade'))
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
          and (selected_owner=auth.uid() or event.record_kind not in ('research','review','decision','retrospective','trade'))
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
      and (ae.user_id = auth.uid() or ae.record_kind not in ('research','review','decision','retrospective','trade'))
    order by ae.created_at desc
    limit least(greatest(coalesce(limit_count, 20), 1), 100);
$$;
