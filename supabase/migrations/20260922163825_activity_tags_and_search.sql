create table public.activity_tags (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    version integer not null default 1 check (version > 0),
    name text not null check (char_length(trim(name)) between 1 and 50),
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    unique (user_id, id)
);
create unique index activity_tags_user_name_key on public.activity_tags(user_id, lower(trim(name)));

create table public.activity_event_tags (
    user_id uuid not null references auth.users(id) on delete cascade,
    activity_event_id bigint not null,
    tag_id uuid not null,
    created_at timestamptz not null default clock_timestamp(),
    primary key (user_id, activity_event_id, tag_id),
    foreign key (user_id, activity_event_id) references public.activity_events(user_id, id) on delete cascade,
    foreign key (user_id, tag_id) references public.activity_tags(user_id, id) on delete cascade
);

create table public.portfolio_task_activity_tags (
    user_id uuid not null references auth.users(id) on delete cascade,
    task_id uuid not null,
    tag_id uuid not null,
    created_at timestamptz not null default clock_timestamp(),
    primary key (user_id, task_id, tag_id),
    foreign key (user_id, task_id) references public.portfolio_tasks(user_id, id) on delete cascade,
    foreign key (user_id, tag_id) references public.activity_tags(user_id, id) on delete cascade
);

alter table public.activity_tags enable row level security;
alter table public.activity_event_tags enable row level security;
alter table public.portfolio_task_activity_tags enable row level security;
create policy activity_tags_select_own on public.activity_tags for select to authenticated using ((select auth.uid()) = user_id);
create policy activity_event_tags_select_own on public.activity_event_tags for select to authenticated using ((select auth.uid()) = user_id);
create policy portfolio_task_activity_tags_select_own on public.portfolio_task_activity_tags for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.activity_tags, public.activity_event_tags, public.portfolio_task_activity_tags from public, anon, authenticated;
grant select on public.activity_tags, public.activity_event_tags, public.portfolio_task_activity_tags to authenticated;

create or replace function public.copy_general_task_tags_to_activity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.action_type = 'complete_general_task' and new.task_id is not null then
        insert into public.activity_event_tags(user_id, activity_event_id, tag_id)
        select new.user_id, new.id, relation.tag_id
        from public.portfolio_task_activity_tags relation
        where relation.user_id = new.user_id and relation.task_id = new.task_id
        on conflict do nothing;
    end if;
    return new;
end;
$$;

create trigger activity_events_copy_general_task_tags
after insert on public.activity_events
for each row execute function public.copy_general_task_tags_to_activity();

alter function public.app_get_activity(bigint, uuid) rename to app_get_activity_without_tags;

create function public.app_get_activity(
    input_activity_id bigint,
    input_owner_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
    base_activity jsonb;
begin
    base_activity:=public.app_get_activity_without_tags(input_activity_id,input_owner_user_id);
    if base_activity is null then return null; end if;
    return base_activity || jsonb_build_object('tags',coalesce((
      select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id)
      from public.activity_event_tags relation
      join public.activity_tags tag on tag.user_id=relation.user_id and tag.id=relation.tag_id
      where relation.user_id=selected_owner and relation.activity_event_id=input_activity_id
    ),'[]'::jsonb));
end;
$$;

create or replace function public.app_list_activity_tags(input_query text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', tag.id, 'version', tag.version, 'name', tag.name,
        'activity_count', (select count(*) from public.activity_event_tags relation where relation.user_id=tag.user_id and relation.tag_id=tag.id),
        'task_count', (select count(*) from public.portfolio_task_activity_tags relation where relation.user_id=tag.user_id and relation.tag_id=tag.id),
        'created_at', tag.created_at, 'updated_at', tag.updated_at
    ) order by lower(tag.name), tag.id), '[]'::jsonb)
    from public.activity_tags tag
    where tag.user_id = auth.uid()
      and (nullif(trim(coalesce(input_query, '')), '') is null
        or strpos(lower(tag.name), lower(trim(input_query))) > 0);
$$;

