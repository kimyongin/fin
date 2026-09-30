-- #175: retire chunk storage; only disposable search projections are rebuilt.
delete from pgmq.q_activity_search_index;
delete from public.activity_search_vectors;
alter table public.activity_search_vectors drop constraint activity_search_vectors_pkey;
alter table public.activity_search_vectors drop column chunk_no;
alter table public.activity_search_vectors add primary key(user_id,record_type,record_id);
alter table public.activity_search_vectors drop constraint activity_search_vectors_model_check;
alter table public.activity_search_vectors add constraint activity_search_vectors_model_check
  check(model='llama-text-embed-v2');

drop function public.app_finish_activity_search_job(bigint,uuid,text,text,integer,text,text,text,extensions.vector);
drop function public.app_get_activity_search_job(text,text,integer,text,text);

create or replace function public.activity_search_content_hash(input_text text)
returns text language sql immutable set search_path=public as $$
  select md5('pinecone-llama-summary-v3:' || trim(coalesce(input_text,'')));
$$;

-- Whole input, including retained legacy upper fields. Never truncate or split.
create function public.activity_search_input_eligible(input_text text)
returns boolean language sql immutable set search_path=public as $$
  select trim(coalesce(input_text,''))<>'' and octet_length(trim(input_text))<=1800;
$$;
revoke all on function public.activity_search_input_eligible(text) from public,anon,authenticated;

create or replace function public.activity_search_queue_text(
  input_user_id uuid,input_record_type text,input_record_id text,input_text text
) returns void language plpgsql security definer set search_path=public,pgmq as $$
declare source_text text:=trim(coalesce(input_text,''));
begin
  delete from public.activity_search_vectors where user_id=input_user_id
    and record_type=input_record_type and record_id=input_record_id;
  delete from pgmq.q_activity_search_index where message->>'user_id'=input_user_id::text
    and message->>'record_type'=input_record_type and message->>'record_id'=input_record_id;
  if not public.activity_search_input_eligible(source_text) then return; end if;
  perform pgmq.send('activity_search_index',jsonb_build_object(
    'user_id',input_user_id,'record_type',input_record_type,'record_id',input_record_id,
    'model','llama-text-embed-v2','content_hash',public.activity_search_content_hash(source_text)));
end;
$$;

