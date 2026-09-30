-- #174: upper fields are explicit; legacy rows and purpose-specific receipts survive.
alter table public.portfolio_tasks add column summary text
  check (summary is null or (summary ~ '[^[:space:]]' and char_length(btrim(summary)) between 1 and 1000));
alter table public.activity_events add column summary text
  check (summary is null or (summary ~ '[^[:space:]]' and char_length(btrim(summary)) between 1 and 1000));

create function public.app_require_activity_text(input_value jsonb,input_field text,input_limit integer)
returns void language plpgsql immutable set search_path=public as $$
begin
  if coalesce(jsonb_typeof(input_value),'null')<>'string'
    or coalesce(input_value#>>'{}','') !~ '[^[:space:]]'
    or char_length(btrim(input_value#>>'{}')) not between 1 and input_limit then
    raise exception '% is required and must be at most % characters',input_field,input_limit;
  end if;
end;
$$;
revoke all on function public.app_require_activity_text(jsonb,text,integer) from public,anon,authenticated;


create or replace function public.app_save_general_task(
  input_task_id uuid, input_expected_version integer, input_idempotency_key uuid, input_payload jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  current_user_id uuid:=auth.uid(); current_task public.portfolio_tasks%rowtype;
  stored_receipt public.general_task_mutation_receipts%rowtype;
  task_id uuid:=coalesce(input_task_id,gen_random_uuid()); next_version integer;
  normalized_title text; normalized_timezone text; normalized_subject jsonb; normalized_due_date date;
  normalized_summary text; normalized_trigger text; authored_channel text;
  normalized_recurrence text; normalized_start_on date; normalized_days integer[]; normalized_time time; request_payload jsonb; response_payload jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if coalesce(jsonb_typeof(input_payload),'null')<>'object' then raise exception 'General task payload must be an object'; end if;
  normalized_title:=trim(coalesce(input_payload->>'title',''));
  normalized_timezone:=trim(coalesce(input_payload->>'timezone','Asia/Seoul'));
  normalized_subject:=coalesce(input_payload->'subject',jsonb_build_object('kind','portfolio'));
  normalized_trigger:=nullif(trim(coalesce(input_payload->>'trigger_text','')),'');
  normalized_summary:=nullif(btrim(input_payload->>'summary'),'');
  if input_payload?'summary' then perform public.app_require_activity_text(input_payload->'summary','summary',1000); end if;
  if char_length(normalized_trigger)>25000 then raise exception 'Task body is too long'; end if;
  authored_channel:=trim(coalesce(input_payload->>'authored_via','agent'));
  normalized_recurrence:=lower(trim(coalesce(input_payload->>'recurrence_kind','none')));
  if char_length(normalized_title) not between 1 and 500 then raise exception 'General task title is required and must be at most 500 characters'; end if;
  if not exists(select 1 from pg_timezone_names where name=normalized_timezone) then raise exception 'Invalid timezone'; end if;
  if jsonb_typeof(normalized_subject)<>'object' or trim(coalesce(normalized_subject->>'kind','')) not in ('portfolio','instrument','position') then raise exception 'General task subject must have a supported kind'; end if;
  if authored_channel not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
  if normalized_recurrence not in ('none','daily','weekly') then raise exception 'Invalid recurrence kind'; end if;
  if coalesce(jsonb_typeof(input_payload->'recurrence_weekdays'),'array')<>'array' then raise exception 'Weekdays must be an array'; end if;
  begin
    select coalesce(array_agg(value::integer order by value::integer),array[]::integer[]) into normalized_days
      from jsonb_array_elements_text(coalesce(input_payload->'recurrence_weekdays','[]'::jsonb)) value;
  exception when others then raise exception 'Invalid weekdays'; end;
  if exists(select 1 from unnest(normalized_days) day where day<1 or day>7) or
    (select count(distinct day) from unnest(normalized_days) day)<>cardinality(normalized_days) then raise exception 'Invalid weekdays'; end if;
  if nullif(input_payload->>'recurrence_time','') is not null then
    begin normalized_time:=(input_payload->>'recurrence_time')::time; exception when others then raise exception 'Invalid recurrence time'; end;
  end if;
  if nullif(trim(coalesce(input_payload->>'due_date','')),'') is not null then
    begin normalized_due_date:=(input_payload->>'due_date')::date; exception when invalid_datetime_format then raise exception 'Invalid due date'; end;
  end if;
  if nullif(trim(coalesce(input_payload->>'recurrence_start_on','')),'') is not null then
    begin normalized_start_on:=(input_payload->>'recurrence_start_on')::date; exception when invalid_datetime_format then raise exception 'Invalid recurrence start date'; end;
  end if;
  if normalized_recurrence in ('daily','weekly') and normalized_start_on is null then raise exception 'Recurrence needs a start date'; end if;
  if normalized_recurrence='weekly' and cardinality(normalized_days)=0 then raise exception 'Weekly recurrence needs a weekday'; end if;
  if normalized_recurrence<>'weekly' and cardinality(normalized_days)>0 then raise exception 'Weekdays require weekly recurrence'; end if;
  if normalized_recurrence='none' then normalized_start_on:=null; end if;
  request_payload:=jsonb_build_object('task_id',input_task_id,'expected_version',input_expected_version,'payload',input_payload);
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':save_general_task:'||input_idempotency_key::text,0));
  select * into stored_receipt from public.general_task_mutation_receipts
    where user_id=current_user_id and operation='save_general_task' and idempotency_key=input_idempotency_key;
  if found then
    if stored_receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return stored_receipt.response_payload;
  end if;
  if input_task_id is null then
    if input_expected_version is not null then raise exception 'New general task cannot have expected version'; end if;
    next_version:=1;
    insert into public.portfolio_tasks(id,user_id,kind,version,title,subject,due_date,timezone,trigger_text,summary,control_state,recurrence_kind,recurrence_start_on,recurrence_weekdays,recurrence_time)
    values(task_id,current_user_id,'general',1,normalized_title,normalized_subject,normalized_due_date,normalized_timezone,normalized_trigger,normalized_summary,'active',normalized_recurrence,normalized_start_on,normalized_days,normalized_time);
  else
    select * into current_task from public.portfolio_tasks task where task.id=input_task_id and task.user_id=current_user_id for update;
    if not found or current_task.kind<>'general' then raise exception 'General task was not found'; end if;
    if input_expected_version is null or current_task.version<>input_expected_version then raise exception 'General task version conflict'; end if;
    next_version:=current_task.version+1;
    update public.portfolio_tasks set version=next_version,title=normalized_title,subject=normalized_subject,due_date=normalized_due_date,
      timezone=normalized_timezone,trigger_text=normalized_trigger,summary=case when input_payload?'summary' then normalized_summary else current_task.summary end,recurrence_kind=normalized_recurrence,
      recurrence_start_on=normalized_start_on,recurrence_weekdays=normalized_days,recurrence_time=normalized_time,updated_at=clock_timestamp()
    where id=task_id and user_id=current_user_id;
  end if;
  insert into public.activity_events(user_id,source,action_type,target_table,target_id,task_id,before_data,after_data,status,occurred_at,occurrence_on)
  values(current_user_id,case when authored_channel='app' then 'user' else 'agent' end,
    case when input_task_id is null then 'create_general_task' else 'update_general_task' end,'portfolio_tasks',task_id::text,task_id,
    case when input_task_id is null then null else jsonb_build_object('version',current_task.version,'title',current_task.title,'recurrence_kind',current_task.recurrence_kind,'recurrence_start_on',current_task.recurrence_start_on) end,
    jsonb_build_object('version',next_version,'title',normalized_title,'due_date',normalized_due_date,'recurrence_kind',normalized_recurrence,'recurrence_start_on',normalized_start_on,'recurrence_weekdays',normalized_days,'recurrence_time',normalized_time),
    'succeeded',clock_timestamp(),(clock_timestamp() at time zone normalized_timezone)::date);
  response_payload:=public.app_get_general_task(task_id);
  insert into public.general_task_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(current_user_id,'save_general_task',input_idempotency_key,request_payload,response_payload);
  return response_payload;
end;
$$;

create or replace function public.app_get_general_task(input_task_id uuid)
returns jsonb language sql volatile security definer set search_path = public as $$
  select jsonb_build_object(
    'id', task.id, 'kind', task.kind, 'version', task.version, 'title', task.title,'summary',task.summary,
    'subject', task.subject, 'due_date', task.due_date, 'timezone', task.timezone,
    'trigger_text', task.trigger_text, 'control_state', task.control_state,
    'recurrence_kind', task.recurrence_kind, 'recurrence_start_on', task.recurrence_start_on,
    'recurrence_weekdays',task.recurrence_weekdays,'recurrence_time',task.recurrence_time,
    'occurrence_on', case when task.recurrence_kind='none' then null else public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) end,
    'status', case
      when task.control_state='cancelled' then 'cancelled'
      when public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) is null then 'not_scheduled'
      else coalesce((select state.status from public.general_task_occurrence_states state
        where state.user_id=task.user_id and state.task_id=task.id
          and state.occurrence_key=public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone)),'open')
    end,
    'created_at', task.created_at, 'updated_at', task.updated_at,
    'tags', coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
      from public.portfolio_task_activity_tags relation
      join public.activity_tags tag on tag.user_id=relation.user_id and tag.id=relation.tag_id
      where relation.user_id=task.user_id and relation.task_id=task.id),'[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
      'id', event.id, 'action_type', event.action_type, 'source', event.source,
      'after_data', event.after_data, 'occurred_at', event.occurred_at,
      'occurrence_on', event.occurrence_on, 'created_at', event.created_at
    ) order by event.occurred_at,event.id) from public.activity_events event
      where event.user_id=auth.uid() and event.task_id=task.id), '[]'::jsonb)
  )
  from public.portfolio_tasks task
  where task.id=input_task_id and task.user_id=auth.uid() and task.kind='general';
$$;

