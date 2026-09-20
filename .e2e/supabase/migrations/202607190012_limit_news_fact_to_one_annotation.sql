with ranked_annotations as (
    select
        id,
        fact_id,
        row_number() over (partition by fact_id order by created_at, id) as row_number
    from public.news_fact_annotations
), merged_annotations as (
    select fact_id, string_agg(body, E'\n\n' order by created_at, id) as merged_body
    from public.news_fact_annotations
    group by fact_id
), updated_annotations as (
    update public.news_fact_annotations annotation
    set body = merged_annotations.merged_body
    from ranked_annotations
    join merged_annotations on merged_annotations.fact_id = ranked_annotations.fact_id
    where annotation.id = ranked_annotations.id and ranked_annotations.row_number = 1
)
delete from public.news_fact_annotations annotation
using ranked_annotations
where annotation.id = ranked_annotations.id and ranked_annotations.row_number > 1;

alter table public.news_fact_annotations add constraint news_fact_annotations_one_per_fact unique (fact_id);

create or replace function public.app_save_news_fact_annotation(input_fact_id bigint, input_signal text, input_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    saved_annotation public.news_fact_annotations;
    normalized_signal text := trim(coalesce(input_signal, ''));
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if not exists (select 1 from public.news_facts where id = input_fact_id and user_id = current_user_id) then raise exception 'News fact not found'; end if;
    if normalized_signal not in ('observe', 'positive', 'neutral', 'negative') then raise exception 'Invalid signal'; end if;
    if nullif(trim(coalesce(input_body, '')), '') is null then raise exception 'Annotation is required'; end if;

    insert into public.news_fact_annotations (fact_id, user_id, signal, body)
    values (input_fact_id, current_user_id, normalized_signal, trim(input_body))
    on conflict (fact_id) do update
    set signal = excluded.signal, body = excluded.body
    returning * into saved_annotation;

    insert into public.activity_events (user_id, source, action_type, target_table, target_id, after_data, status)
    values (current_user_id, 'user', 'update_news_annotation', 'news_fact_annotations', saved_annotation.id::text, to_jsonb(saved_annotation), 'succeeded');

    return to_jsonb(saved_annotation);
end;
$$;
