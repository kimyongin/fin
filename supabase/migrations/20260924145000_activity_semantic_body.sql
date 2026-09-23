-- Embeddings index only the user-facing record, not private execution JSON.
create or replace function public.activity_embedding_text(input_event public.activity_events)
returns text language sql immutable set search_path=public as $$
  select left(concat_ws(E'\n',nullif(trim(input_event.title),''),nullif(trim(input_event.body),'')),12000);
$$;

drop function public.app_search_activity_semantic(extensions.vector,uuid,date,date,boolean,bigint,bigint,uuid[],text,integer,text);
create function public.app_search_activity_semantic(
  input_query_embedding extensions.vector(384),input_owner_user_id uuid default null,
  input_from date default null,input_to date default null,
  input_instrument_id bigint default null,input_account_id bigint default null,
  input_holding_id bigint default null,input_tag_ids uuid[] default null,
  input_tag_match text default 'any',input_limit integer default 30,
  input_timezone text default 'Asia/Seoul'
) returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare
  selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
  selected_tags uuid[]:=coalesce(input_tag_ids,array[]::uuid[]);
  tag_match text:=lower(trim(coalesce(input_tag_match,'any')));
  page_limit integer:=greatest(1,least(coalesce(input_limit,30),100));
  tasks_allowed boolean;
  assets_allowed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if tag_match not in ('any','all') then raise exception 'Invalid activity tag match'; end if;
  if cardinality(selected_tags)>20 or array_position(selected_tags,null) is not null then raise exception 'Invalid activity tags'; end if;
  if input_from is not null and input_to is not null and input_from>input_to then raise exception 'Invalid activity search date range'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
  if selected_owner<>auth.uid() and not public.can_view_feature(selected_owner,'activity') then
    return jsonb_build_object('items','[]'::jsonb); end if;
  tasks_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'tasks');
  assets_allowed:=selected_owner=auth.uid() or public.can_view_feature(selected_owner,'assets');
  if not assets_allowed and (input_holding_id is not null or input_instrument_id is not null or input_account_id is not null) then
    raise exception 'Asset access required for target filters';
  end if;
  return jsonb_build_object('items',coalesce((
    select jsonb_agg(jsonb_build_object(
      'record_state','done','record_type','activity','record_id',event.id::text,
      'activity_id',event.id,'task_id',case when tasks_allowed then event.task_id end,
      'holding_id',case when assets_allowed then event.holding_id end,
      'title',event.title,'body',event.body,'occurred_at',event.occurred_at,
      'created_at',event.created_at,'updated_at',event.updated_at,
      'version',case when selected_owner=auth.uid() then event.version end,
      'tags',coalesce((select jsonb_agg(jsonb_build_object('id',tag.id,'name',tag.name)
        order by lower(tag.name),tag.id) from public.activity_event_tags relation
        join public.activity_tags tag on tag.user_id=relation.user_id and tag.id=relation.tag_id
        where relation.user_id=event.user_id and relation.activity_event_id=event.id),'[]'::jsonb),
      'semantic_score',1-(event.embedding <=> input_query_embedding)
    ) order by event.embedding <=> input_query_embedding,event.occurred_at desc,event.id desc)
    from (
      select event.*,embedding.embedding from public.activity_events event
      join public.activity_embeddings embedding
        on embedding.user_id=event.user_id and embedding.activity_event_id=event.id
        and embedding.content_hash=public.activity_embedding_hash(event)
      where event.user_id=selected_owner and event.status='succeeded'
        and event.action_type not in ('create_general_task','update_general_task')
        and (input_from is null or coalesce(event.occurrence_on,
          (event.occurred_at at time zone input_timezone)::date)>=input_from)
        and (input_to is null or coalesce(event.occurrence_on,
          (event.occurred_at at time zone input_timezone)::date)<=input_to)
        and (input_instrument_id is null or event.instrument_id=input_instrument_id)
        and (input_account_id is null or event.account_id=input_account_id)
        and (input_holding_id is null or event.holding_id=input_holding_id)
        and (cardinality(selected_tags)=0 or case when tag_match='all' then
          (select count(distinct relation.tag_id) from public.activity_event_tags relation
            where relation.user_id=event.user_id and relation.activity_event_id=event.id
              and relation.tag_id=any(selected_tags))=cardinality(selected_tags)
          else exists(select 1 from public.activity_event_tags relation
            where relation.user_id=event.user_id and relation.activity_event_id=event.id
              and relation.tag_id=any(selected_tags)) end)
      order by embedding.embedding <=> input_query_embedding,event.occurred_at desc,event.id desc
      limit page_limit
    ) event
  ),'[]'::jsonb));
end;
$$;
revoke all on function public.app_search_activity_semantic(extensions.vector,uuid,date,date,bigint,bigint,bigint,uuid[],text,integer,text) from public,anon;
grant execute on function public.app_search_activity_semantic(extensions.vector,uuid,date,date,bigint,bigint,bigint,uuid[],text,integer,text) to authenticated;
