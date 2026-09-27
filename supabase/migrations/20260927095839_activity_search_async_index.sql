-- Search vectors are disposable projections. The activity and task rows remain the source of truth.
create extension if not exists pgmq;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select pgmq.create('activity_search_index');

create table public.activity_search_vectors (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null check (record_type in ('task', 'activity')),
  record_id text not null,
  chunk_no integer not null check (chunk_no >= 0),
  model text not null check (model = 'gte-small'),
  content_hash text not null check (char_length(content_hash) = 32),
  excerpt text not null,
  embedding extensions.vector(384) not null,
  embedded_at timestamptz not null default now(),
  primary key (user_id, record_type, record_id, chunk_no)
);
alter table public.activity_search_vectors enable row level security;
revoke all on public.activity_search_vectors from public, anon, authenticated;
create index activity_search_vectors_hnsw on public.activity_search_vectors
  using hnsw (embedding extensions.vector_cosine_ops);

-- At most 400 characters enter one gte-small call, well below its 512-token limit.
-- A changed document invalidates all previous chunks immediately.
create function public.activity_search_queue_text(
  input_user_id uuid, input_record_type text, input_record_id text, input_text text
) returns void language plpgsql security definer set search_path = public, pgmq as $$
declare
  source_text text := left(trim(coalesce(input_text, '')), 12000);
  source_hash text := md5(source_text);
  chunk_no integer;
begin
  delete from public.activity_search_vectors
    where user_id = input_user_id and record_type = input_record_type and record_id = input_record_id;
  if source_text = '' then return; end if;
  for chunk_no in 0..((char_length(source_text) - 1) / 400) loop
    perform pgmq.send('activity_search_index', jsonb_build_object(
      'user_id', input_user_id, 'record_type', input_record_type,
      'record_id', input_record_id, 'chunk_no', chunk_no,
      'content_hash', source_hash
    ));
  end loop;
end;
$$;
revoke all on function public.activity_search_queue_text(uuid,text,text,text) from public,anon,authenticated;

create function public.activity_search_event_trigger() returns trigger
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
    then concat_ws(E'\n', nullif(trim(new.title),''),nullif(trim(new.body),'')) else '' end;
  if tg_op = 'UPDATE' then
    old_text := case when old.status='succeeded'
        and old.action_type not in ('create_general_task','update_general_task')
      then concat_ws(E'\n', nullif(trim(old.title),''),nullif(trim(old.body),'')) else '' end;
    if new_text is not distinct from old_text then return new; end if;
  end if;
  perform public.activity_search_queue_text(new.user_id,'activity',new.id::text,new_text);
  return new;
end;
$$;
revoke all on function public.activity_search_event_trigger() from public,anon,authenticated;
create trigger activity_search_event_changed after insert or update or delete on public.activity_events
  for each row execute function public.activity_search_event_trigger();

create function public.activity_search_task_trigger() returns trigger
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
    then concat_ws(E'\n',nullif(trim(new.title),''),nullif(trim(new.trigger_text),'')) else '' end;
  if tg_op = 'UPDATE' then
    old_text := case when old.kind='general'
      then concat_ws(E'\n',nullif(trim(old.title),''),nullif(trim(old.trigger_text),'')) else '' end;
    if new_text is not distinct from old_text then return new; end if;
  end if;
  perform public.activity_search_queue_text(new.user_id,'task',new.id::text,new_text);
  return new;
end;
$$;
revoke all on function public.activity_search_task_trigger() from public,anon,authenticated;
create trigger activity_search_task_changed after insert or update or delete on public.portfolio_tasks
  for each row execute function public.activity_search_task_trigger();

-- The cron job only dispatches when there is work. Visibility timeout retries a lost request.
-- Vault names must be configured per environment before the worker can run.
create function public.activity_search_dispatch() returns void
language plpgsql security definer set search_path = public, pgmq, extensions as $$
declare
  endpoint text;
  service_key text;
  message_row record;
begin
  select decrypted_secret into endpoint from vault.decrypted_secrets
    where name='activity_search_api_url' limit 1;
  select decrypted_secret into service_key from vault.decrypted_secrets
    where name='activity_search_service_role_key' limit 1;
  if endpoint is null or service_key is null then return; end if;
  for message_row in select * from pgmq.read('activity_search_index',120,3) loop
    if message_row.read_ct > 5 then
      perform pgmq.archive('activity_search_index',message_row.msg_id);
    else
      perform net.http_post(
        url := endpoint || '/functions/v1/activity-search-index',
        headers := jsonb_build_object('Content-Type','application/json',
          'Authorization','Bearer ' || service_key, 'apikey',service_key),
        body := jsonb_build_object('message_id',message_row.msg_id,'job',message_row.message),
        timeout_milliseconds := 30000
      );
    end if;
  end loop;
end;
$$;
revoke all on function public.activity_search_dispatch() from public,anon,authenticated;
select cron.schedule('activity-search-index','10 seconds',
  'select public.activity_search_dispatch()');