create or replace function public.app_get_general_task_for_owner(input_owner_user_id uuid,input_task_id uuid)
returns jsonb language sql volatile security definer set search_path=public as $$
  select case
    when auth.uid() is null then null
    when input_owner_user_id=auth.uid() then public.app_get_general_task(input_task_id)
    when public.can_view_feature(input_owner_user_id,'tasks') then (
      select jsonb_build_object(
        'id',task.id,'kind',task.kind,'version',task.version,'title',task.title,'summary',task.summary,
        'subject',task.subject,'due_date',task.due_date,'timezone',task.timezone,
        'trigger_text',task.trigger_text,'control_state',task.control_state,
        'recurrence_kind',task.recurrence_kind,'recurrence_start_on',task.recurrence_start_on,
        'recurrence_weekdays',task.recurrence_weekdays,'recurrence_time',task.recurrence_time,
        'occurrence_on',case when task.recurrence_kind='none' then null else
          public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,
            task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) end,
        'status',case
          when task.control_state='cancelled' then 'cancelled'
          when public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,
            task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) is null then 'not_scheduled'
          else coalesce((select occurrence.status from public.general_task_occurrence_states occurrence
            where occurrence.user_id=task.user_id and occurrence.task_id=task.id
              and occurrence.occurrence_key=public.app_task_due_occurrence(task.recurrence_kind,
                task.recurrence_start_on,task.recurrence_weekdays,task.due_date,
                task.recurrence_time,task.timezone)),'open') end,
        'created_at',task.created_at,'updated_at',task.updated_at,
        'history','[]'::jsonb,'events','[]'::jsonb)
      from public.portfolio_tasks task
      where task.user_id=input_owner_user_id and task.id=input_task_id and task.kind='general')
    else null end;
$$;

create or replace function public.app_list_due_general_tasks(input_limit integer default 100,input_offset integer default 0)
returns jsonb language sql volatile security definer set search_path=public as $$
  with candidates as (
    select task.*,
      public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,
        task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) due_on
    from public.portfolio_tasks task
    where task.user_id=auth.uid() and task.kind='general' and task.control_state='active'
  ), due as (
    select candidate.* from candidates candidate
    where candidate.due_on is not null and not exists (
      select 1 from public.general_task_occurrence_states state
      where state.user_id=candidate.user_id and state.task_id=candidate.id
        and state.occurrence_key=candidate.due_on and state.status='done')
  ), page as (
    select * from due order by updated_at,id
    limit greatest(1,least(coalesce(input_limit,100),100))
    offset greatest(0,coalesce(input_offset,0))
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',item.id,'version',item.version,'title',item.title,'summary',item.summary,'trigger_text',item.trigger_text,
      'subject',item.subject,'due_date',item.due_date,'timezone',item.timezone,
      'recurrence_kind',item.recurrence_kind,'recurrence_start_on',item.recurrence_start_on,
      'recurrence_weekdays',item.recurrence_weekdays,'recurrence_time',item.recurrence_time,
      'occurrence_on',case when item.recurrence_kind='none' then null else item.due_on end)
      order by item.updated_at,item.id) from page item),'[]'::jsonb),
    'next_offset',case when (select count(*) from due)>greatest(0,coalesce(input_offset,0))+
      greatest(1,least(coalesce(input_limit,100),100))
      then greatest(0,coalesce(input_offset,0))+greatest(1,least(coalesce(input_limit,100),100)) end);
$$;

create or replace function public.app_list_general_task_page(
    input_filter text default 'active', input_limit integer default 20, input_cursor jsonb default null
)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare
    normalized_filter text:=lower(trim(coalesce(input_filter,'active')));
    page_limit integer:=greatest(1,least(coalesce(input_limit,20),100));
    cursor_updated_at timestamptz; cursor_id uuid;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    if normalized_filter not in ('active','completed','paused','cancelled','all') then raise exception 'Invalid general task filter'; end if;
    if input_cursor is not null then
      if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'updated_at') or not(input_cursor?'id') then raise exception 'Invalid general task cursor'; end if;
      cursor_updated_at:=(input_cursor->>'updated_at')::timestamptz; cursor_id:=(input_cursor->>'id')::uuid;
    end if;
    return (with candidates as (
      select task.*,case
          when task.control_state='cancelled' then 'cancelled'
          when task.control_state='paused' then 'paused'
          when public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) is null then 'not_scheduled'
          else coalesce(state.status,'open')
        end status,
        case when task.recurrence_kind='none' then null else public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) end occurrence_on
      from public.portfolio_tasks task
      left join public.general_task_occurrence_states state on state.user_id=task.user_id and state.task_id=task.id
        and state.occurrence_key=public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone)
      where task.user_id=auth.uid() and task.kind='general'
    ), filtered as (
      select task.* from candidates task
      where (normalized_filter='all' or (normalized_filter='active' and task.status in ('open','not_scheduled'))
        or (normalized_filter='completed' and task.status='done') or task.status=normalized_filter)
        and (cursor_updated_at is null or (task.updated_at,task.id)<(cursor_updated_at,cursor_id))
      order by task.updated_at desc,task.id desc limit page_limit+1
    ), page as (select * from filtered order by updated_at desc,id desc limit page_limit)
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',task.id,'kind',task.kind,'version',task.version,'title',task.title,'summary',task.summary,'subject',task.subject,
        'due_date',task.due_date,'timezone',task.timezone,'trigger_text',task.trigger_text,
        'control_state',task.control_state,'status',task.status,'recurrence_kind',task.recurrence_kind,
        'recurrence_start_on',task.recurrence_start_on,'recurrence_weekdays',task.recurrence_weekdays,
        'recurrence_time',task.recurrence_time,'occurrence_on',task.occurrence_on,
        'created_at',task.created_at,'updated_at',task.updated_at
      ) order by task.updated_at desc,task.id desc) from page task),'[]'::jsonb),
      'next_cursor',case when (select count(*) from filtered)>page_limit then (
        select jsonb_build_object('updated_at',task.updated_at,'id',task.id) from page task order by task.updated_at,task.id limit 1
      ) else null end));
end;
$$;

create or replace function public.app_list_action_timeline(
  input_owner_user_id uuid default null,input_filter text default 'all',
  input_from date default null,input_to date default null,input_limit integer default 30,
  input_cursor jsonb default null,input_timezone text default 'Asia/Seoul'
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
  normalized_filter text:=lower(trim(coalesce(input_filter,'all')));
  page_limit integer:=greatest(1,least(coalesce(input_limit,30),100));
  cursor_at timestamptz;
  cursor_id bigint;
  tasks_allowed boolean;
  activity_allowed boolean;
  assets_allowed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if selected_owner is null then raise exception 'Owner is required'; end if;
  if normalized_filter not in ('all','pending','done') then raise exception 'Invalid action timeline filter'; end if;
  if input_from is not null and input_to is not null and input_from>input_to then raise exception 'Invalid action timeline date range'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'occurred_at') or not(input_cursor?'id') then
      raise exception 'Invalid action timeline cursor'; end if;
    begin cursor_at:=(input_cursor->>'occurred_at')::timestamptz;
      cursor_id:=(input_cursor->>'id')::bigint;
    exception when others then raise exception 'Invalid action timeline cursor'; end;
  end if;
  tasks_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks');
  activity_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity');
  assets_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'assets');
  return (with pending_rows as (
    select task.id,task.kind,task.version,task.title,task.summary,
      coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
        from public.portfolio_task_activity_tags relation join public.activity_tags tag
          on tag.user_id=relation.user_id and tag.id=relation.tag_id
        where relation.user_id=task.user_id and relation.task_id=task.id),'[]'::jsonb) tags,
      case when assets_allowed then task.subject else task.subject-'holding_id'-'account_id'-'instrument_id' end subject,
      task.due_date,task.timezone,task.trigger_text,task.control_state,task.recurrence_kind,task.recurrence_start_on,
      task.recurrence_weekdays,task.recurrence_time,
      case when task.recurrence_kind='none' then null else public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) end occurrence_on,
      case when public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,
        task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) is null then 'not_scheduled'
        else coalesce(occurrence.status,'open') end status,task.created_at,task.updated_at
    from public.portfolio_tasks task
    left join public.general_task_occurrence_states occurrence
      on occurrence.user_id=task.user_id and occurrence.task_id=task.id
      and occurrence.occurrence_key=public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone)
    where tasks_allowed and normalized_filter in ('all','pending') and task.user_id=selected_owner
      and task.kind='general' and task.control_state='active'
      and (task.recurrence_kind<>'none' or coalesce(occurrence.status,'open')='open')
  ), eligible_events as (
    select event.id,event.title,event.summary,event.body,event.source,event.occurred_at,event.created_at,
      event.status,case when tasks_allowed then event.task_id end task_id,
      case when assets_allowed then event.instrument_id end instrument_id,
      coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date) display_date,
      coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
        from public.activity_event_tags relation join public.activity_tags tag
          on tag.user_id=relation.user_id and tag.id=relation.tag_id
        where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb) tags
    from public.activity_events event
    where activity_allowed and normalized_filter in ('all','done') and event.user_id=selected_owner
      and event.status='succeeded'
      and event.action_type not in ('create_general_task','update_general_task')
      and (input_from is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)>=input_from)
      and (input_to is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)<=input_to)
      and (cursor_at is null or (event.occurred_at,event.id)<(cursor_at,cursor_id))
  ), bounded as (select * from eligible_events order by occurred_at desc,id desc limit page_limit+1),
  page as (select * from bounded order by occurred_at desc,id desc limit page_limit),
  days as (select display_date,count(*)::integer item_count,
    jsonb_agg(to_jsonb(item)-'display_date' order by occurred_at desc,id desc) items
    from page item group by display_date)
  select jsonb_build_object(
    'pending',coalesce((select jsonb_agg(to_jsonb(item) order by case when item.status='open' then 0 else 1 end,
        item.due_date nulls last,item.updated_at desc,item.id desc)
      from pending_rows item),'[]'::jsonb),
    'days',coalesce((select jsonb_agg(jsonb_build_object('date',day.display_date,'item_count',day.item_count,
      'items',day.items) order by day.display_date desc) from days day),'[]'::jsonb),
    'next_cursor',case when (select count(*) from bounded)>page_limit then
      (select jsonb_build_object('occurred_at',item.occurred_at,'id',item.id)
       from page item order by item.occurred_at,item.id limit 1) end));
end;
$$;

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
    'title',event.title,'summary',event.summary,'body',event.body,'occurred_at',event.occurred_at,
    'occurrence_on',event.occurrence_on,'created_at',event.created_at,'updated_at',event.updated_at,
    'source',event.source,
    'instrument_id',case when assets_allowed then event.instrument_id end,
    'instrument_summary',case when not assets_allowed or event.instrument_id is null then null else
      (select jsonb_build_object('id',i.id,'display_name',i.display_name,'ticker',i.ticker)
       from public.instruments i where i.id=event.instrument_id and i.user_id=event.user_id) end,
    'task_id',case when tasks_allowed then event.task_id end,
    'origin_task',case when not tasks_allowed or event.task_id is null then null else
      (select jsonb_build_object('id',task.id,'title',task.title,'summary',task.summary,'kind',task.kind,
        'trigger_text',task.trigger_text,'due_date',task.due_date,
        'recurrence_kind',task.recurrence_kind,'recurrence_start_on',task.recurrence_start_on)
       from public.portfolio_tasks task where task.id=event.task_id and task.user_id=event.user_id) end,
    'editable_fields',case when owns then jsonb_build_array('title','summary','body','occurred_at','instrument_id','task_id') else '[]'::jsonb end,
    'action_type',case when owns then event.action_type end,
    'before_data',case when owns then event.before_data end,
    'after_data',case when owns then event.after_data end
  ) from public.activity_events event
  where event.id=input_activity_id and event.user_id=selected_owner and event.status='succeeded');
