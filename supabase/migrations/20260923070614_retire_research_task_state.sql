-- The only current intent row is a general task; research/execution task state was retired.
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
        and (selected_owner=auth.uid() or event.record_kind not in ('research','review','decision','retrospective'))
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

create or replace function public.app_get_activity_report_context(
  input_period_start date,
  input_period_end date,
  input_timezone text,
  input_limit integer default 200,
  input_cursor jsonb default null
)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare current_user_id uuid:=auth.uid(); page_limit integer:=greatest(1,least(coalesce(input_limit,200),500));
  cursor_occurred_at timestamptz; cursor_id bigint;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if input_period_start is null or input_period_end is null or input_period_start>input_period_end or input_period_end-input_period_start>366 then raise exception 'Invalid report period'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'occurred_at') or not(input_cursor?'id') then raise exception 'Invalid report context cursor'; end if;
    begin cursor_occurred_at:=(input_cursor->>'occurred_at')::timestamptz; cursor_id:=(input_cursor->>'id')::bigint;
    exception when others then raise exception 'Invalid report context cursor'; end;
  end if;
  return (
    with eligible as (
      select event.id,event.source,event.action_type,event.target_table,event.target_id,event.task_id,
        event.title,event.note,event.result,event.conclusion,event.instrument_id,event.account_id,
        event.before_data,event.after_data,event.occurred_at,event.occurrence_on,event.updated_at,event.version,
        coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
          from public.activity_event_tags relation join public.activity_tags tag
            on tag.user_id=relation.user_id and tag.id=relation.tag_id
          where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb) tags
      from public.activity_events event
      where event.user_id=current_user_id and event.status='succeeded'
        and event.record_kind <> 'retrospective'
        and event.action_type not in ('create_general_task','update_general_task')
        and coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date) between input_period_start and input_period_end
        and (cursor_occurred_at is null or (event.occurred_at,event.id)<(cursor_occurred_at,cursor_id))
      order by event.occurred_at desc,event.id desc limit page_limit+1
    ), page as (select * from eligible order by occurred_at desc,id desc limit page_limit)
    select jsonb_build_object(
      'period',jsonb_build_object('start',input_period_start,'end',input_period_end,'timezone',input_timezone),
      'events',coalesce((select jsonb_agg(to_jsonb(item) order by item.occurred_at desc,item.id desc) from page item),'[]'::jsonb),
      'next_cursor',case when (select count(*) from eligible)>page_limit then (select jsonb_build_object('occurred_at',item.occurred_at,'id',item.id) from page item order by item.occurred_at,item.id limit 1) else null end,
      'current_open_tasks',coalesce((select jsonb_agg(jsonb_build_object('id',task.id,'kind',task.kind,'title',task.title,'due_date',task.due_date,'updated_at',task.updated_at) order by task.due_date nulls last,task.updated_at desc) from public.portfolio_tasks task where task.user_id=current_user_id and task.control_state='active' and task.kind='general'),'[]'::jsonb),
      'current_open_tasks_basis','current_at_request_not_historical_period_end',
      'decisions',coalesce((select jsonb_agg(jsonb_build_object('id',event.id,'status',event.after_data->'context'->>'decision_state','question',event.title,'selected_option',event.after_data->'context'->>'selected_option','reason',event.after_data->'context'->>'reason','updated_at',event.updated_at) order by event.occurred_at desc,event.id desc)
        from public.activity_events event where event.user_id=current_user_id and event.status='succeeded' and event.record_kind='decision'
          and coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date) between input_period_start and input_period_end),'[]'::jsonb)
    )
  );
end; $$;

revoke all on function public.app_get_activity_report_context(date,date,text,integer,jsonb) from public,anon;
grant execute on function public.app_get_activity_report_context(date,date,text,integer,jsonb) to authenticated;

alter table public.portfolio_tasks drop constraint portfolio_tasks_kind_state_check;
alter table public.portfolio_tasks drop column research_state;
