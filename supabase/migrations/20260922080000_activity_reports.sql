create table public.activity_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null default 1 check(version>0),
  period_kind text not null check(period_kind in ('daily','weekly','monthly')),
  period_start date not null,
  period_end date not null,
  timezone text not null,
  title text not null check(char_length(title) between 1 and 300),
  summary text not null check(char_length(summary) between 1 and 10000),
  highlights jsonb not null default '[]'::jsonb check(jsonb_typeof(highlights)='array'),
  open_items jsonb not null default '[]'::jsonb check(jsonb_typeof(open_items)='array'),
  source_event_ids bigint[] not null default '{}',
  source_task_ids uuid[] not null default '{}',
  source_decision_ids uuid[] not null default '{}',
  generated_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(period_start<=period_end)
);
create index activity_reports_user_period_idx on public.activity_reports(user_id,period_start desc,period_end desc,id desc);
create table public.activity_report_revisions (
  report_id uuid not null,
  user_id uuid not null,
  version integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(report_id,version),
  foreign key(report_id) references public.activity_reports(id) on delete cascade,
  foreign key(user_id) references auth.users(id) on delete cascade
);
create table public.activity_report_mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  response_payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(user_id,idempotency_key)
);
alter table public.activity_reports enable row level security;
alter table public.activity_report_revisions enable row level security;
alter table public.activity_report_mutation_receipts enable row level security;
create policy activity_reports_owner_select on public.activity_reports for select to authenticated using(user_id=auth.uid());
create policy activity_report_revisions_owner_select on public.activity_report_revisions for select to authenticated using(user_id=auth.uid());
revoke all on public.activity_reports,public.activity_report_revisions,public.activity_report_mutation_receipts from public,anon,authenticated;
grant select on public.activity_reports,public.activity_report_revisions to authenticated;

create function public.app_get_activity_report_context(
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
        event.before_data,event.after_data,event.occurred_at,event.occurrence_on
      from public.activity_events event
      where event.user_id=current_user_id and event.status='succeeded'
        and coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date) between input_period_start and input_period_end
        and (cursor_occurred_at is null or (event.occurred_at,event.id)<(cursor_occurred_at,cursor_id))
      order by event.occurred_at desc,event.id desc limit page_limit+1
    ), page as (select * from eligible order by occurred_at desc,id desc limit page_limit)
    select jsonb_build_object(
      'period',jsonb_build_object('start',input_period_start,'end',input_period_end,'timezone',input_timezone),
      'events',coalesce((select jsonb_agg(to_jsonb(item) order by item.occurred_at desc,item.id desc) from page item),'[]'::jsonb),
      'next_cursor',case when (select count(*) from eligible)>page_limit then (select jsonb_build_object('occurred_at',item.occurred_at,'id',item.id) from page item order by item.occurred_at,item.id limit 1) else null end,
      'current_open_tasks',coalesce((select jsonb_agg(jsonb_build_object('id',task.id,'kind',task.kind,'title',task.title,'due_date',task.due_date,'updated_at',task.updated_at) order by task.due_date nulls last,task.updated_at desc) from public.portfolio_tasks task where task.user_id=current_user_id and task.control_state='active' and ((task.kind='research' and task.research_state in ('open','waiting')) or task.kind in ('general','execution'))),'[]'::jsonb),
      'current_open_tasks_basis','current_at_request_not_historical_period_end',
      'decisions',coalesce((select jsonb_agg(jsonb_build_object('id',decision.id,'status',decision.status,'question',decision.question,'selected_option',decision.selected_option,'reason',decision.reason,'updated_at',decision.updated_at) order by decision.updated_at desc) from public.investment_decisions decision where decision.user_id=current_user_id and (decision.created_at at time zone input_timezone)::date<=input_period_end and (decision.updated_at at time zone input_timezone)::date>=input_period_start),'[]'::jsonb)
    )
  );
end; $$;