create or replace function public.app_get_activity_search_job(
  input_record_type text,input_record_id text,input_content_hash text,
  input_model text
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  source_user uuid;
  source_text text;
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
      or input_model <> 'llama-text-embed-v2' or not public.activity_search_input_eligible(source_text) then
    return jsonb_build_object('stale',true);
  end if;
  return jsonb_build_object('stale',false,'user_id',source_user,
    'embedding_input',source_text);
end;
$$;

revoke all on function public.app_get_activity_search_job(text,text,text,text) from public,anon,authenticated;
grant execute on function public.app_get_activity_search_job(text,text,text,text) to service_role;

create or replace function public.app_finish_activity_search_job(
  input_message_id bigint,input_user_id uuid,input_record_type text,input_record_id text,
  input_content_hash text,input_model text,input_excerpt text,
  input_embedding extensions.vector(1024)
) returns boolean language plpgsql security definer set search_path = public, pgmq as $$
declare
  current_job jsonb;
begin
  -- Serialize with a concurrent edit: either this write wins and the edit
  -- clears it, or the edit wins and the hash check rejects the old job.
  if input_record_type='activity' then
    perform 1 from public.activity_events where user_id=input_user_id
      and id=input_record_id::bigint for update;
  elsif input_record_type='task' then
    perform 1 from public.portfolio_tasks where user_id=input_user_id
      and id=input_record_id::uuid for update;
  end if;
  current_job := public.app_get_activity_search_job(input_record_type,input_record_id,
    input_content_hash,input_model);
  if not exists(select 1 from pgmq.q_activity_search_index where msg_id=input_message_id
      and message->>'user_id'=input_user_id::text and message->>'record_type'=input_record_type
      and message->>'record_id'=input_record_id and message->>'content_hash'=input_content_hash
      and message->>'model'=input_model)
      or input_embedding is null or extensions.vector_norm(input_embedding)=0
      or input_model <> 'llama-text-embed-v2' or current_job->>'stale'='true' or current_job->>'user_id'<>input_user_id::text
      or current_job->>'embedding_input'<>input_excerpt then
    perform pgmq.delete('activity_search_index',input_message_id)
      where exists(select 1 from pgmq.q_activity_search_index where msg_id=input_message_id
        and message->>'user_id'=input_user_id::text and message->>'record_type'=input_record_type
        and message->>'record_id'=input_record_id and message->>'content_hash'=input_content_hash);
    return false;
  end if;
  insert into public.activity_search_vectors
    (user_id,record_type,record_id,model,content_hash,excerpt,embedding)
    values(input_user_id,input_record_type,input_record_id,
      input_model,input_content_hash,input_excerpt,input_embedding)
    on conflict(user_id,record_type,record_id) do update set
      model=excluded.model,content_hash=excluded.content_hash,
      excerpt=excluded.excerpt,embedding=excluded.embedding,embedded_at=now();
  perform pgmq.delete('activity_search_index',input_message_id);
  return true;
end;
$$;

revoke all on function public.app_finish_activity_search_job(bigint,uuid,text,text,text,text,text,extensions.vector) from public,anon,authenticated;
grant execute on function public.app_finish_activity_search_job(bigint,uuid,text,text,text,text,text,extensions.vector) to service_role;

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
  if (input_query_embedding is not null and input_query_model is distinct from 'llama-text-embed-v2')
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
    'model','llama-text-embed-v2','pipeline','pinecone-llama-summary-v3','threshold',0.212384,'mode',case when input_query_embedding is null then 'keyword' else 'hybrid' end)::text);
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
        else round(((1-(semantic.embedding <=> input_query_embedding))*10)::numeric,6) end rank,
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
        'semantic_score',(1-(semantic.embedding <=> input_query_embedding)),'excerpt',semantic.excerpt,
        'matched_by',to_jsonb(array_remove(array[
          case when strpos(lower(concat_ws(' ',task.title,task.summary,task.trigger_text,
            case when assets_allowed then task.subject->>'instrument_ticker' end)),query_text)>0 then 'keyword'::text end,
          case when (1-(semantic.embedding <=> input_query_embedding))>=0.212384 then 'semantic'::text end
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
    left join public.activity_search_vectors semantic on semantic.user_id=task.user_id and semantic.record_type='task'
        and input_query_embedding is not null
        and semantic.record_id=task.id::text and semantic.model='llama-text-embed-v2'
        and semantic.content_hash=public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(task.title),''),nullif(trim(task.summary),'')))

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
        or (1-(semantic.embedding <=> input_query_embedding))>=0.212384)
  ), event_rows as (
    select 'activity'::text record_type,event.id::text record_id,
      event.occurred_at sort_at,'activity:'||event.id::text record_key,
      'done'::text result_state,null::text task_status,
      case when lower(event.title)=query_text then 100::numeric
        when lower(event.title) like query_text||'%' then 90::numeric
        when strpos(lower(concat_ws(' ',event.title,event.summary,event.body,
          case when assets_allowed then event.instrument_ticker end)),query_text)>0 then 80::numeric
        else round(((1-(semantic.embedding <=> input_query_embedding))*10)::numeric,6) end rank,
      jsonb_build_object('record_type','activity','record_id',event.id::text,
        'record_state','done','activity_id',event.id,
        'task_id',case when tasks_allowed then event.task_id end,
        'title',event.title,'summary',event.summary,'body',event.body,'occurred_at',event.occurred_at,
        'created_at',event.created_at,'updated_at',event.updated_at,
        'version',case when selected_owner=auth.uid() then event.version end,
        'instrument_ticker',case when assets_allowed then event.instrument_ticker end,
        'semantic_score',(1-(semantic.embedding <=> input_query_embedding)),'excerpt',semantic.excerpt,
        'matched_by',to_jsonb(array_remove(array[
          case when strpos(lower(concat_ws(' ',event.title,event.summary,event.body,
            case when assets_allowed then event.instrument_ticker end)),query_text)>0 then 'keyword'::text end,
          case when (1-(semantic.embedding <=> input_query_embedding))>=0.212384 then 'semantic'::text end
        ],null::text)),
        'tags',coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name)
          order by lower(tag.name),tag.id) from public.activity_event_tags rel
          join public.activity_tags tag on tag.user_id=rel.user_id and tag.id=rel.tag_id
          where rel.user_id=event.user_id and rel.activity_event_id=event.id),'[]'::jsonb)) item
    from public.activity_events event
    left join public.activity_search_vectors semantic on semantic.user_id=event.user_id and semantic.record_type='activity'
        and input_query_embedding is not null
        and semantic.record_id=event.id::text and semantic.model='llama-text-embed-v2'
        and semantic.content_hash=public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(event.title),''),nullif(trim(event.summary),'')))

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
        or (1-(semantic.embedding <=> input_query_embedding))>=0.212384)
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
    'semantic_threshold',case when input_query_embedding is null then null else 0.212384 end,
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
    'model','llama-text-embed-v2','pipeline','pinecone-llama-summary-v3','threshold',0.212384,'mode',case when input_query_embedding is null then 'keyword' else 'hybrid' end)::text);
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
        else round(((1-(semantic.embedding <=> input_query_embedding))*10)::numeric,6) end rank,
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
        'semantic_score',(1-(semantic.embedding <=> input_query_embedding)),'excerpt',semantic.excerpt,
        'matched_by',to_jsonb(array_remove(array[
          case when strpos(lower(concat_ws(' ',task.title,task.summary,task.trigger_text)),query_text)>0 then 'keyword'::text end,
          case when (1-(semantic.embedding <=> input_query_embedding))>=0.212384 then 'semantic'::text end
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
    left join public.activity_search_vectors semantic on semantic.user_id=task.user_id and semantic.record_type='task'
        and input_query_embedding is not null
        and semantic.record_id=task.id::text and semantic.model='llama-text-embed-v2'
        and semantic.content_hash=public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(task.title),''),nullif(trim(task.summary),'')))

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
        or (1-(semantic.embedding <=> input_query_embedding))>=0.212384)
  ), event_rows as (
    select 'activity'::text record_type,event.id::text record_id,
      event.occurred_at sort_at,'activity:'||event.id::text record_key,
      'done'::text result_state,null::text task_status,
      case when lower(event.title)=query_text then 100::numeric
        when lower(event.title) like query_text||'%' then 90::numeric
        when strpos(lower(concat_ws(' ',event.title,event.summary,event.body)),query_text)>0 then 80::numeric
        else round(((1-(semantic.embedding <=> input_query_embedding))*10)::numeric,6) end rank,
      jsonb_build_object('record_type','activity','record_id',event.id::text,
        'record_state','done','activity_id',event.id,
        'task_id',case when tasks_allowed then event.task_id end,
        'title',event.title,'summary',event.summary,'body',event.body,'occurred_at',event.occurred_at,
        'created_at',event.created_at,'updated_at',event.updated_at,
        'version',case when selected_owner=auth.uid() then event.version end,
        'instrument_id',case when assets_allowed then event.instrument_id end,
        'semantic_score',(1-(semantic.embedding <=> input_query_embedding)),'excerpt',semantic.excerpt,
        'matched_by',to_jsonb(array_remove(array[
          case when strpos(lower(concat_ws(' ',event.title,event.summary,event.body)),query_text)>0 then 'keyword'::text end,
          case when (1-(semantic.embedding <=> input_query_embedding))>=0.212384 then 'semantic'::text end
        ],null::text)),
        'tags',coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name)
          order by lower(tag.name),tag.id) from public.activity_event_tags rel
          join public.activity_tags tag on tag.user_id=rel.user_id and tag.id=rel.tag_id
          where rel.user_id=event.user_id and rel.activity_event_id=event.id),'[]'::jsonb)) item
    from public.activity_events event
    left join public.activity_search_vectors semantic on semantic.user_id=event.user_id and semantic.record_type='activity'
        and input_query_embedding is not null
        and semantic.record_id=event.id::text and semantic.model='llama-text-embed-v2'
        and semantic.content_hash=public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(event.title),''),nullif(trim(event.summary),'')))

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
        or (1-(semantic.embedding <=> input_query_embedding))>=0.212384)
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
    'semantic_threshold',case when input_query_embedding is null then null else 0.212384 end,
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
declare selected_owner uuid:=coalesce(input_owner_user_id,auth.uid()); result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  with records as (
    select task.user_id,'task' record_type,task.id::text record_id,
      concat_ws(E'\n',nullif(trim(task.title),''),nullif(trim(task.summary),'')) input_text
    from public.portfolio_tasks task where task.user_id=selected_owner and task.kind='general'
      and (selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks'))
    union all
    select event.user_id,'activity',event.id::text,
      concat_ws(E'\n',nullif(trim(event.title),''),nullif(trim(event.summary),''))
    from public.activity_events event where event.user_id=selected_owner and event.status='succeeded'
      and event.action_type not in ('create_general_task','update_general_task')
      and (selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity'))
      and (event.action_type<>'complete_general_task' or selected_owner=auth.uid()
        or public.can_view_feature(selected_owner,'tasks'))
  )
  select jsonb_build_object(
    'missing_count',count(*) filter(where public.activity_search_input_eligible(records.input_text)
      and vector.record_id is null),
    'excluded_count',count(*) filter(where not public.activity_search_input_eligible(records.input_text)))
  into result from records left join public.activity_search_vectors vector
    on vector.user_id=records.user_id and vector.record_type=records.record_type
      and vector.record_id=records.record_id and vector.model='llama-text-embed-v2'
      and vector.content_hash=public.activity_search_content_hash(records.input_text);
  return result;
end;
$$;

create or replace function public.activity_search_event_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_text text;
  new_text text;
begin
  if tg_op = 'DELETE' then
    perform public.activity_search_queue_text(old.user_id,'activity',old.id::text,'');
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
    perform public.activity_search_queue_text(old.user_id,'task',old.id::text,'');
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

drop function public.activity_search_chunks(text);
drop function public.activity_search_clip_bytes(text,integer);

-- Retain old upper fields on unrelated edits; new/changed values use code points.
create function public.app_validate_activity_upper_text() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_table_name='activity_events' then
    if new.status<>'succeeded' then return new; end if;
  elsif new.kind<>'general' then return new;
  end if;
  if new.title is not null and (tg_op='INSERT' or new.title is distinct from old.title) then
    perform public.app_require_activity_text(to_jsonb(new.title),'title',100);
  end if;
  if new.summary is not null and (tg_op='INSERT' or new.summary is distinct from old.summary) then
    perform public.app_require_activity_text(to_jsonb(new.summary),'summary',300);
  end if;
  return new;
end;
$$;
revoke all on function public.app_validate_activity_upper_text() from public,anon,authenticated;
create trigger activity_events_zzz_upper_limits before insert or update on public.activity_events
  for each row execute function public.app_validate_activity_upper_text();
create trigger portfolio_tasks_upper_limits before insert or update on public.portfolio_tasks
  for each row execute function public.app_validate_activity_upper_text();

create or replace function public.app_summarize_automatic_activity()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='succeeded' and new.action_type<>'record_manual_activity' and new.summary is null then
    new.title:=left(new.title,100);
    new.summary:=left(concat_ws(' · ',nullif(btrim(new.title),''),nullif(regexp_replace(btrim(new.body),'[[:space:]]+',' ','g'),'')),300);
    if new.summary='' then new.summary:=null; end if;
  end if;
  return new;
end;
$$;

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
  if input_payload?'summary' and not exists(select 1 from public.portfolio_tasks
    where id=input_task_id and user_id=current_user_id and summary=normalized_summary) then
    perform public.app_require_activity_text(input_payload->'summary','summary',300); end if;
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
  if input_patch?'summary' and next_summary is distinct from event.summary then perform public.app_require_activity_text(input_patch->'summary','summary',300); end if;
  if input_patch?'title' and next_title is distinct from event.title then perform public.app_require_activity_text(input_patch->'title','title',100); end if;
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

create or replace function public.app_create_structured_activity(
 input_idempotency_key uuid,input_payload jsonb,input_tag_ids uuid[] default array[]::uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.app_require_activity_text(input_payload->'title','title',100);
  perform public.app_require_activity_text(input_payload->'summary','summary',300);
  perform public.app_require_activity_text(input_payload->'body','body',25000);
  return public.app_create_activity_market_ticker_with_tags(input_idempotency_key,input_payload,input_tag_ids);
end;
$$;

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
    perform public.app_require_activity_text(to_jsonb(input_result_title),'result_title',100);
    perform public.app_require_activity_text(to_jsonb(input_result_summary),'result_summary',300);
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

create or replace function public.app_save_structured_general_task(
 input_task_id uuid,input_expected_version integer,input_idempotency_key uuid,input_payload jsonb,input_tag_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from public.portfolio_tasks where id=input_task_id and user_id=auth.uid()
      and title=btrim(input_payload->>'title')) then
    perform public.app_require_activity_text(input_payload->'title','title',100); end if;
  if not exists(select 1 from public.portfolio_tasks where id=input_task_id and user_id=auth.uid()
      and summary=btrim(input_payload->>'summary') and summary is not null) then
    perform public.app_require_activity_text(input_payload->'summary','summary',300); end if;
  perform public.app_require_activity_text(input_payload->'trigger_text','body',25000);
  if input_task_id is null then
    return public.app_create_general_task_with_tags(input_idempotency_key,input_payload,coalesce(input_tag_ids,array[]::uuid[]));
  elsif input_tag_ids is null then
    return public.app_save_general_task(input_task_id,input_expected_version,input_idempotency_key,input_payload);
  end if;
  return public.app_save_general_task_detail(input_task_id,input_expected_version,input_idempotency_key,input_payload,input_tag_ids);
end;
$$;

-- Rebuild derived state only. The source rows, including legacy text, are unchanged.
do $$
declare item record;
begin
  for item in select user_id,id,title,summary from public.activity_events
    where status='succeeded' and action_type not in ('create_general_task','update_general_task') loop
    perform public.activity_search_queue_text(item.user_id,'activity',item.id::text,
      concat_ws(E'\n',nullif(trim(item.title),''),nullif(trim(item.summary),'')));
  end loop;
  for item in select user_id,id,title,summary from public.portfolio_tasks where kind='general' loop
    perform public.activity_search_queue_text(item.user_id,'task',item.id::text,
      concat_ws(E'\n',nullif(trim(item.title),''),nullif(trim(item.summary),'')));
  end loop;
end;
$$;
notify pgrst,'reload schema';
