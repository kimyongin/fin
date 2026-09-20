create or replace function public.app_update_news_fact(input_fact_id bigint, input_country_code text, input_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    updated_fact public.news_facts;
    normalized_country_code text := upper(trim(coalesce(input_country_code, '')));
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if normalized_country_code !~ '^[A-Z]{2,3}$' then raise exception 'Country code must be 2 or 3 uppercase letters'; end if;
    if nullif(trim(coalesce(input_body, '')), '') is null then raise exception 'Fact body is required'; end if;

    update public.news_facts
    set country_code = normalized_country_code,
        title = left(trim(input_body), 100),
        body = trim(input_body),
        updated_at = now()
    where id = input_fact_id and user_id = current_user_id
    returning * into updated_fact;

    if updated_fact.id is null then raise exception 'News fact not found'; end if;

    insert into public.activity_events (user_id, source, action_type, target_table, target_id, after_data, status)
    values (current_user_id, 'user', 'update_news_fact', 'news_facts', updated_fact.id::text, to_jsonb(updated_fact), 'succeeded');

    return to_jsonb(updated_fact);
end;
$$;

grant execute on function public.app_update_news_fact(bigint, text, text) to authenticated;
