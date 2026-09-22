create extension if not exists vector with schema extensions;

create table public.activity_embeddings (
    user_id uuid not null references auth.users(id) on delete cascade,
    activity_event_id bigint not null,
    model text not null check (char_length(model) between 1 and 100),
    content_hash text not null check (char_length(content_hash) = 32),
    embedding extensions.vector(384) not null,
    embedded_at timestamptz not null default clock_timestamp(),
    primary key (user_id, activity_event_id),
    foreign key (user_id, activity_event_id) references public.activity_events(user_id, id) on delete cascade
);

alter table public.activity_embeddings enable row level security;
create policy activity_embeddings_select_own on public.activity_embeddings
    for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.activity_embeddings from public, anon, authenticated;
grant select on public.activity_embeddings to authenticated;

create index activity_embeddings_hnsw_idx
    on public.activity_embeddings using hnsw (embedding extensions.vector_cosine_ops);

create or replace function public.activity_embedding_text(input_event public.activity_events)
returns text
language sql
immutable
set search_path = public
as $$
    select left(concat_ws(E'\n',
      nullif(trim(input_event.title),''),
      nullif(trim(input_event.note),''),
      nullif(trim(input_event.result),''),
      nullif(trim(input_event.conclusion),''),
      nullif(trim(input_event.after_data->>'question'),''),
      nullif(trim(input_event.after_data->>'selected_option'),''),
      nullif(trim(input_event.after_data->>'reason'),'')
    ),12000);
$$;

create or replace function public.activity_embedding_hash(input_event public.activity_events)
returns text
language sql
immutable
set search_path = public
as $$
    select md5(public.activity_embedding_text(input_event));
$$;

create or replace function public.app_list_activity_embedding_jobs(input_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
      'activity_id',event.id,
      'content',public.activity_embedding_text(event),
      'content_hash',public.activity_embedding_hash(event),
      'updated_at',event.updated_at
    ) order by event.updated_at desc,event.id desc),'[]'::jsonb)
    from (
      select event.*
      from public.activity_events event
      left join public.activity_embeddings embedding
        on embedding.user_id=event.user_id and embedding.activity_event_id=event.id
      where event.user_id=auth.uid() and event.status='succeeded'
        and event.action_type not in ('create_general_task','update_general_task')
        and public.activity_embedding_text(event)<>''
        and (embedding.activity_event_id is null or embedding.content_hash<>public.activity_embedding_hash(event))
      order by event.updated_at desc,event.id desc
      limit greatest(1,least(coalesce(input_limit,20),50))
    ) event;
$$;