end;
$$;

create or replace function public.app_create_activity(input_idempotency_key uuid,input_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  receipt public.activity_mutation_receipts%rowtype;
  title_text text;
  body_text text; summary_text text;
  authored_via text;
  timezone_name text;
  event_at timestamptz;
  selected_task uuid;
  selected_instrument bigint;
  event_id bigint;
  request_payload jsonb;
  response_payload jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if jsonb_typeof(input_payload)<>'object' then raise exception 'Activity payload must be an object'; end if;
  if exists(select 1 from jsonb_object_keys(input_payload) as field(name)
    where field.name not in ('title','summary','body','occurred_at','timezone','task_id',
      'instrument_id','authored_via','tag_ids')) then
    raise exception 'Unsupported activity field; update your tool contract';
  end if;
  title_text:=nullif(trim(coalesce(input_payload->>'title','')),'');
  body_text:=nullif(trim(coalesce(input_payload->>'body','')),'');
  summary_text:=nullif(btrim(input_payload->>'summary'),'');
  if input_payload?'summary' then perform public.app_require_activity_text(input_payload->'summary','summary',1000); end if;
  authored_via:=coalesce(input_payload->>'authored_via','agent');
  timezone_name:=coalesce(input_payload->>'timezone','Asia/Seoul');
  event_at:=coalesce(nullif(input_payload->>'occurred_at','')::timestamptz,clock_timestamp());
  selected_task:=nullif(input_payload->>'task_id','')::uuid;
  selected_instrument:=nullif(input_payload->>'instrument_id','')::bigint;
  if title_text is null or char_length(title_text)>500 then raise exception 'Activity title is required and must be at most 500 characters'; end if;
  if body_text is not null and char_length(body_text)>25000 then raise exception 'Activity body is too long'; end if;
  if authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
  if not exists(select 1 from pg_timezone_names where name=timezone_name) then raise exception 'Invalid timezone'; end if;
  if event_at>clock_timestamp()+interval '5 minutes' then raise exception 'Activity cannot be in the future'; end if;
  if selected_task is not null and not exists(select 1 from public.portfolio_tasks task where task.id=selected_task and task.user_id=owner_id) then
    raise exception 'Task reference not found';
  end if;
  if selected_instrument is not null and not exists(select 1 from public.instruments i where i.id=selected_instrument and i.user_id=owner_id) then
    raise exception 'Instrument reference not found';
  end if;
  request_payload:=jsonb_build_object('payload',input_payload);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':create_activity:'||input_idempotency_key::text,0));
  select * into receipt from public.activity_mutation_receipts
  where user_id=owner_id and operation='create_activity' and idempotency_key=input_idempotency_key;
  if found then
    if receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;
  insert into public.activity_events(user_id,source,action_type,target_table,after_data,status,
    occurred_at,occurrence_on,title,summary,body,task_id,instrument_id,updated_at)
  values(owner_id,case when authored_via='app' then 'user' else 'agent' end,
    'record_manual_activity','manual_activities',jsonb_build_object('title',title_text,'body',body_text),
    'succeeded',event_at,(event_at at time zone timezone_name)::date,title_text,summary_text,body_text,
    selected_task,selected_instrument,clock_timestamp())
  returning id into event_id;
  response_payload:=public.app_get_activity(event_id,null);
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
  values(owner_id,'create_activity',input_idempotency_key,request_payload,response_payload);
  return response_payload;
end;
$$;

create or replace function public.app_update_activity(
  input_activity_id bigint,input_expected_version integer,input_idempotency_key uuid,
  input_patch jsonb,input_authored_via text default 'app'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  event public.activity_events%rowtype;
  receipt public.activity_mutation_receipts%rowtype;
  request_payload jsonb;
  response_payload jsonb;
  next_title text;
  next_body text; next_summary text;
  next_occurred_at timestamptz;
  timezone_name text;
  next_task uuid;
  next_instrument bigint;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_expected_version is null or input_expected_version<1 then raise exception 'Expected version is required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if jsonb_typeof(input_patch)<>'object' or input_patch='{}'::jsonb then raise exception 'Activity patch must be a nonempty object'; end if;
  if input_authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
  if exists(select 1 from jsonb_object_keys(input_patch) as field(name)
    where field.name not in ('title','summary','body','occurred_at','timezone','task_id','instrument_id')) then
    raise exception 'Unsupported activity field; update your tool contract';
  end if;
  request_payload:=jsonb_build_object('activity_id',input_activity_id,'expected_version',input_expected_version,
    'patch',input_patch,'authored_via',input_authored_via);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':update_activity:'||input_idempotency_key::text,0));
  select * into receipt from public.activity_mutation_receipts
  where user_id=owner_id and operation='update_activity' and idempotency_key=input_idempotency_key;
  if found then
    if receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;
  select * into event from public.activity_events e
  where e.id=input_activity_id and e.user_id=owner_id and e.status='succeeded' for update;
  if not found then raise exception 'Activity was not found'; end if;
  if event.version<>input_expected_version then raise exception 'Activity version conflict'; end if;
  next_title:=case when input_patch?'title' then nullif(trim(coalesce(input_patch->>'title','')),'')
    else coalesce(event.title,nullif(event.after_data->>'title',''),'기록') end;
  next_body:=case when input_patch?'body' then nullif(trim(coalesce(input_patch->>'body','')),'') else event.body end;
  next_summary:=case when input_patch?'summary' then btrim(input_patch->>'summary') else event.summary end;
  if input_patch?'summary' then perform public.app_require_activity_text(input_patch->'summary','summary',1000); end if;
  if input_patch?'title' then perform public.app_require_activity_text(input_patch->'title','title',500); end if;
  if input_patch?'body' then perform public.app_require_activity_text(input_patch->'body','body',25000); end if;
  timezone_name:=coalesce(input_patch->>'timezone','Asia/Seoul');
  next_occurred_at:=case when input_patch?'occurred_at' then (input_patch->>'occurred_at')::timestamptz else event.occurred_at end;
  next_task:=case when input_patch?'task_id' then nullif(input_patch->>'task_id','')::uuid else event.task_id end;
  next_instrument:=case when input_patch?'instrument_id' then nullif(input_patch->>'instrument_id','')::bigint else event.instrument_id end;
  if next_title is null or char_length(next_title)>500 then raise exception 'Activity title is required and must be at most 500 characters'; end if;
  if next_body is not null and char_length(next_body)>25000 then raise exception 'Activity body is too long'; end if;
  if not exists(select 1 from pg_timezone_names where name=timezone_name) then raise exception 'Invalid timezone'; end if;
  if next_occurred_at is null or next_occurred_at>clock_timestamp()+interval '5 minutes' then raise exception 'Activity cannot be in the future'; end if;
  if next_task is not null and not exists(select 1 from public.portfolio_tasks task where task.id=next_task and task.user_id=owner_id) then
    raise exception 'Task reference not found';
  end if;
  if next_instrument is not null and not exists(select 1 from public.instruments i where i.id=next_instrument and i.user_id=owner_id) then
    raise exception 'Instrument reference not found';
  end if;
  update public.activity_events set title=next_title,summary=next_summary,body=next_body,occurred_at=next_occurred_at,
    occurrence_on=case when input_patch?'occurred_at' then (next_occurred_at at time zone timezone_name)::date else event.occurrence_on end,
    task_id=next_task,instrument_id=next_instrument,
    after_data=case when event.action_type='record_manual_activity' then jsonb_build_object('title',next_title,'body',next_body) else event.after_data end,
    version=version+1,updated_at=clock_timestamp()
  where id=event.id and user_id=owner_id;
  response_payload:=public.app_get_activity(event.id,null);
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
  values(owner_id,'update_activity',input_idempotency_key,request_payload,response_payload);
  return response_payload;
end;
$$;