create or replace function public.app_save_activity_tag(
    input_tag_id uuid,
    input_expected_version integer,
    input_idempotency_key uuid,
    input_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_name text := trim(coalesce(input_name, ''));
    current_tag public.activity_tags%rowtype;
    stored_receipt public.activity_mutation_receipts%rowtype;
    tag_id uuid := coalesce(input_tag_id, gen_random_uuid());
    next_version integer;
    request_payload jsonb;
    response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if char_length(normalized_name) not between 1 and 50 then raise exception 'Activity tag name is required and must be at most 50 characters'; end if;
    request_payload := jsonb_build_object('tag_id', input_tag_id, 'expected_version', input_expected_version, 'name', normalized_name);
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':save_activity_tag:' || input_idempotency_key::text, 0));
    select * into stored_receipt from public.activity_mutation_receipts
    where user_id=current_user_id and operation='save_activity_tag' and idempotency_key=input_idempotency_key;
    if found then
        if stored_receipt.request_payload <> request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
        return stored_receipt.response_payload;
    end if;
    if input_tag_id is null then
        if input_expected_version is not null then raise exception 'New activity tag cannot have expected version'; end if;
        next_version := 1;
        insert into public.activity_tags(id,user_id,name) values(tag_id,current_user_id,normalized_name);
    else
        select * into current_tag from public.activity_tags tag where tag.id=input_tag_id and tag.user_id=current_user_id for update;
        if not found then raise exception 'Activity tag was not found'; end if;
        if input_expected_version is null or current_tag.version<>input_expected_version then raise exception 'Activity tag version conflict'; end if;
        next_version := current_tag.version+1;
        update public.activity_tags set name=normalized_name,version=next_version,updated_at=clock_timestamp()
        where id=input_tag_id and user_id=current_user_id;
    end if;
    select jsonb_build_object('id',tag.id,'version',tag.version,'name',tag.name,'created_at',tag.created_at,'updated_at',tag.updated_at)
    into response_payload from public.activity_tags tag where tag.id=tag_id and tag.user_id=current_user_id;
    insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(current_user_id,'save_activity_tag',input_idempotency_key,request_payload,response_payload);
    return response_payload;
exception when unique_violation then
    raise exception 'Activity tag name already exists';
end;
$$;

create or replace function public.app_delete_activity_tag(
    input_tag_id uuid,
    input_expected_version integer,
    input_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    current_tag public.activity_tags%rowtype;
    stored_receipt public.activity_mutation_receipts%rowtype;
    request_payload jsonb;
    response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    request_payload := jsonb_build_object('tag_id',input_tag_id,'expected_version',input_expected_version);
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':delete_activity_tag:' || input_idempotency_key::text, 0));
    select * into stored_receipt from public.activity_mutation_receipts
    where user_id=current_user_id and operation='delete_activity_tag' and idempotency_key=input_idempotency_key;
    if found then
        if stored_receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
        return stored_receipt.response_payload;
    end if;
    select * into current_tag from public.activity_tags tag where tag.id=input_tag_id and tag.user_id=current_user_id for update;
    if not found then raise exception 'Activity tag was not found'; end if;
    if input_expected_version is null or current_tag.version<>input_expected_version then raise exception 'Activity tag version conflict'; end if;
    delete from public.activity_tags where id=input_tag_id and user_id=current_user_id;
    response_payload := jsonb_build_object('id',input_tag_id,'deleted',true);
    insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(current_user_id,'delete_activity_tag',input_idempotency_key,request_payload,response_payload);
    return response_payload;
end;
$$;

