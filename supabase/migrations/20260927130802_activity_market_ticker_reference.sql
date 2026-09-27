-- A recorded market subject survives removal from the current asset list.
alter table public.activity_events add column instrument_ticker text;

create or replace function public.app_normalize_activity_ticker(input_ticker text)
returns text language plpgsql immutable set search_path=public as $$
declare normalized text:=upper(btrim(input_ticker));
begin
  if input_ticker is null then return null; end if;
  if normalized !~ '^[A-Z0-9^][A-Z0-9.^=_-]{0,31}$' then
    raise exception 'Invalid market ticker';
  end if;
  return normalized;
end;
$$;
revoke all on function public.app_normalize_activity_ticker(text) from public, anon;
grant execute on function public.app_normalize_activity_ticker(text) to authenticated;

update public.activity_events e set instrument_ticker=public.app_normalize_activity_ticker(i.ticker)
from public.instruments i where e.instrument_id=i.id and e.user_id=i.user_id
  and i.instrument_type='market';

-- Preserve the name of a non-market reference before retiring its navigation link.
update public.activity_events e set
  body=case when e.body is null then '관련 자산: '||i.display_name
    when position('관련 자산: '||i.display_name in e.body)>0 then e.body
    else e.body||E'\n\n관련 자산: '||i.display_name end
from public.instruments i where e.instrument_id=i.id and e.user_id=i.user_id
  and i.instrument_type<>'market' and e.action_type='record_manual_activity';

update public.portfolio_tasks t set subject=(t.subject-'instrument_id')||
  jsonb_build_object('kind','instrument','instrument_ticker',public.app_normalize_activity_ticker(i.ticker))
from public.instruments i where t.user_id=i.user_id and t.subject->>'instrument_id'=i.id::text
  and i.instrument_type='market';

-- Keep non-market context as prose; it is no longer a related market ticker.
update public.portfolio_tasks t set
  subject=(t.subject-'instrument_id')||jsonb_build_object('kind','portfolio'),
  trigger_text=case when position('관련 자산: '||i.display_name in coalesce(t.trigger_text,''))>0
    then t.trigger_text
    when char_length(coalesce(t.trigger_text,''))+char_length(i.display_name)+10<=1000
    then concat_ws(E'\n\n',nullif(t.trigger_text,''),'관련 자산: '||i.display_name)
    else t.trigger_text end
from public.instruments i where t.user_id=i.user_id and t.subject->>'instrument_id'=i.id::text
  and i.instrument_type<>'market';

-- Orphan and free-form legacy IDs have no trustworthy ticker to infer.
update public.portfolio_tasks t set subject=(t.subject-'instrument_id')||jsonb_build_object('kind','portfolio')
where t.subject?'instrument_id';

update public.activity_events e set instrument_ticker=t.subject->>'instrument_ticker'
from public.portfolio_tasks t where e.task_id=t.id and e.user_id=t.user_id
  and e.instrument_ticker is null and t.subject->>'instrument_ticker' is not null;

create function public.app_validate_task_market_ticker()
returns trigger language plpgsql security definer set search_path=public as $$
declare selected_ticker text;
begin
  if new.subject?'instrument_id' then
    select public.app_normalize_activity_ticker(i.ticker) into selected_ticker
    from public.instruments i where i.id::text=new.subject->>'instrument_id'
      and i.user_id=new.user_id and i.instrument_type='market';
    if selected_ticker is null then raise exception 'Market instrument reference not found'; end if;
    new.subject:=(new.subject-'instrument_id')||jsonb_build_object('kind','instrument','instrument_ticker',selected_ticker);
  elsif new.subject?'instrument_ticker' then
    selected_ticker:=public.app_normalize_activity_ticker(new.subject->>'instrument_ticker');
    if selected_ticker is null or new.subject->>'kind'<>'instrument' then
      raise exception 'Market ticker requires an instrument task subject';
    end if;
    new.subject:=jsonb_set(new.subject,'{instrument_ticker}',to_jsonb(selected_ticker));
  end if;
  return new;
end;
$$;
create trigger portfolio_tasks_validate_market_ticker before insert or update of subject
  on public.portfolio_tasks for each row execute function public.app_validate_task_market_ticker();