create function public.app_save_structured_general_task(
 input_task_id uuid,input_expected_version integer,input_idempotency_key uuid,input_payload jsonb,input_tag_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.app_require_activity_text(input_payload->'title','title',500);
  perform public.app_require_activity_text(input_payload->'summary','summary',1000);
  perform public.app_require_activity_text(input_payload->'trigger_text','body',25000);
  if input_task_id is null then
    return public.app_create_general_task_with_tags(input_idempotency_key,input_payload,coalesce(input_tag_ids,array[]::uuid[]));
  elsif input_tag_ids is null then
    return public.app_save_general_task(input_task_id,input_expected_version,input_idempotency_key,input_payload);
  end if;
  return public.app_save_general_task_detail(input_task_id,input_expected_version,input_idempotency_key,input_payload,input_tag_ids);
end;
$$;
revoke all on function public.app_save_structured_general_task(uuid,integer,uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.app_save_structured_general_task(uuid,integer,uuid,jsonb,uuid[]) to authenticated;

create function public.app_create_structured_activity(
 input_idempotency_key uuid,input_payload jsonb,input_tag_ids uuid[] default array[]::uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.app_require_activity_text(input_payload->'title','title',500);
  perform public.app_require_activity_text(input_payload->'summary','summary',1000);
  perform public.app_require_activity_text(input_payload->'body','body',25000);
  return public.app_create_activity_market_ticker_with_tags(input_idempotency_key,input_payload,input_tag_ids);
end;
$$;
revoke all on function public.app_create_structured_activity(uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.app_create_structured_activity(uuid,jsonb,uuid[]) to authenticated;


create or replace function public.app_transition_general_task_structured(
  input_task_id uuid, input_expected_version integer, input_action text, input_result text,
  input_reason text, input_occurrence_on date, input_idempotency_key uuid, input_authored_via text default 'agent',input_result_title text default null,input_result_summary text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  current_user_id uuid:=auth.uid(); current_task public.portfolio_tasks%rowtype;
  stored_receipt public.general_task_mutation_receipts%rowtype; normalized_action text:=lower(trim(coalesce(input_action,'')));
  normalized_result text:=nullif(trim(coalesce(input_result,'')),''); normalized_reason text:=nullif(trim(coalesce(input_reason,'')),'');
  current_status text; next_control_state text; next_version integer; effective_on date; due_on date; local_today date;
  request_payload jsonb; response_payload jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if input_expected_version is null or input_expected_version<1 then raise exception 'Expected version is required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if input_authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
  if normalized_action not in ('complete','reopen','cancel') then raise exception 'Invalid general task transition'; end if;
  if normalized_action='complete' then
    perform public.app_require_activity_text(to_jsonb(input_result_title),'result_title',500);
    perform public.app_require_activity_text(to_jsonb(input_result_summary),'result_summary',1000);
    perform public.app_require_activity_text(to_jsonb(input_result),'result',25000);
  end if;
  request_payload:=jsonb_build_object('task_id',input_task_id,'expected_version',input_expected_version,'action',normalized_action,
    'result_title',input_result_title,'result_summary',input_result_summary,'result',normalized_result,'reason',normalized_reason,'occurrence_on',input_occurrence_on,'authored_via',input_authored_via);
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':transition_general_task_structured:'||input_idempotency_key::text,0));
  select * into stored_receipt from public.general_task_mutation_receipts
    where user_id=current_user_id and operation='transition_general_task_structured' and idempotency_key=input_idempotency_key;
  if found then
    if stored_receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return stored_receipt.response_payload;
  end if;
  select * into current_task from public.portfolio_tasks task where task.id=input_task_id and task.user_id=current_user_id for update;
  if not found or current_task.kind<>'general' then raise exception 'General task was not found'; end if;
  if current_task.version<>input_expected_version then raise exception 'General task version conflict'; end if;
  local_today:=(clock_timestamp() at time zone current_task.timezone)::date;
  due_on:=public.app_task_due_occurrence(current_task.recurrence_kind,current_task.recurrence_start_on,current_task.recurrence_weekdays,current_task.due_date,current_task.recurrence_time,current_task.timezone);
  effective_on:=coalesce(input_occurrence_on,due_on);
  if current_task.recurrence_kind='none' and input_occurrence_on is not null then
    if input_occurrence_on>local_today then raise exception 'A general task occurrence cannot be completed in the future'; end if;
    effective_on:=due_on;
  end if;
  if effective_on>local_today then raise exception 'A general task occurrence cannot be completed in the future'; end if;
  if normalized_action='complete' and (due_on is null or effective_on is null or effective_on>due_on
    or (input_authored_via='agent' and effective_on is distinct from due_on)) then
    raise exception 'Requested occurrence is not the latest due occurrence';
  end if;
  if current_task.recurrence_kind<>'none' and effective_on<current_task.recurrence_start_on then raise exception 'General task occurrence is before its recurrence start'; end if;
  current_status:=case
    when current_task.control_state='cancelled' then 'cancelled'
    when effective_on is null then 'not_scheduled'
    else coalesce((select state.status from public.general_task_occurrence_states state
      where state.user_id=current_user_id and state.task_id=current_task.id
        and state.occurrence_key=case when current_task.recurrence_kind<>'none' then effective_on else date '0001-01-01' end),'open')
  end;
  next_control_state:=current_task.control_state;
  if normalized_action='complete' then
    if current_status<>'open' then raise exception 'Only an open general task occurrence can be completed'; end if;
  elsif normalized_action='reopen' then
    if current_status<>'done' then raise exception 'Only a completed general task occurrence can be reopened'; end if;
    if normalized_reason is null then raise exception 'Reopening a general task needs a reason'; end if;
  elsif normalized_action='cancel' then
    if current_task.control_state='cancelled' then raise exception 'General task is already cancelled'; end if;
    if normalized_reason is null then raise exception 'Cancelling a general task needs a reason'; end if;
    next_control_state:='cancelled'; effective_on:=null;
  end if;
  next_version:=current_task.version+1;
  update public.portfolio_tasks set version=next_version,control_state=next_control_state,updated_at=clock_timestamp()
    where id=current_task.id and user_id=current_user_id;
  if normalized_action in ('complete','reopen') then
    insert into public.general_task_occurrence_states(user_id,task_id,occurrence_key,occurrence_on,status)
    values(current_user_id,current_task.id,
      case when current_task.recurrence_kind<>'none' then effective_on else date '0001-01-01' end,
      case when current_task.recurrence_kind<>'none' then effective_on else null end,
      case when normalized_action='complete' then 'done' else 'open' end)
    on conflict(user_id,task_id,occurrence_key) do update
      set status=excluded.status,occurrence_on=excluded.occurrence_on,updated_at=clock_timestamp();
  end if;
  insert into public.activity_events(user_id,source,action_type,target_table,target_id,task_id,title,summary,body,before_data,after_data,status,occurred_at,occurrence_on)
  values(current_user_id,case when input_authored_via='app' then 'user' else 'agent' end,normalized_action||'_general_task',
    'portfolio_tasks',current_task.id::text,current_task.id,
    case when normalized_action='complete' then btrim(input_result_title) end,
    case when normalized_action='complete' then btrim(input_result_summary) end,
    case when normalized_action='complete' then normalized_result end,
    jsonb_build_object('version',current_task.version,'status',current_status,'control_state',current_task.control_state),
    jsonb_build_object('version',next_version,'status',case when normalized_action='complete' then 'done' when normalized_action='reopen' then 'open' else next_control_state end,
      'control_state',next_control_state,'title',current_task.title,'result',normalized_result,'reason',normalized_reason,
      'recurrence_kind',current_task.recurrence_kind),
    'succeeded',clock_timestamp(),case when current_task.recurrence_kind='none' and normalized_action<>'cancel' then local_today else effective_on end);
  response_payload:=public.app_get_general_task(current_task.id);
  insert into public.general_task_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(current_user_id,'transition_general_task_structured',input_idempotency_key,request_payload,response_payload);
  return response_payload;
end;
$$;

revoke all on function public.app_transition_general_task_structured(uuid,integer,text,text,text,date,uuid,text,text,text) from public,anon;
grant execute on function public.app_transition_general_task_structured(uuid,integer,text,text,text,date,uuid,text,text,text) to authenticated;

-- Run after current-content/body triggers. Summaries use only committed mutation facts,
-- never LLM inference or a backfill of existing rows.
create function public.app_summarize_automatic_activity()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='succeeded' and new.action_type<>'record_manual_activity' and new.summary is null then
    new.summary:=left(concat_ws(' · ',nullif(btrim(new.title),''),nullif(regexp_replace(btrim(new.body),'[[:space:]]+',' ','g'),'')),1000);
    if new.summary='' then new.summary:=null; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.app_summarize_automatic_activity() from public,anon,authenticated;
create trigger activity_events_zz_summary before insert on public.activity_events
  for each row execute function public.app_summarize_automatic_activity();


create or replace function public.activity_search_content_hash(input_text text)
returns text language sql immutable set search_path=public as $$
  select md5('pinecone-e5-summary-v2:' || trim(coalesce(input_text,'')));
$$;

create or replace function public.app_get_activity_search_job(
  input_record_type text,input_record_id text,input_chunk_no integer,input_content_hash text,
  input_model text
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  source_user uuid;
  source_text text;
  selected_chunk record;
begin
  if input_record_type='activity' then
    select event.user_id, concat_ws(E'\n',nullif(trim(event.title),''),nullif(trim(event.summary),''))
      into source_user,source_text from public.activity_events event
      where event.id=input_record_id::bigint and event.status='succeeded'
        and event.action_type not in ('create_general_task','update_general_task');
  elsif input_record_type='task' then
    select task.user_id,concat_ws(E'\n',nullif(trim(task.title),''),nullif(trim(task.summary),''))
      into source_user,source_text from public.portfolio_tasks task
      where task.id=input_record_id::uuid and task.kind='general';
  else raise exception 'Invalid search record type'; end if;
  source_text := trim(coalesce(source_text,''));
  if source_user is null or public.activity_search_content_hash(source_text)<>input_content_hash
      or input_model <> 'multilingual-e5-large' or input_chunk_no<0 then
    return jsonb_build_object('stale',true);
  end if;
  select * into selected_chunk from public.activity_search_chunks(source_text)
    where chunk_no=input_chunk_no;
  if not found then return jsonb_build_object('stale',true); end if;
  return jsonb_build_object('stale',false,'user_id',source_user,
    'excerpt',selected_chunk.excerpt,'embedding_input',selected_chunk.embedding_input);
end;
$$;

create or replace function public.app_search_activities_ranked_ticker(
  input_query text,input_query_embedding extensions.vector(1024) default null,
  input_owner_user_id uuid default null,input_from date default null,input_to date default null,
  input_record_state text default 'all',input_instrument_ticker text default null,
  input_tag_ids uuid[] default null,input_tag_match text default 'any',
  input_limit integer default 30,input_cursor jsonb default null,
  input_timezone text default 'Asia/Seoul',input_query_model text default null
) returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare
  selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
  query_text text:=lower(trim(coalesce(input_query,'')));
  selected_tags uuid[]:=coalesce(input_tag_ids,array[]::uuid[]);
  tag_match text:=lower(trim(coalesce(input_tag_match,'any')));
  record_state text:=lower(trim(coalesce(input_record_state,'all')));
  page_limit integer:=greatest(1,least(coalesce(input_limit,30),100));
  tasks_allowed boolean;
  activity_allowed boolean;
  assets_allowed boolean;
  fingerprint text;
  cursor_rank numeric;
  cursor_at timestamptz;
  cursor_key text;
  result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if (input_query_embedding is not null and input_query_model is distinct from 'multilingual-e5-large')
      or (input_query_embedding is null and input_query_model is not null) then
    raise exception 'Search embedding model mismatch'; end if;
  if query_text='' or char_length(query_text)>500 then raise exception 'Invalid activity search query'; end if;
  if record_state not in ('all','todo','done') or tag_match not in ('any','all') then
    raise exception 'Invalid activity search filter'; end if;
  if input_from is not null and input_to is not null and input_from>input_to then
    raise exception 'Invalid activity search date range'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then
    raise exception 'Invalid timezone'; end if;
  if cardinality(selected_tags)>20 or array_position(selected_tags,null) is not null then
    raise exception 'Invalid activity tags'; end if;
  tasks_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks');
  activity_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity');
  assets_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'assets');
  if not assets_allowed and input_instrument_ticker is not null then
    raise exception 'Asset access required for target filters'; end if;
  fingerprint:=md5(jsonb_build_object('owner',selected_owner,'query',query_text,
    'from',input_from,'to',input_to,'state',record_state,'instrument',public.app_normalize_activity_ticker(input_instrument_ticker),
    'tags',selected_tags,'tag_match',tag_match,'timezone',input_timezone,
    'model','multilingual-e5-large','pipeline','pinecone-e5-summary-v2','threshold',0.8059,'mode',case when input_query_embedding is null then 'keyword' else 'hybrid' end)::text);
  if input_cursor is not null then
    if input_cursor->>'fingerprint' is distinct from fingerprint then
      raise exception 'Search conditions changed; start a new search'; end if;
    begin
      cursor_rank:=(input_cursor->>'rank')::numeric;
      cursor_at:=(input_cursor->>'sort_at')::timestamptz;
      cursor_key:=input_cursor->>'key';
      if cursor_rank is null or cursor_at is null or cursor_key is null then
        raise exception 'Invalid cursor'; end if;
    exception when others then raise exception 'Invalid activity search cursor'; end;
  end if;
  with task_rows as (
    select 'task'::text record_type,task.id::text record_id,
      task.updated_at sort_at,'task:'||task.id::text record_key,
      case when task.control_state='cancelled' or
        (task.recurrence_kind='none' and occurrence.status='done') then 'done' else 'todo' end result_state,
      case when task.control_state='cancelled' then 'cancelled'
        else coalesce(occurrence.status,'open') end task_status,
      case when lower(task.title)=query_text then 100::numeric
        when lower(task.title) like query_text||'%' then 90::numeric
        when strpos(lower(concat_ws(' ',task.title,task.summary,task.trigger_text,
          case when assets_allowed then task.subject->>'instrument_ticker' end)),query_text)>0 then 80::numeric
        else round((semantic.similarity*10)::numeric,6) end rank,
      jsonb_build_object('record_type','task','record_id',task.id::text,
        'record_state',case when task.control_state='cancelled' or
          (task.recurrence_kind='none' and occurrence.status='done') then 'done' else 'todo' end,
        'task_id',task.id,'task_kind',task.kind,'title',task.title,'summary',task.summary,'body',task.trigger_text,
        'due_date',task.due_date,'created_at',task.created_at,'updated_at',task.updated_at,
        'version',case when selected_owner=auth.uid() then task.version end,
        'task_status',case when task.control_state='cancelled' then 'cancelled'
          else coalesce(occurrence.status,'open') end,
        'recurrence_kind',task.recurrence_kind,'recurrence_start_on',task.recurrence_start_on,
        'recurrence_weekdays',task.recurrence_weekdays,'recurrence_time',task.recurrence_time,
        'timezone',task.timezone,
        'instrument_ticker',case when assets_allowed then task.subject->>'instrument_ticker' end,
        'semantic_score',semantic.similarity,'excerpt',semantic.excerpt,
        'matched_by',to_jsonb(array_remove(array[
          case when strpos(lower(concat_ws(' ',task.title,task.summary,task.trigger_text,
            case when assets_allowed then task.subject->>'instrument_ticker' end)),query_text)>0 then 'keyword'::text end,
          case when semantic.similarity>=0.8059 then 'semantic'::text end
        ],null::text)),
        'tags',coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name)
          order by lower(tag.name),tag.id) from public.portfolio_task_activity_tags rel
          join public.activity_tags tag on tag.user_id=rel.user_id and tag.id=rel.tag_id
          where rel.user_id=task.user_id and rel.task_id=task.id),'[]'::jsonb)) item
    from public.portfolio_tasks task
    left join public.general_task_occurrence_states occurrence
      on occurrence.user_id=task.user_id and occurrence.task_id=task.id
      and occurrence.occurrence_key=case when task.recurrence_kind='none' then date '0001-01-01'
        else public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,
          task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) end
    left join lateral (
      select 1-(vector.embedding <=> input_query_embedding) similarity,vector.excerpt
      from public.activity_search_vectors vector
      where vector.user_id=task.user_id and vector.record_type='task'
        and input_query_embedding is not null
        and vector.record_id=task.id::text and vector.model='multilingual-e5-large'
        and vector.content_hash=public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(task.title),''),nullif(trim(task.summary),'')))
      order by vector.embedding <=> input_query_embedding limit 1
    ) semantic on true
    where tasks_allowed and task.user_id=selected_owner and task.kind='general'
      and (input_instrument_ticker is null or task.subject->>'instrument_ticker'=public.app_normalize_activity_ticker(input_instrument_ticker))
      and (cardinality(selected_tags)=0 or case when tag_match='all' then
        (select count(distinct rel.tag_id) from public.portfolio_task_activity_tags rel
          where rel.user_id=task.user_id and rel.task_id=task.id
            and rel.tag_id=any(selected_tags))=cardinality(selected_tags)
        else exists(select 1 from public.portfolio_task_activity_tags rel
          where rel.user_id=task.user_id and rel.task_id=task.id
            and rel.tag_id=any(selected_tags)) end)
      and (strpos(lower(concat_ws(' ',task.title,task.summary,task.trigger_text,
        case when assets_allowed then task.subject->>'instrument_ticker' end)),query_text)>0
        or semantic.similarity>=0.8059)
  ), event_rows as (
    select 'activity'::text record_type,event.id::text record_id,
      event.occurred_at sort_at,'activity:'||event.id::text record_key,
      'done'::text result_state,null::text task_status,
      case when lower(event.title)=query_text then 100::numeric
        when lower(event.title) like query_text||'%' then 90::numeric
        when strpos(lower(concat_ws(' ',event.title,event.summary,event.body,
          case when assets_allowed then event.instrument_ticker end)),query_text)>0 then 80::numeric
        else round((semantic.similarity*10)::numeric,6) end rank,
      jsonb_build_object('record_type','activity','record_id',event.id::text,
        'record_state','done','activity_id',event.id,
        'task_id',case when tasks_allowed then event.task_id end,
        'title',event.title,'summary',event.summary,'body',event.body,'occurred_at',event.occurred_at,
        'created_at',event.created_at,'updated_at',event.updated_at,
        'version',case when selected_owner=auth.uid() then event.version end,
        'instrument_ticker',case when assets_allowed then event.instrument_ticker end,
        'semantic_score',semantic.similarity,'excerpt',semantic.excerpt,
        'matched_by',to_jsonb(array_remove(array[
          case when strpos(lower(concat_ws(' ',event.title,event.summary,event.body,
            case when assets_allowed then event.instrument_ticker end)),query_text)>0 then 'keyword'::text end,
          case when semantic.similarity>=0.8059 then 'semantic'::text end
        ],null::text)),
        'tags',coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name)
          order by lower(tag.name),tag.id) from public.activity_event_tags rel
          join public.activity_tags tag on tag.user_id=rel.user_id and tag.id=rel.tag_id
          where rel.user_id=event.user_id and rel.activity_event_id=event.id),'[]'::jsonb)) item
    from public.activity_events event
    left join lateral (
      select 1-(vector.embedding <=> input_query_embedding) similarity,vector.excerpt
      from public.activity_search_vectors vector
      where vector.user_id=event.user_id and vector.record_type='activity'
        and input_query_embedding is not null
        and vector.record_id=event.id::text and vector.model='multilingual-e5-large'
        and vector.content_hash=public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(event.title),''),nullif(trim(event.summary),'')))
      order by vector.embedding <=> input_query_embedding limit 1
    ) semantic on true
    where activity_allowed and event.user_id=selected_owner and event.status='succeeded'
      and event.action_type not in ('create_general_task','update_general_task')
      and (tasks_allowed or event.action_type<>'complete_general_task')
      and (input_from is null or coalesce(event.occurrence_on,
        (event.occurred_at at time zone input_timezone)::date)>=input_from)
      and (input_to is null or coalesce(event.occurrence_on,
        (event.occurred_at at time zone input_timezone)::date)<=input_to)
      and (input_instrument_ticker is null or event.instrument_ticker=public.app_normalize_activity_ticker(input_instrument_ticker))
      and (cardinality(selected_tags)=0 or case when tag_match='all' then
        (select count(distinct rel.tag_id) from public.activity_event_tags rel
          where rel.user_id=event.user_id and rel.activity_event_id=event.id
            and rel.tag_id=any(selected_tags))=cardinality(selected_tags)
        else exists(select 1 from public.activity_event_tags rel
          where rel.user_id=event.user_id and rel.activity_event_id=event.id
            and rel.tag_id=any(selected_tags)) end)
      and (strpos(lower(concat_ws(' ',event.title,event.summary,event.body,
        case when assets_allowed then event.instrument_ticker end)),query_text)>0
        or semantic.similarity>=0.8059)
  ), combined as (
    select record_type,record_id,sort_at,record_key,result_state,rank,item from task_rows
    union all
    select record_type,record_id,sort_at,record_key,result_state,rank,item from event_rows
  ), bounded as (
    select * from combined where record_state in ('all',result_state)
      and (cursor_rank is null or (rank,sort_at,record_key)<(cursor_rank,cursor_at,cursor_key))
    order by rank desc,sort_at desc,record_key desc limit page_limit+1
  ), page as (
    select * from bounded order by rank desc,sort_at desc,record_key desc limit page_limit
  ) select jsonb_build_object(
    'search_mode',case when input_query_embedding is null then 'keyword' else 'hybrid' end,
    'semantic_threshold',case when input_query_embedding is null then null else 0.8059 end,
    'items',coalesce((select jsonb_agg(item order by rank desc,sort_at desc,record_key desc)
      from page),'[]'::jsonb),
    'next_cursor',case when (select count(*) from bounded)>page_limit then
      (select jsonb_build_object('rank',rank,'sort_at',sort_at,'key',record_key,
        'fingerprint',fingerprint,'mode',case when input_query_embedding is null then 'keyword'
          else 'hybrid' end) from page order by rank,sort_at,record_key limit 1) end
  ) into result;
  return result;
