-- Timeline and search read from the same task/record split; tags are ordinary
-- filters, never hidden kinds or permission switches.
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
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if selected_owner is null then raise exception 'Owner is required'; end if;
  if normalized_filter not in ('all','pending','done') then raise exception 'Invalid action timeline filter'; end if;
  if input_from is not null and input_to is not null and input_from>input_to then raise exception 'Invalid action timeline date range'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'occurred_at') or not(input_cursor?'id') then
      raise exception 'Invalid action timeline cursor';
    end if;
    begin cursor_at:=(input_cursor->>'occurred_at')::timestamptz;
      cursor_id:=(input_cursor->>'id')::bigint;
    exception when others then raise exception 'Invalid action timeline cursor'; end;
  end if;
  tasks_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks');
  activity_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity');
  return (with pending_rows as (
    select task.id,task.kind,task.version,task.title,task.subject,task.due_date,task.timezone,
      task.trigger_text,task.control_state,task.recurrence_kind,task.recurrence_start_on,
      case when task.recurrence_kind='daily' then (clock_timestamp() at time zone task.timezone)::date end occurrence_on,
      coalesce(occurrence.status,'open') status,task.created_at,task.updated_at
    from public.portfolio_tasks task
    left join public.general_task_occurrence_states occurrence
      on occurrence.user_id=task.user_id and occurrence.task_id=task.id
      and occurrence.occurrence_key=case when task.recurrence_kind='daily'
        then (clock_timestamp() at time zone task.timezone)::date else date '0001-01-01' end
    where tasks_allowed and normalized_filter in ('all','pending') and task.user_id=selected_owner
      and task.kind='general' and task.control_state='active'
      and (task.recurrence_kind<>'daily' or (clock_timestamp() at time zone task.timezone)::date>=task.recurrence_start_on)
      and coalesce(occurrence.status,'open')='open'
  ), eligible_events as (
    select event.id,event.title,event.body,event.source,event.occurred_at,event.created_at,
      event.status,case when tasks_allowed then event.task_id end task_id,
      case when selected_owner=auth.uid() or public.can_view_feature(selected_owner,'assets') then event.holding_id end holding_id,
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
    'pending',coalesce((select jsonb_agg(to_jsonb(item) order by item.due_date nulls last,item.updated_at desc,item.id desc)
      from pending_rows item),'[]'::jsonb),
    'days',coalesce((select jsonb_agg(jsonb_build_object('date',day.display_date,'item_count',day.item_count,
      'items',day.items) order by day.display_date desc) from days day),'[]'::jsonb),
    'next_cursor',case when (select count(*) from bounded)>page_limit then
      (select jsonb_build_object('occurred_at',item.occurred_at,'id',item.id)
       from page item order by item.occurred_at,item.id limit 1) end));
end;
$$;

drop function public.app_search_activities(uuid,text,date,date,text,boolean,bigint,bigint,uuid[],text,integer,jsonb,text,text,text[]);
create function public.app_search_activities(
  input_owner_user_id uuid default null,input_query text default null,
  input_from date default null,input_to date default null,input_record_state text default 'all',
  input_instrument_id bigint default null,input_account_id bigint default null,input_holding_id bigint default null,
  input_tag_ids uuid[] default null,input_tag_match text default 'any',
  input_limit integer default 30,input_cursor jsonb default null,input_timezone text default 'Asia/Seoul'
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
  query_text text:=nullif(lower(trim(coalesce(input_query,''))),'');
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
      raise exception 'Invalid activity search cursor';
    end if;
    begin cursor_at:=(input_cursor->>'sort_at')::timestamptz;
      cursor_key:=input_cursor->>'key';
    exception when others then raise exception 'Invalid activity search cursor'; end;
  end if;
  tasks_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks');
  activity_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity');
  assets_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'assets');
  if not assets_allowed and (input_holding_id is not null or input_instrument_id is not null or input_account_id is not null) then
    raise exception 'Asset access required for target filters';
  end if;
  return (with task_rows as (
    select 'todo'::text record_state,'task'::text record_type,task.id::text record_id,
      null::bigint activity_id,task.id task_id,task.kind task_kind,task.title,task.trigger_text body,task.due_date,
      null::timestamptz occurred_at,task.created_at,task.updated_at,task.updated_at sort_at,
      'task:'||task.id::text record_key,task.version,task.subject,null::bigint holding_id,
      coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
        from public.portfolio_task_activity_tags relation join public.activity_tags tag
          on tag.user_id=relation.user_id and tag.id=relation.tag_id
        where relation.user_id=task.user_id and relation.task_id=task.id),'[]'::jsonb) tags
    from public.portfolio_tasks task
    left join public.general_task_occurrence_states state
      on state.user_id=task.user_id and state.task_id=task.id
      and state.occurrence_key=case when task.recurrence_kind='daily'
        then (clock_timestamp() at time zone task.timezone)::date else date '0001-01-01' end
    where tasks_allowed and record_state in ('all','todo') and task.user_id=selected_owner
      and task.control_state='active' and coalesce(state.status,'open')='open'
      and (input_from is null or task.due_date is null or task.due_date>=input_from)
      and (input_to is null or task.due_date is null or task.due_date<=input_to)
      and (input_holding_id is null or task.subject->>'holding_id'=input_holding_id::text)
      and (input_instrument_id is null or task.subject->>'instrument_id'=input_instrument_id::text)
      and (input_account_id is null or task.subject->>'account_id'=input_account_id::text)
      and (query_text is null or strpos(lower(concat_ws(' ',task.title,task.trigger_text)),query_text)>0)
      and (cardinality(selected_tags)=0 or case when tag_match='all' then
        (select count(distinct relation.tag_id) from public.portfolio_task_activity_tags relation
          where relation.user_id=task.user_id and relation.task_id=task.id and relation.tag_id=any(selected_tags))=cardinality(selected_tags)
        else exists(select 1 from public.portfolio_task_activity_tags relation
          where relation.user_id=task.user_id and relation.task_id=task.id and relation.tag_id=any(selected_tags)) end)
  ), event_rows as (
    select 'done'::text record_state,'activity'::text record_type,event.id::text record_id,
      event.id activity_id,case when tasks_allowed then event.task_id end task_id,null::text task_kind,
      coalesce(event.title,'기록') title,event.body,null::date due_date,event.occurred_at,
      event.created_at,event.updated_at,event.occurred_at sort_at,'activity:'||event.id::text record_key,
      case when selected_owner=auth.uid() then event.version end version,null::jsonb subject,
      case when selected_owner=auth.uid() or public.can_view_feature(selected_owner,'assets') then event.holding_id end holding_id,
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
      and (input_holding_id is null or event.holding_id=input_holding_id)
      and (input_instrument_id is null or event.instrument_id=input_instrument_id)
      and (input_account_id is null or event.account_id=input_account_id)
      and (query_text is null or strpos(lower(concat_ws(' ',event.title,event.body)),query_text)>0)
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
revoke all on function public.app_search_activities(uuid,text,date,date,text,bigint,bigint,bigint,uuid[],text,integer,jsonb,text) from public,anon;
grant execute on function public.app_search_activities(uuid,text,date,date,text,bigint,bigint,bigint,uuid[],text,integer,jsonb,text) to authenticated;