create function public.app_get_activity_report(input_report_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select to_jsonb(report) || jsonb_build_object('needs_regeneration',exists(
    select 1 from public.activity_events event where event.user_id=report.user_id and event.status='succeeded'
      and coalesce(event.occurrence_on,(event.occurred_at at time zone report.timezone)::date) between report.period_start and report.period_end
      and not(event.id=any(report.source_event_ids))
  ))
  from public.activity_reports report where report.id=input_report_id and report.user_id=auth.uid();
$$;

create function public.app_list_activity_reports(input_limit integer default 20,input_cursor jsonb default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare page_limit integer:=greatest(1,least(coalesce(input_limit,20),50)); cursor_generated_at timestamptz; cursor_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if input_cursor is not null then
    if jsonb_typeof(input_cursor)<>'object' or not(input_cursor?'generated_at') or not(input_cursor?'id') then raise exception 'Invalid activity report cursor'; end if;
    begin cursor_generated_at:=(input_cursor->>'generated_at')::timestamptz; cursor_id:=(input_cursor->>'id')::uuid;
    exception when others then raise exception 'Invalid activity report cursor'; end;
  end if;
  return (with eligible as (
    select report.* from public.activity_reports report where report.user_id=auth.uid()
      and (cursor_generated_at is null or (report.generated_at,report.id)<(cursor_generated_at,cursor_id))
    order by report.generated_at desc,report.id desc limit page_limit+1
  ), page as (select * from eligible order by generated_at desc,id desc limit page_limit)
  select jsonb_build_object('items',coalesce((select jsonb_agg(public.app_get_activity_report(item.id) order by item.generated_at desc,item.id desc) from page item),'[]'::jsonb),
    'next_cursor',case when (select count(*) from eligible)>page_limit then (select jsonb_build_object('generated_at',item.generated_at,'id',item.id) from page item order by item.generated_at,item.id limit 1) else null end));
end; $$;

create function public.app_save_activity_report(
  input_report_id uuid,input_expected_version integer,input_idempotency_key uuid,input_payload jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_user_id uuid:=auth.uid(); report_id uuid:=coalesce(input_report_id,gen_random_uuid()); current_report public.activity_reports%rowtype;
  receipt public.activity_report_mutation_receipts%rowtype; next_version integer; request_payload jsonb;
  period_kind text; period_start date; period_end date; report_timezone text; report_title text; report_summary text;
  report_highlights jsonb; report_open_items jsonb; event_ids bigint[]; task_ids uuid[]; decision_ids uuid[]; response jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if coalesce(jsonb_typeof(input_payload),'null')<>'object' then raise exception 'Report payload must be an object'; end if;
  period_kind:=lower(trim(coalesce(input_payload->>'period_kind',''))); period_start:=(input_payload->>'period_start')::date; period_end:=(input_payload->>'period_end')::date;
  report_timezone:=trim(coalesce(input_payload->>'timezone','')); report_title:=trim(coalesce(input_payload->>'title','')); report_summary:=trim(coalesce(input_payload->>'summary',''));
  report_highlights:=coalesce(input_payload->'highlights','[]'::jsonb); report_open_items:=coalesce(input_payload->'open_items','[]'::jsonb);
  select coalesce(array_agg(value::bigint),'{}') into event_ids from jsonb_array_elements_text(coalesce(input_payload->'source_event_ids','[]'::jsonb)) value;
  select coalesce(array_agg(value::uuid),'{}') into task_ids from jsonb_array_elements_text(coalesce(input_payload->'source_task_ids','[]'::jsonb)) value;
  select coalesce(array_agg(value::uuid),'{}') into decision_ids from jsonb_array_elements_text(coalesce(input_payload->'source_decision_ids','[]'::jsonb)) value;
  if period_kind not in ('daily','weekly','monthly') or period_start is null or period_end is null or period_start>period_end then raise exception 'Invalid report period'; end if;
  if (period_kind='daily' and period_end<>period_start) or (period_kind='weekly' and period_end-period_start>6) or (period_kind='monthly' and period_end-period_start>30) then raise exception 'Report period does not match its kind'; end if;
  if not exists(select 1 from pg_timezone_names where name=report_timezone) then raise exception 'Invalid timezone'; end if;
  if char_length(report_title) not between 1 and 300 or char_length(report_summary) not between 1 and 10000 then raise exception 'Report title or summary is invalid'; end if;
  if jsonb_typeof(report_highlights)<>'array' or jsonb_typeof(report_open_items)<>'array' then raise exception 'Report lists must be arrays'; end if;
  if (select count(*) from unnest(event_ids) id)<>(select count(*) from public.activity_events event where event.id=any(event_ids) and event.user_id=current_user_id and event.status='succeeded' and coalesce(event.occurrence_on,(event.occurred_at at time zone report_timezone)::date) between period_start and period_end) then raise exception 'Report source event is invalid'; end if;
  if (select count(*) from unnest(task_ids) id)<>(select count(*) from public.portfolio_tasks task where task.id=any(task_ids) and task.user_id=current_user_id) then raise exception 'Report source task is invalid'; end if;
  if (select count(*) from unnest(decision_ids) id)<>(select count(*) from public.investment_decisions decision where decision.id=any(decision_ids) and decision.user_id=current_user_id) then raise exception 'Report source decision is invalid'; end if;
  request_payload:=jsonb_build_object('report_id',input_report_id,'expected_version',input_expected_version,'payload',input_payload);
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':activity_report:'||input_idempotency_key::text,0));
  select * into receipt from public.activity_report_mutation_receipts where user_id=current_user_id and idempotency_key=input_idempotency_key;
  if found then if receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if; return receipt.response_payload; end if;
  if input_report_id is null then
    if input_expected_version is not null then raise exception 'New report cannot have expected version'; end if; next_version:=1;
    insert into public.activity_reports(id,user_id,version,period_kind,period_start,period_end,timezone,title,summary,highlights,open_items,source_event_ids,source_task_ids,source_decision_ids)
    values(report_id,current_user_id,1,period_kind,period_start,period_end,report_timezone,report_title,report_summary,report_highlights,report_open_items,event_ids,task_ids,decision_ids);
  else
    select * into current_report from public.activity_reports where id=input_report_id and user_id=current_user_id for update;
    if not found then raise exception 'Activity report was not found'; end if;
    if input_expected_version is null or current_report.version<>input_expected_version then raise exception 'Activity report version conflict'; end if;
    next_version:=current_report.version+1;
    update public.activity_reports set version=next_version,period_kind=period_kind,period_start=period_start,period_end=period_end,timezone=report_timezone,title=report_title,summary=report_summary,highlights=report_highlights,open_items=report_open_items,source_event_ids=event_ids,source_task_ids=task_ids,source_decision_ids=decision_ids,generated_at=clock_timestamp(),updated_at=clock_timestamp() where id=report_id and user_id=current_user_id;
  end if;
  insert into public.activity_report_revisions(report_id,user_id,version,snapshot) select report.id,report.user_id,report.version,to_jsonb(report) from public.activity_reports report where report.id=report_id;
  response:=public.app_get_activity_report(report_id);
  insert into public.activity_report_mutation_receipts(user_id,idempotency_key,request_payload,response_payload) values(current_user_id,input_idempotency_key,request_payload,response);
  return response;
end; $$;

revoke all on function public.app_get_activity_report_context(date,date,text,integer,jsonb),public.app_get_activity_report(uuid),public.app_list_activity_reports(integer,jsonb),public.app_save_activity_report(uuid,integer,uuid,jsonb) from public,anon;
grant execute on function public.app_get_activity_report_context(date,date,text,integer,jsonb),public.app_get_activity_report(uuid),public.app_list_activity_reports(integer,jsonb),public.app_save_activity_report(uuid,integer,uuid,jsonb) to authenticated;