create or replace function public.app_set_activity_tags(
    input_activity_id bigint,
    input_expected_version integer,
    input_tag_ids uuid[],
    input_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    current_event public.activity_events%rowtype;
    normalized_tag_ids uuid[] := coalesce(input_tag_ids, array[]::uuid[]);
    stored_receipt public.activity_mutation_receipts%rowtype;
    request_payload jsonb;
    response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if cardinality(normalized_tag_ids) > 20 then raise exception 'An activity can have at most 20 tags'; end if;
    if cardinality(normalized_tag_ids) <> (select count(distinct value) from unnest(normalized_tag_ids) value) then raise exception 'Activity tag IDs must be unique'; end if;
    request_payload := jsonb_build_object('activity_id',input_activity_id,'expected_version',input_expected_version,'tag_ids',to_jsonb(normalized_tag_ids));
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':set_activity_tags:' || input_idempotency_key::text, 0));
    select * into stored_receipt from public.activity_mutation_receipts
    where user_id=current_user_id and operation='set_activity_tags' and idempotency_key=input_idempotency_key;
    if found then
        if stored_receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
        return stored_receipt.response_payload;
    end if;
    select * into current_event from public.activity_events event where event.id=input_activity_id and event.user_id=current_user_id for update;
    if not found then raise exception 'Activity was not found'; end if;
    if current_event.version<>input_expected_version then raise exception 'Activity version conflict'; end if;
    if (select count(*) from public.activity_tags tag where tag.user_id=current_user_id and tag.id=any(normalized_tag_ids))<>cardinality(normalized_tag_ids) then raise exception 'Activity tag was not found'; end if;
    delete from public.activity_event_tags where user_id=current_user_id and activity_event_id=input_activity_id and not(tag_id=any(normalized_tag_ids));
    insert into public.activity_event_tags(user_id,activity_event_id,tag_id)
    select current_user_id,input_activity_id,value from unnest(normalized_tag_ids) value on conflict do nothing;
    update public.activity_events set version=version+1,updated_at=clock_timestamp() where id=input_activity_id and user_id=current_user_id;
    response_payload := public.app_get_activity(input_activity_id,null);
    insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(current_user_id,'set_activity_tags',input_idempotency_key,request_payload,response_payload);
    return response_payload;
end;
$$;

create or replace function public.app_set_general_task_tags(
    input_task_id uuid,
    input_expected_version integer,
    input_tag_ids uuid[],
    input_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_tag_ids uuid[] := coalesce(input_tag_ids,array[]::uuid[]);
    current_task public.portfolio_tasks%rowtype;
    stored_receipt public.general_task_mutation_receipts%rowtype;
    request_payload jsonb;
    response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if cardinality(normalized_tag_ids)>20 then raise exception 'A task can have at most 20 tags'; end if;
    if cardinality(normalized_tag_ids)<>(select count(distinct value) from unnest(normalized_tag_ids) value) then raise exception 'Activity tag IDs must be unique'; end if;
    request_payload:=jsonb_build_object('task_id',input_task_id,'expected_version',input_expected_version,'tag_ids',to_jsonb(normalized_tag_ids));
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':set_general_task_tags:' || input_idempotency_key::text,0));
    select * into stored_receipt from public.general_task_mutation_receipts where user_id=current_user_id and operation='set_general_task_tags' and idempotency_key=input_idempotency_key;
    if found then
        if stored_receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
        return stored_receipt.response_payload;
    end if;
    select * into current_task from public.portfolio_tasks task where task.id=input_task_id and task.user_id=current_user_id and task.kind='general' for update;
    if not found then raise exception 'General task was not found'; end if;
    if current_task.version<>input_expected_version then raise exception 'General task version conflict'; end if;
    if (select count(*) from public.activity_tags tag where tag.user_id=current_user_id and tag.id=any(normalized_tag_ids))<>cardinality(normalized_tag_ids) then raise exception 'Activity tag was not found'; end if;
    delete from public.portfolio_task_activity_tags where user_id=current_user_id and task_id=input_task_id and not(tag_id=any(normalized_tag_ids));
    insert into public.portfolio_task_activity_tags(user_id,task_id,tag_id)
    select current_user_id,input_task_id,value from unnest(normalized_tag_ids) value on conflict do nothing;
    update public.portfolio_tasks set updated_at=clock_timestamp() where id=input_task_id and user_id=current_user_id;
    response_payload:=jsonb_build_object('task_id',input_task_id,'version',current_task.version,'tags',coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id) from public.portfolio_task_activity_tags relation join public.activity_tags tag on tag.user_id=relation.user_id and tag.id=relation.tag_id where relation.user_id=current_user_id and relation.task_id=input_task_id),'[]'::jsonb));
    insert into public.general_task_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(current_user_id,'set_general_task_tags',input_idempotency_key,request_payload,response_payload);
    return response_payload;
