-- The text passed to Pinecone is reproducible from the source row. Every chunk
-- contains new source characters; context and overlap are bounded separately.
create or replace function public.activity_search_clip_bytes(input_text text, input_limit integer)
returns text language plpgsql immutable set search_path=public as $$
declare result text := ''; idx integer;
begin
  for idx in 1..char_length(coalesce(input_text,'')) loop
    exit when octet_length(result || substr(input_text,idx,1)) > input_limit;
    result := result || substr(input_text,idx,1);
  end loop;
  return result;
end;
$$;
revoke all on function public.activity_search_clip_bytes(text,integer) from public,anon,authenticated;

create or replace function public.activity_search_content_hash(input_text text)
returns text language sql immutable set search_path=public as $$
  select md5('pinecone-e5-context-v1:' || trim(coalesce(input_text,'')));
$$;
revoke all on function public.activity_search_content_hash(text) from public,anon,authenticated;

create or replace function public.activity_search_chunks(input_text text)
returns table(chunk_no integer, excerpt text, embedding_input text)
language plpgsql immutable set search_path=public as $$
declare
  source_text text := trim(coalesce(input_text,''));
  title_text text;
  heading_text text := '';
  title_context text;
  heading_context text;
  prefix_text text;
  overlap_text text := '';
  segment text;
  next_overlap text;
  marker text[];
  pos integer := 1;
  scan_pos integer;
  max_end integer;
  boundary_pos integer;
  source_len integer := char_length(trim(coalesce(input_text,'')));
  n integer := 0;
  current_char text;
  next_char text;
  at_line_start boolean := true;
  fenced boolean := false;
  current_section integer := 0;
  previous_section integer := 0;
  section_at_start integer := 0;
begin
  if source_len = 0 then return; end if;
  title_text := case when strpos(source_text,E'\n') > 0 then split_part(source_text,E'\n',1) else '' end;
  while pos <= source_len loop
    title_context := public.activity_search_clip_bytes(title_text,120);
    heading_context := public.activity_search_clip_bytes(heading_text,120);
    prefix_text := case when pos > 1 and title_context <> '' then '제목: ' || title_context || E'\n' else '' end ||
      case when heading_context <> '' then '소제목: ' || heading_context || E'\n' else '' end;
    if previous_section <> current_section then overlap_text := ''; end if;
    section_at_start := current_section;
    scan_pos := pos;
    max_end := pos - 1;
    boundary_pos := 0;
    while scan_pos <= source_len loop
      current_char := substr(source_text,scan_pos,1);
      if octet_length(prefix_text || overlap_text || substr(source_text,pos,scan_pos-pos+1)) > 900 then exit; end if;
      max_end := scan_pos;
      next_char := substr(source_text,scan_pos+1,1);
      if current_char = E'\n' or
          (current_char in ('.','?','!','。','？','！') and
            (next_char = '' or next_char ~ '^[[:space:]]$')) then
        boundary_pos := scan_pos;
      end if;
      scan_pos := scan_pos + 1;
    end loop;
    if max_end < pos then raise exception 'Search context exceeds embedding input budget'; end if;
    if max_end = source_len then
      scan_pos := max_end;
    elsif boundary_pos >= pos then
      scan_pos := boundary_pos;
    else
      scan_pos := max_end;
      while scan_pos > pos and substr(source_text,scan_pos,1) !~ '^[[:space:]]$' loop
        scan_pos := scan_pos - 1;
      end loop;
      if scan_pos = pos then scan_pos := max_end; end if;
    end if;
    segment := substr(source_text,pos,scan_pos-pos+1);
    chunk_no := n;
    excerpt := overlap_text || segment;
    embedding_input := prefix_text || overlap_text || segment;
    return next;
    marker := regexp_match(segment,'([^.!?。？！\n]+[.!?。？！][[:space:]]*)$');
    next_overlap := case when marker is not null and octet_length(marker[1]) <= 120
      then marker[1] else '' end;
    -- Track headings only at line starts outside fenced blocks.
    for scan_pos in pos..(pos+char_length(segment)-1) loop
      if at_line_start then
        if substr(source_text,scan_pos,3) in ('```','~~~') then
          fenced := not fenced;
        elsif not fenced and substr(source_text,scan_pos) ~ '^#{1,6} ' then
          heading_text := split_part(substr(source_text,scan_pos),E'\n',1);
          current_section := current_section + 1;
        end if;
      end if;
      at_line_start := substr(source_text,scan_pos,1) = E'\n';
    end loop;
    previous_section := section_at_start;
    overlap_text := next_overlap;
    pos := pos + char_length(segment);
    n := n + 1;
  end loop;
end;
$$;
revoke all on function public.activity_search_chunks(text) from public,anon,authenticated;
-- #161. Search projections are disposable; source activity/task rows remain intact.
-- Pause the existing dispatcher before applying to a linked database.
drop index if exists public.activity_search_vectors_hnsw;
delete from pgmq.q_activity_search_index;
delete from public.activity_search_vectors;
alter table public.activity_search_vectors
  alter column embedding type extensions.vector(1024)
  using null::extensions.vector(1024);