end;
$$;

create or replace function public.app_search_activities_ranked(
  input_query text,input_query_embedding extensions.vector(1024) default null,
  input_owner_user_id uuid default null,input_from date default null,input_to date default null,
  input_record_state text default 'all',input_instrument_id bigint default null,
  input_tag_ids uuid[] default null,input_tag_match text default 'any',
  input_limit integer default 30,input_cursor jsonb default null,
  input_timezone text default 'Asia/Seoul'
) returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare
  selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
  query_text text:=lower(trim(coalesce(input_query,'')));
  selected_tags uuid[]:=coalesce(input_tag_ids,array[]::uuid[]);
  tag_match text:=lower(trim(coalesce(input_tag_match,'any')));
  record_state text:=lower(trim(coalesce(input_record_state,'all')));
  page_limit integer:=greatest(1,least(coalesce(input_limit,30),100));
  tasks_allowed boolean;
  activity_allowed boolean;
  assets_allowed boolean;
  fingerprint text;
  cursor_rank numeric;
  cursor_at timestamptz;
  cursor_key text;
  result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if query_text='' or char_length(query_text)>500 then raise exception 'Invalid activity search query'; end if;
  if record_state not in ('all','todo','done') or tag_match not in ('any','all') then
    raise exception 'Invalid activity search filter'; end if;
  if input_from is not null and input_to is not null and input_from>input_to then
    raise exception 'Invalid activity search date range'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then
    raise exception 'Invalid timezone'; end if;
  if cardinality(selected_tags)>20 or array_position(selected_tags,null) is not null then
    raise exception 'Invalid activity tags'; end if;
  tasks_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks');
  activity_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity');
  assets_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'assets');
  if not assets_allowed and input_instrument_id is not null then
    raise exception 'Asset access required for target filters'; end if;
  fingerprint:=md5(jsonb_build_object('owner',selected_owner,'query',query_text,
    'from',input_from,'to',input_to,'state',record_state,'instrument',input_instrument_id,
    'tags',selected_tags,'tag_match',tag_match,'timezone',input_timezone,
    'model','multilingual-e5-large','pipeline','pinecone-e5-summary-v2','threshold',0.8059,'mode',case when input_query_embedding is null then 'keyword' else 'hybrid' end)::text);
  if input_cursor is not null then
    if input_cursor->>'fingerprint' is distinct from fingerprint then
      raise exception 'Search conditions changed; start a new search'; end if;
    begin
      cursor_rank:=(input_cursor->>'rank')::numeric;
      cursor_at:=(input_cursor->>'sort_at')::timestamptz;
      cursor_key:=input_cursor->>'key';
      if cursor_rank is null or cursor_at is null or cursor_key is null then
        raise exception 'Invalid cursor'; end if;
    exception when others then raise exception 'Invalid activity search cursor'; end;
  end if;
  with task_rows as (
    select 'task'::text record_type,task.id::text record_id,
      task.updated_at sort_at,'task:'||task.id::text record_key,
      case when task.control_state='cancelled' or
        (task.recurrence_kind='none' and occurrence.status='done') then 'done' else 'todo' end result_state,
      case when task.control_state='cancelled' then 'cancelled'
        else coalesce(occurrence.status,'open') end task_status,
      case when lower(task.title)=query_text then 100::numeric
        when lower(task.title) like query_text||'%' then 90::numeric
        when strpos(lower(concat_ws(' ',task.title,task.summary,task.trigger_text)),query_text)>0 then 80::numeric
        else round((semantic.similarity*10)::numeric,6) end rank,
      jsonb_build_object('record_type','task','record_id',task.id::text,
        'record_state',case when task.control_state='cancelled' or
          (task.recurrence_kind='none' and occurrence.status='done') then 'done' else 'todo' end,
        'task_id',task.id,'task_kind',task.kind,'title',task.title,'summary',task.summary,'body',task.trigger_text,
        'due_date',task.due_date,'created_at',task.created_at,'updated_at',task.updated_at,
        'version',case when selected_owner=auth.uid() then task.version end,
        'task_status',case when task.control_state='cancelled' then 'cancelled'
          else coalesce(occurrence.status,'open') end,
        'recurrence_kind',task.recurrence_kind,'recurrence_start_on',task.recurrence_start_on,
        'recurrence_weekdays',task.recurrence_weekdays,'recurrence_time',task.recurrence_time,
        'timezone',task.timezone,
        'instrument_id',case when assets_allowed and task.subject->>'instrument_id' ~ '^[0-9]+$'
          then (task.subject->>'instrument_id')::bigint end,
        'semantic_score',semantic.similarity,'excerpt',semantic.excerpt,
        'matched_by',to_jsonb(array_remove(array[
          case when strpos(lower(concat_ws(' ',task.title,task.summary,task.trigger_text)),query_text)>0 then 'keyword'::text end,
          case when semantic.similarity>=0.8059 then 'semantic'::text end
        ],null::text)),
        'tags',coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name)
          order by lower(tag.name),tag.id) from public.portfolio_task_activity_tags rel
          join public.activity_tags tag on tag.user_id=rel.user_id and tag.id=rel.tag_id
          where rel.user_id=task.user_id and rel.task_id=task.id),'[]'::jsonb)) item
    from public.portfolio_tasks task
    left join public.general_task_occurrence_states occurrence
      on occurrence.user_id=task.user_id and occurrence.task_id=task.id
      and occurrence.occurrence_key=case when task.recurrence_kind='none' then date '0001-01-01'
        else public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,
          task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) end
    left join lateral (
      select 1-(vector.embedding <=> input_query_embedding) similarity,vector.excerpt
      from public.activity_search_vectors vector
      where vector.user_id=task.user_id and vector.record_type='task'
        and input_query_embedding is not null
        and vector.record_id=task.id::text and vector.model='multilingual-e5-large'
        and vector.content_hash=public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(task.title),''),nullif(trim(task.summary),'')))
      order by vector.embedding <=> input_query_embedding limit 1
    ) semantic on true
    where tasks_allowed and task.user_id=selected_owner and task.kind='general'
      and (input_instrument_id is null or task.subject->>'instrument_id'=input_instrument_id::text)
      and (cardinality(selected_tags)=0 or case when tag_match='all' then
        (select count(distinct rel.tag_id) from public.portfolio_task_activity_tags rel
          where rel.user_id=task.user_id and rel.task_id=task.id
            and rel.tag_id=any(selected_tags))=cardinality(selected_tags)
        else exists(select 1 from public.portfolio_task_activity_tags rel
          where rel.user_id=task.user_id and rel.task_id=task.id
            and rel.tag_id=any(selected_tags)) end)
      and (strpos(lower(concat_ws(' ',task.title,task.summary,task.trigger_text)),query_text)>0
        or semantic.similarity>=0.8059)
  ), event_rows as (
    select 'activity'::text record_type,event.id::text record_id,
      event.occurred_at sort_at,'activity:'||event.id::text record_key,
      'done'::text result_state,null::text task_status,
      case when lower(event.title)=query_text then 100::numeric
        when lower(event.title) like query_text||'%' then 90::numeric
        when strpos(lower(concat_ws(' ',event.title,event.summary,event.body)),query_text)>0 then 80::numeric
        else round((semantic.similarity*10)::numeric,6) end rank,
      jsonb_build_object('record_type','activity','record_id',event.id::text,
        'record_state','done','activity_id',event.id,
        'task_id',case when tasks_allowed then event.task_id end,
        'title',event.title,'summary',event.summary,'body',event.body,'occurred_at',event.occurred_at,
        'created_at',event.created_at,'updated_at',event.updated_at,
        'version',case when selected_owner=auth.uid() then event.version end,
        'instrument_id',case when assets_allowed then event.instrument_id end,
        'semantic_score',semantic.similarity,'excerpt',semantic.excerpt,
        'matched_by',to_jsonb(array_remove(array[
          case when strpos(lower(concat_ws(' ',event.title,event.summary,event.body)),query_text)>0 then 'keyword'::text end,
          case when semantic.similarity>=0.8059 then 'semantic'::text end
        ],null::text)),
        'tags',coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name)
          order by lower(tag.name),tag.id) from public.activity_event_tags rel
          join public.activity_tags tag on tag.user_id=rel.user_id and tag.id=rel.tag_id
          where rel.user_id=event.user_id and rel.activity_event_id=event.id),'[]'::jsonb)) item
    from public.activity_events event
    left join lateral (
      select 1-(vector.embedding <=> input_query_embedding) similarity,vector.excerpt
      from public.activity_search_vectors vector
      where vector.user_id=event.user_id and vector.record_type='activity'
        and input_query_embedding is not null
        and vector.record_id=event.id::text and vector.model='multilingual-e5-large'
        and vector.content_hash=public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(event.title),''),nullif(trim(event.summary),'')))
      order by vector.embedding <=> input_query_embedding limit 1
    ) semantic on true
    where activity_allowed and event.user_id=selected_owner and event.status='succeeded'
      and event.action_type not in ('create_general_task','update_general_task')
      and (tasks_allowed or event.action_type<>'complete_general_task')
      and (input_from is null or coalesce(event.occurrence_on,
        (event.occurred_at at time zone input_timezone)::date)>=input_from)
      and (input_to is null or coalesce(event.occurrence_on,
        (event.occurred_at at time zone input_timezone)::date)<=input_to)
      and (input_instrument_id is null or event.instrument_id=input_instrument_id)
      and (cardinality(selected_tags)=0 or case when tag_match='all' then
        (select count(distinct rel.tag_id) from public.activity_event_tags rel
          where rel.user_id=event.user_id and rel.activity_event_id=event.id
            and rel.tag_id=any(selected_tags))=cardinality(selected_tags)
        else exists(select 1 from public.activity_event_tags rel
          where rel.user_id=event.user_id and rel.activity_event_id=event.id
            and rel.tag_id=any(selected_tags)) end)
      and (strpos(lower(concat_ws(' ',event.title,event.summary,event.body)),query_text)>0
        or semantic.similarity>=0.8059)
  ), combined as (
    select record_type,record_id,sort_at,record_key,result_state,rank,item from task_rows
    union all
    select record_type,record_id,sort_at,record_key,result_state,rank,item from event_rows
  ), bounded as (
    select * from combined where record_state in ('all',result_state)
      and (cursor_rank is null or (rank,sort_at,record_key)<(cursor_rank,cursor_at,cursor_key))
    order by rank desc,sort_at desc,record_key desc limit page_limit+1
  ), page as (
    select * from bounded order by rank desc,sort_at desc,record_key desc limit page_limit
  ) select jsonb_build_object(
    'search_mode',case when input_query_embedding is null then 'keyword' else 'hybrid' end,
    'semantic_threshold',case when input_query_embedding is null then null else 0.8059 end,
    'items',coalesce((select jsonb_agg(item order by rank desc,sort_at desc,record_key desc)
      from page),'[]'::jsonb),
    'next_cursor',case when (select count(*) from bounded)>page_limit then
      (select jsonb_build_object('rank',rank,'sort_at',sort_at,'key',record_key,
        'fingerprint',fingerprint,'mode',case when input_query_embedding is null then 'keyword'
          else 'hybrid' end) from page order by rank,sort_at,record_key limit 1) end
  ) into result;
  return result;
