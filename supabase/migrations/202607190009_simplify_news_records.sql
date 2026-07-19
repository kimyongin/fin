alter table public.news_facts drop constraint news_facts_axis_check;
alter table public.news_facts add constraint news_facts_axis_check check (length(trim(axis)) > 0);

create or replace function public.app_save_news_fact(
    input_fact_date date,
    input_country_code text,
    input_axis text,
    input_title text,
    input_source_name text,
    input_source_url text,
    input_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    saved_fact public.news_facts;
    normalized_country_code text := upper(trim(coalesce(input_country_code, '')));
    normalized_axis text := trim(coalesce(input_axis, ''));
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_fact_date is null then raise exception 'Fact date is required'; end if;
    if normalized_country_code !~ '^[A-Z]{2,3}$' then raise exception 'Country code must be 2 or 3 uppercase letters'; end if;
    if normalized_axis = '' then raise exception 'News axis is required'; end if;
    if nullif(trim(coalesce(input_title, '')), '') is null then raise exception 'Fact title is required'; end if;
    if nullif(trim(coalesce(input_body, '')), '') is null then raise exception 'Fact body is required'; end if;

    insert into public.news_facts (user_id, fact_date, country_code, axis, title, source_name, source_url, body)
    values (current_user_id, input_fact_date, normalized_country_code, normalized_axis, trim(input_title), nullif(trim(coalesce(input_source_name, '')), ''), nullif(trim(coalesce(input_source_url, '')), ''), trim(input_body))
    returning * into saved_fact;

    insert into public.activity_events (user_id, source, action_type, target_table, target_id, after_data, status)
    values (current_user_id, 'user', 'create_news_fact', 'news_facts', saved_fact.id::text, jsonb_build_object('title', saved_fact.title, 'country_code', saved_fact.country_code, 'axis', saved_fact.axis, 'fact_date', saved_fact.fact_date), 'succeeded');

    return to_jsonb(saved_fact);
end;
$$;