create or replace function public.app_fill_activity_market_ticker()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.instrument_ticker is null and new.instrument_id is not null then
    select public.app_normalize_activity_ticker(i.ticker) into new.instrument_ticker
    from public.instruments i where i.id=new.instrument_id and i.user_id=new.user_id
      and i.instrument_type='market';
  end if;
  if new.instrument_ticker is null and new.task_id is not null then
    select t.subject->>'instrument_ticker' into new.instrument_ticker
    from public.portfolio_tasks t where t.id=new.task_id and t.user_id=new.user_id;
  end if;
  if new.instrument_ticker is not null then
    new.instrument_ticker:=public.app_normalize_activity_ticker(new.instrument_ticker);
  end if;
  return new;
end;
$$;
create trigger activity_events_fill_market_ticker before insert or update of instrument_ticker,instrument_id
  on public.activity_events for each row execute function public.app_fill_activity_market_ticker();
create index activity_events_owner_market_ticker_idx on public.activity_events(user_id,instrument_ticker)
  where instrument_ticker is not null;

-- The existing detail reader remains the permission gate for the added field.
create function public.app_get_activity_market_ticker(input_activity_id bigint,input_owner_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; selected_owner uuid:=coalesce(input_owner_user_id,auth.uid()); selected_ticker text;
  name text; assets_allowed boolean;
begin
  result:=public.app_get_activity(input_activity_id,input_owner_user_id);
  if result is null then return null; end if;
  assets_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'assets');
  if assets_allowed then
    select e.instrument_ticker into selected_ticker from public.activity_events e
      where e.id=input_activity_id and e.user_id=selected_owner;
    select i.display_name into name from public.instruments i
      where i.user_id=selected_owner and i.ticker=selected_ticker and i.instrument_type='market';
  end if;
  return (result-'instrument_id') || jsonb_build_object('instrument_ticker',selected_ticker,
    'instrument_summary',case when selected_ticker is null then null else
      jsonb_build_object('ticker',selected_ticker,'display_name',coalesce(name,selected_ticker)) end,
    'editable_fields',case when result->'editable_fields' @> '["instrument_id"]'::jsonb
      then (result->'editable_fields')-'instrument_id'||jsonb_build_array('instrument_ticker')
      else result->'editable_fields' end);
end;
$$;
revoke all on function public.app_get_activity_market_ticker(bigint,uuid) from public,anon;
grant execute on function public.app_get_activity_market_ticker(bigint,uuid) to authenticated;

-- Use the existing atomic tag writer, then bind the market ticker in the same transaction.
-- A separate receipt includes the ticker, preventing a retry from silently changing it.
create function public.app_create_activity_market_ticker_with_tags(
  input_idempotency_key uuid,input_payload jsonb,input_tag_ids uuid[] default array[]::uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare owner_id uuid:=auth.uid(); selected_ticker text; receipt public.activity_mutation_receipts%rowtype;
  request_payload jsonb; created jsonb; result jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if jsonb_typeof(input_payload)<>'object' then raise exception 'Activity payload must be an object'; end if;
  if input_payload?'instrument_id' then raise exception 'Use instrument_ticker instead of instrument_id'; end if;
  selected_ticker:=public.app_normalize_activity_ticker(input_payload->>'instrument_ticker');
  request_payload:=jsonb_build_object('payload',input_payload,'tag_ids',to_jsonb(input_tag_ids));
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':create_activity_market_ticker:'||input_idempotency_key::text,0));
  select * into receipt from public.activity_mutation_receipts where user_id=owner_id
    and operation='create_activity_market_ticker' and idempotency_key=input_idempotency_key;
  if found then
    if receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;
  created:=public.app_create_activity_with_tags(input_idempotency_key,input_payload-'instrument_ticker',input_tag_ids);
  update public.activity_events set instrument_ticker=selected_ticker,instrument_id=null
    where id=(created->>'id')::bigint and user_id=owner_id;
  result:=public.app_get_activity_market_ticker((created->>'id')::bigint,null);
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(owner_id,'create_activity_market_ticker',input_idempotency_key,request_payload,result);
  return result;