alter table public.activity_search_vectors drop constraint if exists activity_search_vectors_model_check;
alter table public.activity_search_vectors
  add constraint activity_search_vectors_model_check check (model = 'multilingual-e5-large');
create index activity_search_vectors_hnsw on public.activity_search_vectors
  using hnsw (embedding extensions.vector_cosine_ops);

-- Retire the model-unaware job entrypoints before creating the new signatures.
drop function public.app_finish_activity_search_job(bigint,uuid,text,text,integer,text,text,extensions.vector);
drop function public.app_get_activity_search_job(text,text,integer,text);

create or replace function public.activity_search_queue_text(
  input_user_id uuid, input_record_type text, input_record_id text, input_text text
) returns void language plpgsql security definer set search_path = public, pgmq as $$
declare
  source_text text := trim(coalesce(input_text, ''));
  source_hash text := public.activity_search_content_hash(source_text);
  item record;
begin
  delete from public.activity_search_vectors
    where user_id = input_user_id and record_type = input_record_type and record_id = input_record_id;
  if source_text = '' then return; end if;
  for item in select chunk_no from public.activity_search_chunks(source_text) loop
    perform pgmq.send('activity_search_index', jsonb_build_object(
      'user_id', input_user_id, 'record_type', input_record_type,
      'record_id', input_record_id, 'chunk_no', item.chunk_no, 'model', 'multilingual-e5-large',
      'content_hash', source_hash
    ));
  end loop;
end;
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
    select event.user_id, concat_ws(E'\n',nullif(trim(event.title),''),nullif(trim(event.body),''))
      into source_user,source_text from public.activity_events event
      where event.id=input_record_id::bigint and event.status='succeeded'
        and event.action_type not in ('create_general_task','update_general_task');
  elsif input_record_type='task' then
    select task.user_id,concat_ws(E'\n',nullif(trim(task.title),''),nullif(trim(task.trigger_text),''))
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

