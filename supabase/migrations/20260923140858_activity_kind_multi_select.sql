-- Multiple kinds use OR; date, keyword and other filters still use AND.
-- Preserve the optional single-kind argument for existing clients.
drop function public.app_search_activities(uuid,text,date,date,text,boolean,bigint,bigint,uuid[],text,integer,jsonb,text,text);

CREATE OR REPLACE FUNCTION public.app_search_activities(input_owner_user_id uuid DEFAULT NULL::uuid, input_query text DEFAULT NULL::text, input_from date DEFAULT NULL::date, input_to date DEFAULT NULL::date, input_record_state text DEFAULT 'all'::text, input_has_conclusion boolean DEFAULT NULL::boolean, input_instrument_id bigint DEFAULT NULL::bigint, input_account_id bigint DEFAULT NULL::bigint, input_tag_ids uuid[] DEFAULT NULL::uuid[], input_tag_match text DEFAULT 'all'::text, input_limit integer DEFAULT 30, input_cursor jsonb DEFAULT NULL::jsonb, input_timezone text DEFAULT 'Asia/Seoul'::text, input_record_kind text DEFAULT 'all'::text, input_record_kinds text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
    normalized_query text:=nullif(lower(trim(coalesce(input_query,''))),'');
    normalized_state text:=lower(trim(coalesce(input_record_state,'all')));
    normalized_kind text:=lower(trim(coalesce(input_record_kind,'all')));
    selected_kinds text[];
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
    if normalized_kind not in ('all','task','general','research','review','decision','retrospective','trade','reconciliation') then raise exception 'Invalid activity record kind'; end if;
    if input_record_kinds is not null and exists(select 1 from unnest(input_record_kinds) k where k is null or lower(trim(k)) not in ('task','general','research','review','decision','retrospective','trade','reconciliation')) then
      raise exception 'Invalid activity record kinds';
    end if;
    select coalesce(array_agg(distinct lower(trim(k))),array[]::text[]) into selected_kinds
    from unnest(coalesce(input_record_kinds,case when normalized_kind='all' then array[]::text[] else array[normalized_kind] end)) k;
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
        task.version,task.subject,false shared_review,null::jsonb context,
        coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id) from public.portfolio_task_activity_tags relation join public.activity_tags tag on tag.user_id=relation.user_id and tag.id=relation.tag_id where relation.user_id=task.user_id and relation.task_id=task.id),'[]'::jsonb) tags
      from public.portfolio_tasks task
      left join public.general_task_occurrence_states state on state.user_id=task.user_id and state.task_id=task.id and state.occurrence_key=case when task.recurrence_kind='daily' then (clock_timestamp() at time zone task.timezone)::date else date '0001-01-01' end
      where tasks_allowed and (cardinality(selected_kinds)=0 or 'task'=any(selected_kinds)) and normalized_state in ('all','todo') and task.user_id=selected_owner and task.control_state='active'
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
        event.version,null::jsonb subject,false shared_review,null::jsonb context,
        coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id) from public.activity_event_tags relation join public.activity_tags tag on tag.user_id=relation.user_id and tag.id=relation.tag_id where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb) tags
      from public.activity_events event
      where activity_allowed and normalized_state in ('all','done') and event.user_id=selected_owner and event.status='succeeded'
        and (selected_owner=auth.uid() or event.record_kind not in ('research','review','decision','retrospective','trade','reconciliation'))
        and (cardinality(selected_kinds)=0 or coalesce(event.record_kind,'general')=any(selected_kinds))
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
    ), shared_reviews as (
      -- Keep the narrative sharing allowlist: no note, sources, tags, task links or financial IDs.
      select 'done'::text record_state,'activity'::text record_type,event.id::text record_id,event.id activity_id,null::uuid task_id,
        event.title,null::text note,event.result,event.conclusion,event.action_type,event.record_kind,
        null::date due_date,event.occurred_at,null::timestamptz created_at,event.updated_at,event.occurred_at sort_at,'activity:'||event.id::text record_key,
        null::integer version,null::jsonb subject,true shared_review,
        jsonb_strip_nulls(jsonb_build_object(
          'status',case when event.after_data#>>'{context,status}' in ('no_action','attention','insufficient_data') then event.after_data#>>'{context,status}' end,
          'coverage_status',case when event.after_data#>>'{context,coverage_status}' in ('complete','partial','failed') then event.after_data#>>'{context,coverage_status}' end
        )) context,'[]'::jsonb tags
      from public.activity_events event
      where selected_owner<>auth.uid() and public.can_view_feature(selected_owner,'briefings')
        and event.user_id=selected_owner and event.status='succeeded' and event.action_type='record_manual_activity' and event.record_kind='review'
        and normalized_state in ('all','done') and (cardinality(selected_kinds)=0 or 'review'=any(selected_kinds))
        and input_account_id is null and input_instrument_id is null and cardinality(selected_tag_ids)=0
        and (input_from is null or (event.occurred_at at time zone input_timezone)::date>=input_from)
        and (input_to is null or (event.occurred_at at time zone input_timezone)::date<=input_to)
        and (input_has_conclusion is null or (event.conclusion is not null)=input_has_conclusion)
        and (normalized_query is null or strpos(lower(concat_ws(' ',event.title,event.result,event.conclusion)),normalized_query)>0)
    ), combined as (
      select * from task_rows union all select * from event_rows union all select * from shared_reviews
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

revoke all on function public.app_search_activities(uuid,text,date,date,text,boolean,bigint,bigint,uuid[],text,integer,jsonb,text,text,text[]) from public,anon;
grant execute on function public.app_search_activities(uuid,text,date,date,text,boolean,bigint,bigint,uuid[],text,integer,jsonb,text,text,text[]) to authenticated;

-- The timeline must carry the persisted kind and current narrative to its cards.
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
          event.record_kind,event.title,event.note,event.result,event.conclusion,
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
