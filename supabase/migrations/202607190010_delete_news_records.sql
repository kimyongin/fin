create or replace function public.app_delete_news_fact(input_fact_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    deleted_fact public.news_facts;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;

    delete from public.news_facts
    where id = input_fact_id and user_id = current_user_id
    returning * into deleted_fact;

    if deleted_fact.id is null then raise exception 'News fact not found'; end if;

    insert into public.activity_events (user_id, source, action_type, target_table, target_id, before_data, status)
    values (current_user_id, 'user', 'delete_news_fact', 'news_facts', deleted_fact.id::text, to_jsonb(deleted_fact), 'succeeded');

    return to_jsonb(deleted_fact);
end;
$$;

create or replace function public.app_delete_news_fact_annotation(input_annotation_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    deleted_annotation public.news_fact_annotations;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;

    delete from public.news_fact_annotations
    where id = input_annotation_id and user_id = current_user_id
    returning * into deleted_annotation;

    if deleted_annotation.id is null then raise exception 'News annotation not found'; end if;

    insert into public.activity_events (user_id, source, action_type, target_table, target_id, before_data, status)
    values (current_user_id, 'user', 'delete_news_annotation', 'news_fact_annotations', deleted_annotation.id::text, to_jsonb(deleted_annotation), 'succeeded');

    return to_jsonb(deleted_annotation);
end;
$$;

grant execute on function public.app_delete_news_fact(bigint) to authenticated;
grant execute on function public.app_delete_news_fact_annotation(bigint) to authenticated;
