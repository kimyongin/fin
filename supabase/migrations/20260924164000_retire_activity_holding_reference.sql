-- Activity navigation is instrument-scoped. Financial command targets remain
-- holding-scoped in their purpose-specific execution payloads.
create or replace function public.app_fill_activity_instrument_reference()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.instrument_id is null and new.target_table='holdings' and new.target_id ~ '^[0-9]+$' then
    select i.id into new.instrument_id from public.holdings h
      join public.instruments i on i.user_id=h.user_id and i.ticker=h.ticker
      where h.id=new.target_id::bigint and h.user_id=new.user_id;
  end if;
  return new;
end;
$$;
drop trigger activity_events_fill_holding_reference on public.activity_events;
drop trigger activity_events_validate_holding_reference on public.activity_events;
drop function public.app_fill_activity_holding_reference();
drop function public.app_validate_activity_holding_reference();
create trigger activity_events_fill_instrument_reference before insert on public.activity_events
  for each row execute function public.app_fill_activity_instrument_reference();
create or replace function public.app_validate_activity_instrument_reference()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.instrument_id is not null and not exists(
    select 1 from public.instruments i where i.id=new.instrument_id and i.user_id=new.user_id
  ) then raise exception 'Instrument reference not found for activity owner'; end if;
  return new;
end;
$$;
create trigger activity_events_validate_instrument_reference
  before insert or update of instrument_id,user_id on public.activity_events
  for each row execute function public.app_validate_activity_instrument_reference();
alter table public.activity_events add constraint activity_events_instrument_id_fkey
  foreign key (instrument_id) references public.instruments(id) on delete set null;

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
    select task.id,task.kind,task.version,task.title,
      case when assets_allowed then task.subject else task.subject-'holding_id'-'account_id'-'instrument_id' end subject,
      task.due_date,task.timezone,task.trigger_text,task.control_state,task.recurrence_kind,task.recurrence_start_on,
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
    'pending',coalesce((select jsonb_agg(to_jsonb(item) order by item.due_date nulls last,item.updated_at desc,item.id desc)
      from pending_rows item),'[]'::jsonb),
    'days',coalesce((select jsonb_agg(jsonb_build_object('date',day.display_date,'item_count',day.item_count,
      'items',day.items) order by day.display_date desc) from days day),'[]'::jsonb),
    'next_cursor',case when (select count(*) from bounded)>page_limit then
      (select jsonb_build_object('occurred_at',item.occurred_at,'id',item.id)
       from page item order by item.occurred_at,item.id limit 1) end));
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
    select event.id,event.title,event.body,event.occurred_at,event.occurrence_on,
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
    'current_open_tasks',coalesce((select jsonb_agg(jsonb_build_object('id',task.id,'title',task.title,
      'due_date',task.due_date,'updated_at',task.updated_at) order by task.due_date nulls last,task.updated_at desc)
      from public.portfolio_tasks task where task.user_id=current_user_id and task.control_state='active'
        and task.kind='general'),'[]'::jsonb),
    'current_open_tasks_basis','current_at_request_not_historical_period_end'
  ));
end;
$$;

drop function public.app_search_activity_semantic(extensions.vector,uuid,date,date,bigint,bigint,bigint,uuid[],text,integer,text);
create function public.app_search_activity_semantic(
  input_query_embedding extensions.vector(384),input_owner_user_id uuid default null,
  input_from date default null,input_to date default null,
  input_instrument_id bigint default null,input_tag_ids uuid[] default null,
  input_tag_match text default 'any',input_limit integer default 30,
  input_timezone text default 'Asia/Seoul'
) returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare
  selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
  selected_tags uuid[]:=coalesce(input_tag_ids,array[]::uuid[]);
  tag_match text:=lower(trim(coalesce(input_tag_match,'any')));
  page_limit integer:=greatest(1,least(coalesce(input_limit,30),100));
  tasks_allowed boolean;
  assets_allowed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if tag_match not in ('any','all') then raise exception 'Invalid activity tag match'; end if;
  if cardinality(selected_tags)>20 or array_position(selected_tags,null) is not null then raise exception 'Invalid activity tags'; end if;
  if input_from is not null and input_to is not null and input_from>input_to then raise exception 'Invalid activity search date range'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
  if selected_owner<>auth.uid() and not public.can_view_feature(selected_owner,'activity') then
    return jsonb_build_object('items','[]'::jsonb); end if;
  tasks_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks');
  assets_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'assets');
  if not assets_allowed and input_instrument_id is not null then
    raise exception 'Asset access required for target filters';
  end if;
  return jsonb_build_object('items',coalesce((
    select jsonb_agg(jsonb_build_object(
      'record_state','done','record_type','activity','record_id',event.id::text,
      'activity_id',event.id,'task_id',case when tasks_allowed then event.task_id end,
      'instrument_id',case when assets_allowed then event.instrument_id end,
      'title',event.title,'body',event.body,'occurred_at',event.occurred_at,
      'created_at',event.created_at,'updated_at',event.updated_at,
      'version',case when selected_owner=auth.uid() then event.version end,
      'tags',coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name)
        order by lower(tag.name),tag.id) from public.activity_event_tags relation
        join public.activity_tags tag on tag.user_id=relation.user_id and tag.id=relation.tag_id
        where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb),
      'semantic_score',1-(event.embedding <=> input_query_embedding)
    ) order by event.embedding <=> input_query_embedding,event.occurred_at desc,event.id desc)
    from (
      select event.*,embedding.embedding from public.activity_events event
      join public.activity_embeddings embedding
        on embedding.user_id=event.user_id and embedding.activity_event_id=event.id
        and embedding.content_hash=public.activity_embedding_hash(event)
      where event.user_id=selected_owner and event.status='succeeded'
        and event.action_type not in ('create_general_task','update_general_task')
        and (input_from is null or coalesce(event.occurrence_on,
          (event.occurred_at at time zone input_timezone)::date)>=input_from)
        and (input_to is null or coalesce(event.occurrence_on,
          (event.occurred_at at time zone input_timezone)::date)<=input_to)
        and (input_instrument_id is null or event.instrument_id=input_instrument_id)
        and (cardinality(selected_tags)=0 or case when tag_match='all' then
          (select count(distinct relation.tag_id) from public.activity_event_tags relation
            where relation.user_id=event.user_id and relation.activity_event_id=event.id
              and relation.tag_id=any(selected_tags))=cardinality(selected_tags)
          else exists(select 1 from public.activity_event_tags relation
            where relation.user_id=event.user_id and relation.activity_event_id=event.id
              and relation.tag_id=any(selected_tags)) end)
      order by embedding.embedding <=> input_query_embedding,event.occurred_at desc,event.id desc
      limit page_limit
    ) event
  ),'[]'::jsonb));
end;
$$;
revoke all on function public.app_search_activity_semantic(extensions.vector,uuid,date,date,bigint,uuid[],text,integer,text) from public,anon;
grant execute on function public.app_search_activity_semantic(extensions.vector,uuid,date,date,bigint,uuid[],text,integer,text) to authenticated;

drop index if exists public.activity_events_user_holding_time_idx;
alter table public.activity_events drop column holding_id;