end;
$$;

create or replace function public.app_activity_search_index_coverage(input_owner_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
  task_access boolean;
  event_access boolean;
  missing_count bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  task_access:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks');
  event_access:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity');
  select count(*) into missing_count from (
    select task.id::text record_id from public.portfolio_tasks task
      where task_access and task.user_id=selected_owner and task.kind='general'
        and (select count(*) from public.activity_search_vectors vector
          where vector.user_id=task.user_id and vector.record_type='task'
            and vector.record_id=task.id::text
            and vector.model='multilingual-e5-large' and vector.content_hash=
              public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(task.title),''),nullif(trim(task.summary),''))))
          < (select count(*) from public.activity_search_chunks(concat_ws(E'\n',task.title,task.summary)))
    union all
    select event.id::text from public.activity_events event
      where event_access and event.user_id=selected_owner and event.status='succeeded'
        and event.action_type not in ('create_general_task','update_general_task')
        and (task_access or event.action_type<>'complete_general_task')
        and (select count(*) from public.activity_search_vectors vector
          where vector.user_id=event.user_id and vector.record_type='activity'
            and vector.record_id=event.id::text
            and vector.model='multilingual-e5-large' and vector.content_hash=
              public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(event.title),''),nullif(trim(event.summary),''))))
          < (select count(*) from public.activity_search_chunks(concat_ws(E'\n',event.title,event.summary)))
  ) missing;
  return jsonb_build_object('missing_count',missing_count);