end;
$$;
revoke all on function public.app_create_activity_market_ticker_with_tags(uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.app_create_activity_market_ticker_with_tags(uuid,jsonb,uuid[]) to authenticated;

create function public.app_save_activity_market_ticker_detail(
  input_activity_id bigint,input_expected_version integer,input_idempotency_key uuid,
  input_patch jsonb,input_tag_ids uuid[],input_authored_via text default 'app')
returns jsonb language plpgsql security definer set search_path=public as $$
declare owner_id uuid:=auth.uid(); selected_ticker text; receipt public.activity_mutation_receipts%rowtype;
  current_event public.activity_events%rowtype; request_payload jsonb; saved jsonb; result jsonb;
  requested_tags uuid[];
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if jsonb_typeof(input_patch)<>'object' then raise exception 'Activity patch must be an object'; end if;
  if input_patch?'instrument_id' then raise exception 'Use instrument_ticker instead of instrument_id'; end if;
  request_payload:=jsonb_build_object('activity_id',input_activity_id,'expected_version',input_expected_version,
    'patch',input_patch,'tag_ids',to_jsonb(input_tag_ids),'authored_via',input_authored_via);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':save_activity_market_ticker:'||input_idempotency_key::text,0));
  select * into receipt from public.activity_mutation_receipts where user_id=owner_id
    and operation='save_activity_market_ticker' and idempotency_key=input_idempotency_key;
  if found then
    if receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;
  select * into current_event from public.activity_events e where e.id=input_activity_id
    and e.user_id=owner_id and e.status='succeeded' for update;
  if not found then raise exception 'Activity was not found'; end if;
  if current_event.version<>input_expected_version then raise exception 'Activity version conflict'; end if;
  if input_tag_ids is null then
    select coalesce(array_agg(tag_id order by tag_id),array[]::uuid[]) into requested_tags
    from public.activity_event_tags where user_id=owner_id and activity_event_id=input_activity_id;
  else requested_tags:=input_tag_ids; end if;
  selected_ticker:=case when input_patch?'instrument_ticker'
    then public.app_normalize_activity_ticker(input_patch->>'instrument_ticker')
    else current_event.instrument_ticker end;
  saved:=public.app_save_activity_detail(input_activity_id,input_expected_version,input_idempotency_key,
    input_patch-'instrument_ticker',requested_tags,input_authored_via);
  if input_patch?'instrument_ticker' and
    (current_event.instrument_ticker is distinct from selected_ticker or current_event.instrument_id is not null) then
    update public.activity_events set instrument_ticker=selected_ticker,instrument_id=null,
      version=version+1,updated_at=clock_timestamp()
      where id=input_activity_id and user_id=owner_id;
  end if;
  result:=public.app_get_activity_market_ticker(input_activity_id,null);
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(owner_id,'save_activity_market_ticker',input_idempotency_key,request_payload,result);
  return result;
end;
$$;
revoke all on function public.app_save_activity_market_ticker_detail(bigint,integer,uuid,jsonb,uuid[],text) from public,anon;
grant execute on function public.app_save_activity_market_ticker_detail(bigint,integer,uuid,jsonb,uuid[],text) to authenticated;
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
      null::bigint activity_id,task.id task_id,task.kind task_kind,task.title,task.trigger_text body,task.due_date,
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
      and (query_text is null or strpos(lower(concat_ws(' ',task.title,task.trigger_text,task.subject->>'instrument_ticker')),query_text)>0)
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
      and (query_text is null or strpos(lower(concat_ws(' ',event.title,event.body,event.instrument_ticker)),query_text)>0)
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
revoke all on function public.app_search_activities_ticker(uuid,text,date,date,text,text,uuid[],text,integer,jsonb,text) from public,anon;
grant execute on function public.app_search_activities_ticker(uuid,text,date,date,text,text,uuid[],text,integer,jsonb,text) to authenticated;