-- The service-role worker checks the current source and hash before inference.
create function public.app_get_activity_search_job(
  input_record_type text,input_record_id text,input_chunk_no integer,input_content_hash text
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  source_user uuid;
  source_text text;
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
  source_text := left(trim(coalesce(source_text,'')),12000);
  if source_user is null or md5(source_text)<>input_content_hash
      or input_chunk_no<0 or input_chunk_no*400>=char_length(source_text) then
    return jsonb_build_object('stale',true);
  end if;
  return jsonb_build_object('stale',false,'user_id',source_user,
    'excerpt',substr(source_text,input_chunk_no*400+1,400));
end;
$$;
revoke all on function public.app_get_activity_search_job(text,text,integer,text) from public,anon,authenticated;
grant execute on function public.app_get_activity_search_job(text,text,integer,text) to service_role;

create function public.app_finish_activity_search_job(
  input_message_id bigint,input_user_id uuid,input_record_type text,input_record_id text,
  input_chunk_no integer,input_content_hash text,input_excerpt text,
  input_embedding extensions.vector(384)
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
    input_chunk_no,input_content_hash);
  if current_job->>'stale'='true' or current_job->>'user_id'<>input_user_id::text
      or current_job->>'excerpt'<>input_excerpt then
    perform pgmq.delete('activity_search_index',input_message_id);
    return false;
  end if;
  insert into public.activity_search_vectors
    (user_id,record_type,record_id,chunk_no,model,content_hash,excerpt,embedding)
    values(input_user_id,input_record_type,input_record_id,input_chunk_no,
      'gte-small',input_content_hash,input_excerpt,input_embedding)
    on conflict(user_id,record_type,record_id,chunk_no) do update set
      model=excluded.model,content_hash=excluded.content_hash,
      excerpt=excluded.excerpt,embedding=excluded.embedding,embedded_at=now();
  perform pgmq.delete('activity_search_index',input_message_id);
  return true;
end;
$$;
revoke all on function public.app_finish_activity_search_job(bigint,uuid,text,text,integer,text,text,extensions.vector) from public,anon,authenticated;
grant execute on function public.app_finish_activity_search_job(bigint,uuid,text,text,integer,text,text,extensions.vector) to service_role;

create function public.app_ack_stale_activity_search_job(input_message_id bigint) returns void
language plpgsql security definer set search_path = public, pgmq as $$
begin
  perform pgmq.delete('activity_search_index',input_message_id);
end;
$$;
revoke all on function public.app_ack_stale_activity_search_job(bigint) from public,anon,authenticated;
grant execute on function public.app_ack_stale_activity_search_job(bigint) to service_role;

-- Existing rows are queued once. Subsequent writes use the triggers above.
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

-- The ranked query uses the same owner/feature boundaries as the ordinary feed.
-- A query cursor is bound to the exact filters and embedding model.
create function public.app_search_activities_ranked(
  input_query text,input_query_embedding extensions.vector(384) default null,
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
      and (input_instrument_id is null or task.subject->>'instrument_id'=input_instrument_id::text)
      and (cardinality(selected_tags)=0 or case when tag_match='all' then
        (select count(distinct rel.tag_id) from public.portfolio_task_activity_tags rel
          where rel.user_id=task.user_id and rel.task_id=task.id
            and rel.tag_id=any(selected_tags))=cardinality(selected_tags)
        else exists(select 1 from public.portfolio_task_activity_tags rel
          where rel.user_id=task.user_id and rel.task_id=task.id
            and rel.tag_id=any(selected_tags)) end)
      and (strpos(lower(concat_ws(' ',task.title,task.trigger_text)),query_text)>0
        or semantic.similarity>=0.96)
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
      and (input_instrument_id is null or event.instrument_id=input_instrument_id)
      and (cardinality(selected_tags)=0 or case when tag_match='all' then
        (select count(distinct rel.tag_id) from public.activity_event_tags rel
          where rel.user_id=event.user_id and rel.activity_event_id=event.id
            and rel.tag_id=any(selected_tags))=cardinality(selected_tags)
        else exists(select 1 from public.activity_event_tags rel
          where rel.user_id=event.user_id and rel.activity_event_id=event.id
            and rel.tag_id=any(selected_tags)) end)
      and (strpos(lower(concat_ws(' ',event.title,event.body)),query_text)>0
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
revoke all on function public.app_search_activities_ranked(text,extensions.vector,uuid,date,date,text,bigint,uuid[],text,integer,jsonb,text) from public,anon;
grant execute on function public.app_search_activities_ranked(text,extensions.vector,uuid,date,date,text,bigint,uuid[],text,integer,jsonb,text) to authenticated;

create function public.app_activity_search_index_coverage(input_owner_user_id uuid default null)
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
            and vector.model='gte-small' and vector.content_hash=
              md5(left(trim(concat_ws(E'\n',task.title,task.trigger_text)),12000)))
          < (char_length(left(trim(concat_ws(E'\n',task.title,task.trigger_text)),12000))+399)/400
    union all
    select event.id::text from public.activity_events event
      where event_access and event.user_id=selected_owner and event.status='succeeded'
        and event.action_type not in ('create_general_task','update_general_task')
        and (task_access or event.action_type<>'complete_general_task')
        and (select count(*) from public.activity_search_vectors vector
          where vector.user_id=event.user_id and vector.record_type='activity'
            and vector.record_id=event.id::text
            and vector.model='gte-small' and vector.content_hash=
              md5(left(trim(concat_ws(E'\n',event.title,event.body)),12000)))
          < (char_length(left(trim(concat_ws(E'\n',event.title,event.body)),12000))+399)/400
  ) missing;
  return jsonb_build_object('missing_count',missing_count);
end;
$$;
revoke all on function public.app_activity_search_index_coverage(uuid) from public,anon;
grant execute on function public.app_activity_search_index_coverage(uuid) to authenticated;