create or replace function public.app_upsert_activity_embedding(
    input_activity_id bigint,
    input_content_hash text,
    input_model text,
    input_embedding extensions.vector(384)
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid:=auth.uid();
    current_event public.activity_events%rowtype;
    normalized_model text:=trim(coalesce(input_model,''));
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if char_length(normalized_model) not between 1 and 100 then raise exception 'Embedding model is required'; end if;
    select * into current_event from public.activity_events event
      where event.id=input_activity_id and event.user_id=current_user_id and event.status='succeeded';
    if not found then raise exception 'Activity was not found'; end if;
    if input_content_hash<>public.activity_embedding_hash(current_event) then raise exception 'Activity embedding content changed'; end if;
    insert into public.activity_embeddings(user_id,activity_event_id,model,content_hash,embedding)
    values(current_user_id,input_activity_id,normalized_model,input_content_hash,input_embedding)
    on conflict(user_id,activity_event_id) do update set
      model=excluded.model,content_hash=excluded.content_hash,embedding=excluded.embedding,embedded_at=clock_timestamp();
    return jsonb_build_object('activity_id',input_activity_id,'content_hash',input_content_hash,'model',normalized_model,'embedded',true);
end;
$$;

create or replace function public.app_search_activity_semantic(
    input_query_embedding extensions.vector(384),
    input_owner_user_id uuid default null,
    input_from date default null,
    input_to date default null,
    input_has_conclusion boolean default null,
    input_instrument_id bigint default null,
    input_account_id bigint default null,
    input_tag_ids uuid[] default null,
    input_tag_match text default 'all',
    input_limit integer default 30,
    input_timezone text default 'Asia/Seoul'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
    selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
    selected_tag_ids uuid[]:=coalesce(input_tag_ids,array[]::uuid[]);
    normalized_tag_match text:=lower(trim(coalesce(input_tag_match,'all')));
    page_limit integer:=greatest(1,least(coalesce(input_limit,30),100));
    activity_allowed boolean;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    if normalized_tag_match not in ('all','any') then raise exception 'Invalid activity tag match'; end if;
    if input_from is not null and input_to is not null and input_from>input_to then raise exception 'Invalid activity search date range'; end if;
    if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
    activity_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'activity');
    if not activity_allowed then return jsonb_build_object('items','[]'::jsonb); end if;
    return jsonb_build_object('items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'record_state','done','record_type','activity','record_id',event.id::text,
        'activity_id',event.id,'task_id',event.task_id,'task_kind',null,
        'title',coalesce(event.title,event.after_data->>'title',event.after_data->>'question',event.action_type),
        'note',event.note,'result',event.result,'conclusion',event.conclusion,'action_type',event.action_type,
        'occurred_at',event.occurred_at,'created_at',event.created_at,'updated_at',event.updated_at,'version',event.version,
        'tags',coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name) order by lower(tag.name),tag.id) from public.activity_event_tags relation join public.activity_tags tag on tag.user_id=relation.user_id and tag.id=relation.tag_id where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb),
        'semantic_score',1-(event.embedding <=> input_query_embedding)
      ) order by event.embedding <=> input_query_embedding,event.occurred_at desc,event.id desc)
      from (
        select event.*,embedding.embedding
        from public.activity_events event
        join public.activity_embeddings embedding on embedding.user_id=event.user_id and embedding.activity_event_id=event.id
          and embedding.content_hash=public.activity_embedding_hash(event)
        where event.user_id=selected_owner and event.status='succeeded'
          and event.action_type not in ('create_general_task','update_general_task')
          and (input_from is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)>=input_from)
          and (input_to is null or coalesce(event.occurrence_on,(event.occurred_at at time zone input_timezone)::date)<=input_to)
          and (input_has_conclusion is null or (event.conclusion is not null)=input_has_conclusion)
          and (input_instrument_id is null or event.instrument_id=input_instrument_id)
          and (input_account_id is null or event.account_id=input_account_id)
          and (cardinality(selected_tag_ids)=0 or case when normalized_tag_match='all' then
            (select count(distinct relation.tag_id) from public.activity_event_tags relation where relation.user_id=event.user_id and relation.activity_event_id=event.id and relation.tag_id=any(selected_tag_ids))=cardinality(selected_tag_ids)
            else exists(select 1 from public.activity_event_tags relation where relation.user_id=event.user_id and relation.activity_event_id=event.id and relation.tag_id=any(selected_tag_ids)) end)
        order by embedding.embedding <=> input_query_embedding,event.occurred_at desc,event.id desc
        limit page_limit
      ) event
    ),'[]'::jsonb));
end;
$$;

revoke all on function public.activity_embedding_text(public.activity_events) from public,anon,authenticated;
revoke all on function public.activity_embedding_hash(public.activity_events) from public,anon,authenticated;
revoke all on function public.app_list_activity_embedding_jobs(integer) from public,anon;
revoke all on function public.app_upsert_activity_embedding(bigint,text,text,extensions.vector) from public,anon;
revoke all on function public.app_search_activity_semantic(extensions.vector,uuid,date,date,boolean,bigint,bigint,uuid[],text,integer,text) from public,anon;
grant execute on function public.app_list_activity_embedding_jobs(integer) to authenticated;
grant execute on function public.app_upsert_activity_embedding(bigint,text,text,extensions.vector) to authenticated;
grant execute on function public.app_search_activity_semantic(extensions.vector,uuid,date,date,boolean,bigint,bigint,uuid[],text,integer,text) to authenticated;