end;
$$;

create or replace function public.activity_search_event_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_text text;
  new_text text;
begin
  if tg_op = 'DELETE' then
    delete from public.activity_search_vectors where user_id=old.user_id
      and record_type='activity' and record_id=old.id::text;
    return old;
  end if;
  new_text := case when new.status='succeeded'
      and new.action_type not in ('create_general_task','update_general_task')
    then concat_ws(E'\n', nullif(trim(new.title),''),nullif(trim(new.summary),'')) else '' end;
  if tg_op = 'UPDATE' then
    old_text := case when old.status='succeeded'
        and old.action_type not in ('create_general_task','update_general_task')
      then concat_ws(E'\n', nullif(trim(old.title),''),nullif(trim(old.summary),'')) else '' end;
    if new_text is not distinct from old_text then return new; end if;
  end if;
  perform public.activity_search_queue_text(new.user_id,'activity',new.id::text,new_text);
  return new;
end;
$$;

create or replace function public.activity_search_task_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_text text;
  new_text text;
begin
  if tg_op = 'DELETE' then
    delete from public.activity_search_vectors where user_id=old.user_id
      and record_type='task' and record_id=old.id::text;
    return old;
  end if;
  new_text := case when new.kind='general'
    then concat_ws(E'\n',nullif(trim(new.title),''),nullif(trim(new.summary),'')) else '' end;
  if tg_op = 'UPDATE' then
    old_text := case when old.kind='general'
      then concat_ws(E'\n',nullif(trim(old.title),''),nullif(trim(old.summary),'')) else '' end;
    if new_text is not distinct from old_text then return new; end if;
  end if;
  perform public.activity_search_queue_text(new.user_id,'task',new.id::text,new_text);
  return new;
end;
$$;

create or replace function public.app_search_activities_ticker(
  input_owner_user_id uuid default null,input_query text default null,
  input_from date default null,input_to date default null,input_record_state text default 'all',
  input_instrument_ticker text default null,input_tag_ids uuid[] default null,
  input_tag_match text default 'any',input_limit integer default 30,
  input_cursor jsonb default null,input_timezone text default 'Asia/Seoul'
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
  query_text text:=nullif(lower(trim(coalesce(input_query,''))), '');
  record_state text:=lower(trim(coalesce(input_record_state,'all')));
  tag_match text:=lower(trim(coalesce(input_tag_match,'any')));
  selected_tags uuid[]:=coalesce(input_tag_ids,array[]::uuid[]);
  page_limit integer:=greatest(1,least(coalesce(input_limit,30),100));
  cursor_at timestamptz;
  cursor_key text;
  tasks_allowed boolean;
  activity_allowed boolean;
  assets_allowed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if selected_owner is null then raise exception 'Owner is required'; end if;
  if record_state not in ('all','todo','done') then raise exception 'Invalid activity record state'; end if;
  if tag_match not in ('any','all') then raise exception 'Invalid activity tag match'; end if;
  if input_from is not null and input_to is not null and input_from>input_to then raise exception 'Invalid activity search date range'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
  if cardinality(selected_tags)>20 or array_position(selected_tags,null) is not null then raise exception 'Invalid activity tags'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'sort_at') or not(input_cursor?'key') then
      raise exception 'Invalid activity search cursor'; end if;
    begin cursor_at:=(input_cursor->>'sort_at')::timestamptz;
      cursor_key:=input_cursor->>'key';
    exception when others then raise exception 'Invalid activity search cursor'; end;
  end if;
  tasks_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks');
  activity_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity');
  assets_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'assets');
  if not assets_allowed and input_instrument_ticker is not null then
    raise exception 'Asset access required for target filters';
  end if;
  return (with task_rows as (
    select 'todo'::text record_state,'task'::text record_type,task.id::text record_id,
      null::bigint activity_id,task.id task_id,task.kind task_kind,task.title,task.summary,task.trigger_text body,task.due_date,
      null::timestamptz occurred_at,task.created_at,task.updated_at,task.updated_at sort_at,
      'task:'||task.id::text record_key,task.version,
      task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.recurrence_time,task.timezone,
      case when task.recurrence_kind='none' then null else public.app_task_due_occurrence(
        task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) end occurrence_on,
      case when public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,
        task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) is null then 'not_scheduled'
        else coalesce(state.status,'open') end task_status,
      case when assets_allowed then task.subject else task.subject-'holding_id'-'account_id'-'instrument_id' end subject,
      case when assets_allowed then task.subject->>'instrument_ticker' end instrument_ticker,
      coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
        from public.portfolio_task_activity_tags relation join public.activity_tags tag
          on tag.user_id=relation.user_id and tag.id=relation.tag_id
        where relation.user_id=task.user_id and relation.task_id=task.id),'[]'::jsonb) tags
    from public.portfolio_tasks task
    left join public.general_task_occurrence_states state
      on state.user_id=task.user_id and state.task_id=task.id
      and state.occurrence_key=public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone)
    where tasks_allowed and record_state in ('all','todo') and task.user_id=selected_owner
      and task.control_state='active' and (task.recurrence_kind<>'none' or coalesce(state.status,'open')='open')
      and (input_instrument_ticker is null or task.subject->>'instrument_ticker'=public.app_normalize_activity_ticker(input_instrument_ticker))
      and (query_text is null or strpos(lower(concat_ws(' ',task.title,task.summary,task.trigger_text,
        case when assets_allowed then task.subject->>'instrument_ticker' end)),query_text)>0)
      and (cardinality(selected_tags)=0 or case when tag_match='all' then
        (select count(distinct relation.tag_id) from public.portfolio_task_activity_tags relation
          where relation.user_id=task.user_id and relation.task_id=task.id and relation.tag_id=any(selected_tags))=cardinality(selected_tags)
        else exists(select 1 from public.portfolio_task_activity_tags relation
          where relation.user_id=task.user_id and relation.task_id=task.id and relation.tag_id=any(selected_tags)) end)
  ), event_rows as (
    select 'done'::text record_state,'activity'::text record_type,event.id::text record_id,
      event.id activity_id,case when tasks_allowed then event.task_id end task_id,null::text task_kind,
      coalesce(event.title,'기록') title,event.summary,event.body,null::date due_date,event.occurred_at,
      event.created_at,event.updated_at,event.occurred_at sort_at,'activity:'||event.id::text record_key,
      case when selected_owner=auth.uid() then event.version end version,
      null::text recurrence_kind,null::date recurrence_start_on,null::integer[] recurrence_weekdays,
      null::time recurrence_time,null::text timezone,null::date occurrence_on,null::text task_status,
      null::jsonb subject,
      case when assets_allowed then event.instrument_ticker end instrument_ticker,
      coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
        from public.activity_event_tags relation join public.activity_tags tag
          on tag.user_id=relation.user_id and tag.id=relation.tag_id
        where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb) tags
    from public.activity_events event
    where activity_allowed and record_state in ('all','done') and event.user_id=selected_owner
      and event.status='succeeded'
      and event.action_type not in ('create_general_task','update_general_task')
      and (input_from is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)>=input_from)
      and (input_to is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)<=input_to)
      and (input_instrument_ticker is null or event.instrument_ticker=public.app_normalize_activity_ticker(input_instrument_ticker))
      and (query_text is null or strpos(lower(concat_ws(' ',event.title,event.summary,event.body,
        case when assets_allowed then event.instrument_ticker end)),query_text)>0)
      and (cardinality(selected_tags)=0 or case when tag_match='all' then
        (select count(distinct relation.tag_id) from public.activity_event_tags relation
          where relation.user_id=event.user_id and relation.activity_event_id=event.id and relation.tag_id=any(selected_tags))=cardinality(selected_tags)
        else exists(select 1 from public.activity_event_tags relation
          where relation.user_id=event.user_id and relation.activity_event_id=event.id and relation.tag_id=any(selected_tags)) end)
  ), combined as (select * from task_rows union all select * from event_rows),
  bounded as (select * from combined where cursor_at is null or (sort_at,record_key)<(cursor_at,cursor_key)
    order by sort_at desc,record_key desc limit page_limit+1),
  page as (select * from bounded order by sort_at desc,record_key desc limit page_limit)
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(item)-'sort_at'-'record_key' order by sort_at desc,record_key desc)
      from page item),'[]'::jsonb),
    'next_cursor',case when (select count(*) from bounded)>page_limit then
      (select jsonb_build_object('sort_at',sort_at,'key',record_key) from page order by sort_at,record_key limit 1) end));
end;
$$;

-- Rebuild disposable projections only; source rows and legacy summaries stay untouched.
delete from pgmq.q_activity_search_index;
delete from public.activity_search_vectors;
do $$
declare item record;
begin
  for item in select user_id,id,title,summary from public.activity_events
    where status='succeeded' and action_type not in ('create_general_task','update_general_task') loop
    perform public.activity_search_queue_text(item.user_id,'activity',item.id::text,
      concat_ws(E'\n',nullif(btrim(item.title),''),nullif(btrim(item.summary),'')));
  end loop;
  for item in select user_id,id,title,summary from public.portfolio_tasks where kind='general' loop
    perform public.activity_search_queue_text(item.user_id,'task',item.id::text,
      concat_ws(E'\n',nullif(btrim(item.title),''),nullif(btrim(item.summary),'')));
  end loop;
end;
$$;
notify pgrst,'reload schema';

-- Agent recency lists use the same upper fields and read full content through get_activity.
create function public.app_list_recent_activity_content(limit_count integer default 20)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at desc,item.id desc),'[]'::jsonb)
  from (select event.id,event.title,event.summary,event.source,event.action_type,
      event.occurred_at,event.created_at,event.version
    from public.activity_events event
    where event.user_id=auth.uid() and event.status='succeeded'
    order by event.created_at desc,event.id desc
    limit least(greatest(coalesce(limit_count,20),1),100)) item;
$$;
revoke all on function public.app_list_recent_activity_content(integer) from public,anon;
grant execute on function public.app_list_recent_activity_content(integer) to authenticated;


