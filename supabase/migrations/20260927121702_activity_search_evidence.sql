create or replace function public.app_search_activities_ranked(
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
        'matched_by',to_jsonb(array_remove(array[
          case when strpos(lower(concat_ws(' ',task.title,task.trigger_text)),query_text)>0 then 'keyword'::text end,
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
        'matched_by',to_jsonb(array_remove(array[
          case when strpos(lower(concat_ws(' ',event.title,event.body)),query_text)>0 then 'keyword'::text end,
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
revoke all on function public.app_search_activities_ranked(text,extensions.vector,uuid,date,date,text,bigint,uuid[],text,integer,jsonb,text) from public,anon;
grant execute on function public.app_search_activities_ranked(text,extensions.vector,uuid,date,date,text,bigint,uuid[],text,integer,jsonb,text) to authenticated;