revoke all on function public.app_get_activity_search_job(text,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.app_get_activity_search_job(text,text,integer,text,text) to service_role;

create or replace function public.app_finish_activity_search_job(
  input_message_id bigint,input_user_id uuid,input_record_type text,input_record_id text,
  input_chunk_no integer,input_content_hash text,input_model text,input_excerpt text,
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
    input_chunk_no,input_content_hash,input_model);
  if input_model <> 'multilingual-e5-large' or current_job->>'stale'='true' or current_job->>'user_id'<>input_user_id::text
      or current_job->>'excerpt'<>input_excerpt then
    perform pgmq.delete('activity_search_index',input_message_id);
    return false;
  end if;
  insert into public.activity_search_vectors
    (user_id,record_type,record_id,chunk_no,model,content_hash,excerpt,embedding)
    values(input_user_id,input_record_type,input_record_id,input_chunk_no,
      input_model,input_content_hash,input_excerpt,input_embedding)
    on conflict(user_id,record_type,record_id,chunk_no) do update set
      model=excluded.model,content_hash=excluded.content_hash,
      excerpt=excluded.excerpt,embedding=excluded.embedding,embedded_at=now();
  perform pgmq.delete('activity_search_index',input_message_id);
  return true;
end;
$$;

revoke all on function public.app_finish_activity_search_job(bigint,uuid,text,text,integer,text,text,text,extensions.vector) from public,anon,authenticated;
grant execute on function public.app_finish_activity_search_job(bigint,uuid,text,text,integer,text,text,text,extensions.vector) to service_role;

drop function public.app_search_activities_ranked_ticker(text,extensions.vector,uuid,date,date,text,text,uuid[],text,integer,jsonb,text);
create function public.app_search_activities_ranked_ticker(
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
    'model','multilingual-e5-large','pipeline','pinecone-e5-context-v1','threshold',0.8059,'mode',case when input_query_embedding is null then 'keyword' else 'hybrid' end)::text);
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
        when strpos(lower(concat_ws(' ',task.title,task.trigger_text,
          case when assets_allowed then task.subject->>'instrument_ticker' end)),query_text)>0 then 80::numeric
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
          case when strpos(lower(concat_ws(' ',task.title,task.trigger_text,
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
        and vector.content_hash=public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(task.title),''),nullif(trim(task.trigger_text),'')))
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
      and (strpos(lower(concat_ws(' ',task.title,task.trigger_text,
        case when assets_allowed then task.subject->>'instrument_ticker' end)),query_text)>0
        or semantic.similarity>=0.8059)
  ), event_rows as (
    select 'activity'::text record_type,event.id::text record_id,
      event.occurred_at sort_at,'activity:'||event.id::text record_key,
      'done'::text result_state,null::text task_status,
      case when lower(event.title)=query_text then 100::numeric
        when lower(event.title) like query_text||'%' then 90::numeric
        when strpos(lower(concat_ws(' ',event.title,event.body,
          case when assets_allowed then event.instrument_ticker end)),query_text)>0 then 80::numeric
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
          case when strpos(lower(concat_ws(' ',event.title,event.body,
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
        and vector.content_hash=public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(event.title),''),nullif(trim(event.body),'')))
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
      and (strpos(lower(concat_ws(' ',event.title,event.body,
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

revoke all on function public.app_search_activities_ranked_ticker(text,extensions.vector,uuid,date,date,text,text,uuid[],text,integer,jsonb,text,text) from public,anon;
grant execute on function public.app_search_activities_ranked_ticker(text,extensions.vector,uuid,date,date,text,text,uuid[],text,integer,jsonb,text,text) to authenticated;

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
    'model','multilingual-e5-large','pipeline','pinecone-e5-context-v1','threshold',0.8059,'mode',case when input_query_embedding is null then 'keyword' else 'hybrid' end)::text);
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
        when strpos(lower(concat_ws(' ',task.title,task.trigger_text)),query_text)>0 then 80::numeric
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
        'instrument_id',case when assets_allowed and task.subject->>'instrument_id' ~ '^[0-9]+$'
          then (task.subject->>'instrument_id')::bigint end,
        'semantic_score',semantic.similarity,'excerpt',semantic.excerpt,
        'matched_by',to_jsonb(array_remove(array[
          case when strpos(lower(concat_ws(' ',task.title,task.trigger_text)),query_text)>0 then 'keyword'::text end,
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
        and vector.content_hash=public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(task.title),''),nullif(trim(task.trigger_text),'')))
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
      and (strpos(lower(concat_ws(' ',task.title,task.trigger_text)),query_text)>0
        or semantic.similarity>=0.8059)
  ), event_rows as (
    select 'activity'::text record_type,event.id::text record_id,
      event.occurred_at sort_at,'activity:'||event.id::text record_key,
      'done'::text result_state,null::text task_status,
      case when lower(event.title)=query_text then 100::numeric
        when lower(event.title) like query_text||'%' then 90::numeric
        when strpos(lower(concat_ws(' ',event.title,event.body)),query_text)>0 then 80::numeric
        else round((semantic.similarity*10)::numeric,6) end rank,
      jsonb_build_object('record_type','activity','record_id',event.id::text,
        'record_state','done','activity_id',event.id,
        'task_id',case when tasks_allowed then event.task_id end,
        'title',event.title,'body',event.body,'occurred_at',event.occurred_at,
        'created_at',event.created_at,'updated_at',event.updated_at,
        'version',case when selected_owner=auth.uid() then event.version end,
        'instrument_id',case when assets_allowed then event.instrument_id end,
        'semantic_score',semantic.similarity,'excerpt',semantic.excerpt,
        'matched_by',to_jsonb(array_remove(array[
          case when strpos(lower(concat_ws(' ',event.title,event.body)),query_text)>0 then 'keyword'::text end,
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
        and vector.content_hash=public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(event.title),''),nullif(trim(event.body),'')))
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
      and (strpos(lower(concat_ws(' ',event.title,event.body)),query_text)>0
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
              public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(task.title),''),nullif(trim(task.trigger_text),''))))
          < (select count(*) from public.activity_search_chunks(concat_ws(E'\n',task.title,task.trigger_text)))
    union all
    select event.id::text from public.activity_events event
      where event_access and event.user_id=selected_owner and event.status='succeeded'
        and event.action_type not in ('create_general_task','update_general_task')
        and (task_access or event.action_type<>'complete_general_task')
        and (select count(*) from public.activity_search_vectors vector
          where vector.user_id=event.user_id and vector.record_type='activity'
            and vector.record_id=event.id::text
            and vector.model='multilingual-e5-large' and vector.content_hash=
              public.activity_search_content_hash(concat_ws(E'\n',nullif(trim(event.title),''),nullif(trim(event.body),''))))
          < (select count(*) from public.activity_search_chunks(concat_ws(E'\n',event.title,event.body)))
  ) missing;
  return jsonb_build_object('missing_count',missing_count);
end;
$$;

-- Requeue every current record through the same source and splitter contract.
do $$ declare item record; begin
  for item in select user_id,id,title,body from public.activity_events
    where status='succeeded' and action_type not in ('create_general_task','update_general_task') loop
    perform public.activity_search_queue_text(item.user_id,'activity',item.id::text,
      concat_ws(E'\n',nullif(trim(item.title),''),nullif(trim(item.body),'')));
  end loop;
  for item in select user_id,id,title,trigger_text from public.portfolio_tasks
    where kind='general' loop
    perform public.activity_search_queue_text(item.user_id,'task',item.id::text,
      concat_ws(E'\n',nullif(trim(item.title),''),nullif(trim(item.trigger_text),'')));
  end loop;
end $$;