create or replace function public.app_search_activities_ranked_ticker(
  input_query text,input_query_embedding extensions.vector(384) default null,
  input_owner_user_id uuid default null,input_from date default null,input_to date default null,
  input_record_state text default 'all',input_instrument_ticker text default null,
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
  if not assets_allowed and input_instrument_ticker is not null then
    raise exception 'Asset access required for target filters'; end if;
  fingerprint:=md5(jsonb_build_object('owner',selected_owner,'query',query_text,
    'from',input_from,'to',input_to,'state',record_state,'instrument',public.app_normalize_activity_ticker(input_instrument_ticker),
    'tags',selected_tags,'tag_match',tag_match,'timezone',input_timezone,
    'model','gte-small','mode',case when input_query_embedding is null then 'keyword' else 'hybrid' end)::text);
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
        when strpos(lower(concat_ws(' ',task.title,task.trigger_text,task.subject->>'instrument_ticker')),query_text)>0 then 80::numeric
        else round((semantic.similarity*10)::numeric,6) end rank,
      jsonb_build_object('record_type','task','record_id',task.id::text,
        'record_state',case when task.control_state='cancelled' or
          (task.recurrence_kind='none' and occurrence.status='done') then 'done' else 'todo' end,
        'task_id',task.id,'task_kind',task.kind,'title',task.title,'body',task.trigger_text,
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
          case when strpos(lower(concat_ws(' ',task.title,task.trigger_text,task.subject->>'instrument_ticker')),query_text)>0 then 'keyword'::text end,
          case when semantic.similarity>=0.96 then 'semantic'::text end
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
        and vector.record_id=task.id::text and vector.model='gte-small'
        and vector.content_hash=md5(left(trim(concat_ws(E'\n',task.title,task.trigger_text)),12000))
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
      and (strpos(lower(concat_ws(' ',task.title,task.trigger_text,task.subject->>'instrument_ticker')),query_text)>0
        or semantic.similarity>=0.96)
  ), event_rows as (
    select 'activity'::text record_type,event.id::text record_id,
      event.occurred_at sort_at,'activity:'||event.id::text record_key,
      'done'::text result_state,null::text task_status,
      case when lower(event.title)=query_text then 100::numeric
        when lower(event.title) like query_text||'%' then 90::numeric
        when strpos(lower(concat_ws(' ',event.title,event.body,event.instrument_ticker)),query_text)>0 then 80::numeric
        else round((semantic.similarity*10)::numeric,6) end rank,
      jsonb_build_object('record_type','activity','record_id',event.id::text,
        'record_state','done','activity_id',event.id,
        'task_id',case when tasks_allowed then event.task_id end,
        'title',event.title,'body',event.body,'occurred_at',event.occurred_at,
        'created_at',event.created_at,'updated_at',event.updated_at,
        'version',case when selected_owner=auth.uid() then event.version end,
        'instrument_ticker',case when assets_allowed then event.instrument_ticker end,
        'semantic_score',semantic.similarity,'excerpt',semantic.excerpt,
        'matched_by',to_jsonb(array_remove(array[
          case when strpos(lower(concat_ws(' ',event.title,event.body,event.instrument_ticker)),query_text)>0 then 'keyword'::text end,
          case when semantic.similarity>=0.96 then 'semantic'::text end
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
        and vector.record_id=event.id::text and vector.model='gte-small'
        and vector.content_hash=md5(left(trim(concat_ws(E'\n',event.title,event.body)),12000))
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
      and (strpos(lower(concat_ws(' ',event.title,event.body,event.instrument_ticker)),query_text)>0
        or semantic.similarity>=0.96)
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
    'semantic_threshold',case when input_query_embedding is null then null else 0.96 end,
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
revoke all on function public.app_search_activities_ranked_ticker(text,extensions.vector,uuid,date,date,text,text,uuid[],text,integer,jsonb,text) from public,anon;
grant execute on function public.app_search_activities_ranked_ticker(text,extensions.vector,uuid,date,date,text,text,uuid[],text,integer,jsonb,text) to authenticated;

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
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,
      'due_date',r.due_date,'recurrence_kind',r.recurrence_kind,
      'control_state',r.control_state) order by r.title,r.id),'[]'::jsonb),count(*) into rows,result_count
    from (select t.id,t.title,t.due_date,t.recurrence_kind,t.control_state
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