create or replace function public.app_search_activity_references(
  input_kind text,input_query text,input_offset integer default 0,input_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare owner_id uuid:=auth.uid(); search_text text:=trim(coalesce(input_query,''));
  rows jsonb; result_count integer;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_kind not in ('instrument','task') or char_length(search_text)>100
    or input_offset<0 or input_offset>1000 or input_limit<1 or input_limit>30 then
    raise exception 'Invalid reference search';
  end if;
  if search_text='' then return jsonb_build_object('items','[]'::jsonb,'next_offset',null); end if;
  if input_kind='instrument' then
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'display_name',r.display_name,
      'ticker',r.ticker) order by r.display_name,r.id),'[]'::jsonb),count(*) into rows,result_count
    from (select i.id,i.display_name,i.ticker from public.instruments i
      where i.user_id=owner_id and i.instrument_type='market'
        and (i.display_name ilike '%'||search_text||'%' or i.ticker ilike '%'||search_text||'%')
      order by i.display_name,i.id offset input_offset limit input_limit+1) r;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'summary',r.summary,
      'due_date',r.due_date,'recurrence_kind',r.recurrence_kind,
      'control_state',r.control_state) order by r.title,r.id),'[]'::jsonb),count(*) into rows,result_count
    from (select t.id,t.title,t.summary,t.due_date,t.recurrence_kind,t.control_state
      from public.portfolio_tasks t where t.user_id=owner_id and t.kind='general'
        and t.title ilike '%'||search_text||'%'
      order by t.title,t.id offset input_offset limit input_limit+1) r;
  end if;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(value),'[]'::jsonb)
      from (select value from jsonb_array_elements(rows) with ordinality e(value,n)
        where n<=input_limit order by n) limited),
    'next_offset',case when result_count>input_limit then input_offset+input_limit else null end);
end;
$$;

create or replace function public.app_get_activity_report_context(
  input_period_start date,input_period_end date,input_timezone text,
  input_limit integer default 200,input_cursor jsonb default null
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  current_user_id uuid:=auth.uid();
  page_limit integer:=greatest(1,least(coalesce(input_limit,200),500));
  cursor_occurred_at timestamptz;
  cursor_id bigint;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if input_period_start is null or input_period_end is null or input_period_start>input_period_end
    or input_period_end-input_period_start>366 then raise exception 'Invalid report period'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'occurred_at') or not(input_cursor?'id') then
      raise exception 'Invalid report context cursor'; end if;
    begin cursor_occurred_at:=(input_cursor->>'occurred_at')::timestamptz;
      cursor_id:=(input_cursor->>'id')::bigint;
    exception when others then raise exception 'Invalid report context cursor'; end;
  end if;
  return (with eligible as (
    select event.id,event.title,event.summary,event.body,event.occurred_at,event.occurrence_on,
      event.task_id,event.instrument_id,
      coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
        from public.activity_event_tags relation join public.activity_tags tag
          on tag.user_id=relation.user_id and tag.id=relation.tag_id
        where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb) tags
    from public.activity_events event
    where event.user_id=current_user_id and event.status='succeeded'
      and event.action_type not in ('create_general_task','update_general_task')
      and coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)
        between input_period_start and input_period_end
      and (cursor_occurred_at is null or (event.occurred_at,event.id)<(cursor_occurred_at,cursor_id))
    order by event.occurred_at desc,event.id desc limit page_limit+1
  ), page as (select * from eligible order by occurred_at desc,id desc limit page_limit)
  select jsonb_build_object(
    'period',jsonb_build_object('start',input_period_start,'end',input_period_end,'timezone',input_timezone),
    'events',coalesce((select jsonb_agg(to_jsonb(item) order by item.occurred_at desc,item.id desc) from page item),'[]'::jsonb),
    'next_cursor',case when (select count(*) from eligible)>page_limit then
      (select jsonb_build_object('occurred_at',item.occurred_at,'id',item.id)
        from page item order by item.occurred_at,item.id limit 1) end,
    'current_open_tasks',coalesce((select jsonb_agg(jsonb_build_object('id',task.id,'title',task.title,'summary',task.summary,
      'due_date',task.due_date,'updated_at',task.updated_at) order by task.due_date nulls last,task.updated_at desc)
      from public.portfolio_tasks task where task.user_id=current_user_id and task.control_state='active'
        and task.kind='general'),'[]'::jsonb),
    'current_open_tasks_basis','current_at_request_not_historical_period_end'
  ));
end;
$$;

create or replace function public.app_search_activities(
  input_owner_user_id uuid default null,input_query text default null,
  input_from date default null,input_to date default null,input_record_state text default 'all',
  input_instrument_id bigint default null,input_tag_ids uuid[] default null,
  input_tag_match text default 'any',input_limit integer default 30,
  input_cursor jsonb default null,input_timezone text default 'Asia/Seoul'
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
  query_text text:=nullif(lower(trim(coalesce(input_query,''))), '');
  record_state text:=lower(trim(coalesce(input_record_state,'all')));
  tag_match text:=lower(trim(coalesce(input_tag_match,'any')));
  selected_tags uuid[]:=coalesce(input_tag_ids,array[]::uuid[]);
  page_limit integer:=greatest(1,least(coalesce(input_limit,30),100));
  cursor_at timestamptz;
  cursor_key text;
  tasks_allowed boolean;
  activity_allowed boolean;
  assets_allowed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if selected_owner is null then raise exception 'Owner is required'; end if;
  if record_state not in ('all','todo','done') then raise exception 'Invalid activity record state'; end if;
  if tag_match not in ('any','all') then raise exception 'Invalid activity tag match'; end if;
  if input_from is not null and input_to is not null and input_from>input_to then raise exception 'Invalid activity search date range'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
  if cardinality(selected_tags)>20 or array_position(selected_tags,null) is not null then raise exception 'Invalid activity tags'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'sort_at') or not(input_cursor?'key') then
      raise exception 'Invalid activity search cursor'; end if;
    begin cursor_at:=(input_cursor->>'sort_at')::timestamptz;
      cursor_key:=input_cursor->>'key';
    exception when others then raise exception 'Invalid activity search cursor'; end;
  end if;
  tasks_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks');
  activity_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity');
  assets_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'assets');
  if not assets_allowed and input_instrument_id is not null then
    raise exception 'Asset access required for target filters';
  end if;
  return (with task_rows as (
    select 'todo'::text record_state,'task'::text record_type,task.id::text record_id,
      null::bigint activity_id,task.id task_id,task.kind task_kind,task.title,task.summary,task.trigger_text body,task.due_date,
      null::timestamptz occurred_at,task.created_at,task.updated_at,task.updated_at sort_at,
      'task:'||task.id::text record_key,task.version,
      task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.recurrence_time,task.timezone,
      case when task.recurrence_kind='none' then null else public.app_task_due_occurrence(
        task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) end occurrence_on,
      case when public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,
        task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone) is null then 'not_scheduled'
        else coalesce(state.status,'open') end task_status,
      case when assets_allowed then task.subject else task.subject-'holding_id'-'account_id'-'instrument_id' end subject,
      case when assets_allowed and task.subject->>'instrument_id' ~ '^[0-9]+$' then (task.subject->>'instrument_id')::bigint end instrument_id,
      coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
        from public.portfolio_task_activity_tags relation join public.activity_tags tag
          on tag.user_id=relation.user_id and tag.id=relation.tag_id
        where relation.user_id=task.user_id and relation.task_id=task.id),'[]'::jsonb) tags
    from public.portfolio_tasks task
    left join public.general_task_occurrence_states state
      on state.user_id=task.user_id and state.task_id=task.id
      and state.occurrence_key=public.app_task_due_occurrence(task.recurrence_kind,task.recurrence_start_on,task.recurrence_weekdays,task.due_date,task.recurrence_time,task.timezone)
    where tasks_allowed and record_state in ('all','todo') and task.user_id=selected_owner
      and task.control_state='active' and (task.recurrence_kind<>'none' or coalesce(state.status,'open')='open')
      and (input_instrument_id is null or task.subject->>'instrument_id'=input_instrument_id::text)
      and (query_text is null or strpos(lower(concat_ws(' ',task.title,task.summary,task.trigger_text)),query_text)>0)
      and (cardinality(selected_tags)=0 or case when tag_match='all' then
        (select count(distinct relation.tag_id) from public.portfolio_task_activity_tags relation
          where relation.user_id=task.user_id and relation.task_id=task.id and relation.tag_id=any(selected_tags))=cardinality(selected_tags)
        else exists(select 1 from public.portfolio_task_activity_tags relation
          where relation.user_id=task.user_id and relation.task_id=task.id and relation.tag_id=any(selected_tags)) end)
  ), event_rows as (
    select 'done'::text record_state,'activity'::text record_type,event.id::text record_id,
      event.id activity_id,case when tasks_allowed then event.task_id end task_id,null::text task_kind,
      coalesce(event.title,'기록') title,event.summary,event.body,null::date due_date,event.occurred_at,
      event.created_at,event.updated_at,event.occurred_at sort_at,'activity:'||event.id::text record_key,
      case when selected_owner=auth.uid() then event.version end version,
      null::text recurrence_kind,null::date recurrence_start_on,null::integer[] recurrence_weekdays,
      null::time recurrence_time,null::text timezone,null::date occurrence_on,null::text task_status,
      null::jsonb subject,
      case when assets_allowed then event.instrument_id end instrument_id,
      coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
        from public.activity_event_tags relation join public.activity_tags tag
          on tag.user_id=relation.user_id and tag.id=relation.tag_id
        where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb) tags
    from public.activity_events event
    where activity_allowed and record_state in ('all','done') and event.user_id=selected_owner
      and event.status='succeeded'
      and event.action_type not in ('create_general_task','update_general_task')
      and (input_from is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)>=input_from)
      and (input_to is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)<=input_to)
      and (input_instrument_id is null or event.instrument_id=input_instrument_id)
      and (query_text is null or strpos(lower(concat_ws(' ',event.title,event.summary,event.body)),query_text)>0)
      and (cardinality(selected_tags)=0 or case when tag_match='all' then
        (select count(distinct relation.tag_id) from public.activity_event_tags relation
          where relation.user_id=event.user_id and relation.activity_event_id=event.id and relation.tag_id=any(selected_tags))=cardinality(selected_tags)
        else exists(select 1 from public.activity_event_tags relation
          where relation.user_id=event.user_id and relation.activity_event_id=event.id and relation.tag_id=any(selected_tags)) end)
  ), combined as (select * from task_rows union all select * from event_rows),
  bounded as (select * from combined where cursor_at is null or (sort_at,record_key)<(cursor_at,cursor_key)
    order by sort_at desc,record_key desc limit page_limit+1),
  page as (select * from bounded order by sort_at desc,record_key desc limit page_limit)
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(item)-'sort_at'-'record_key' order by sort_at desc,record_key desc)
      from page item),'[]'::jsonb),
    'next_cursor',case when (select count(*) from bounded)>page_limit then
      (select jsonb_build_object('sort_at',sort_at,'key',record_key) from page order by sort_at,record_key limit 1) end));
end;
$$;