end;
$$;

create or replace function public.app_search_activities(
    input_owner_user_id uuid default null,
    input_query text default null,
    input_from date default null,
    input_to date default null,
    input_record_state text default 'all',
    input_has_conclusion boolean default null,
    input_instrument_id bigint default null,
    input_account_id bigint default null,
    input_tag_ids uuid[] default null,
    input_tag_match text default 'all',
    input_limit integer default 30,
    input_cursor jsonb default null,
    input_timezone text default 'Asia/Seoul'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
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
      select 'todo'::text record_state,'task'::text record_type,task.id::text record_id,null::bigint activity_id,task.id task_id,task.kind task_kind,
        task.title,null::text note,null::text result,null::text conclusion,null::text action_type,
        task.due_date,null::timestamptz occurred_at,task.created_at,task.updated_at,task.updated_at sort_at,'task:'||task.id::text record_key,
        task.version,task.subject,
        coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id) from public.portfolio_task_activity_tags relation join public.activity_tags tag on tag.user_id=relation.user_id and tag.id=relation.tag_id where relation.user_id=task.user_id and relation.task_id=task.id),'[]'::jsonb) tags
      from public.portfolio_tasks task
      left join public.general_task_occurrence_states state on state.user_id=task.user_id and state.task_id=task.id and state.occurrence_key=case when task.recurrence_kind='daily' then (clock_timestamp() at time zone task.timezone)::date else date '0001-01-01' end
      where tasks_allowed and normalized_state in ('all','todo') and task.user_id=selected_owner and task.control_state='active'
        and ((task.kind='general' and coalesce(state.status,'open')='open') or (task.kind='research' and task.research_state in ('open','waiting')) or task.kind='execution')
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
      select 'done'::text record_state,'activity'::text record_type,event.id::text record_id,event.id activity_id,event.task_id,null::text task_kind,
        coalesce(event.title,event.after_data->>'title',event.after_data->>'question',event.action_type) title,event.note,event.result,event.conclusion,event.action_type,
        null::date due_date,event.occurred_at,event.created_at,event.updated_at,event.occurred_at sort_at,'activity:'||event.id::text record_key,
        event.version,null::jsonb subject,
        coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id) from public.activity_event_tags relation join public.activity_tags tag on tag.user_id=relation.user_id and tag.id=relation.tag_id where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb) tags
      from public.activity_events event
      where activity_allowed and normalized_state in ('all','done') and event.user_id=selected_owner and event.status='succeeded'
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
$$;

revoke all on function public.app_get_activity_without_tags(bigint,uuid) from public,anon,authenticated;
revoke all on function public.app_get_activity(bigint,uuid) from public,anon;
revoke all on function public.app_list_activity_tags(text) from public,anon;
revoke all on function public.app_save_activity_tag(uuid,integer,uuid,text) from public,anon;
revoke all on function public.app_delete_activity_tag(uuid,integer,uuid) from public,anon;
revoke all on function public.app_set_activity_tags(bigint,integer,uuid[],uuid) from public,anon;
revoke all on function public.app_set_general_task_tags(uuid,integer,uuid[],uuid) from public,anon;
revoke all on function public.app_search_activities(uuid,text,date,date,text,boolean,bigint,bigint,uuid[],text,integer,jsonb,text) from public,anon;
grant execute on function public.app_get_activity(bigint,uuid) to authenticated;
grant execute on function public.app_list_activity_tags(text) to authenticated;
grant execute on function public.app_save_activity_tag(uuid,integer,uuid,text) to authenticated;
grant execute on function public.app_delete_activity_tag(uuid,integer,uuid) to authenticated;
grant execute on function public.app_set_activity_tags(bigint,integer,uuid[],uuid) to authenticated;
grant execute on function public.app_set_general_task_tags(uuid,integer,uuid[],uuid) to authenticated;
grant execute on function public.app_search_activities(uuid,text,date,date,text,boolean,bigint,bigint,uuid[],text,integer,jsonb,text) to authenticated;
