create or replace function public.mcp_get_strategy_state(input_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return public.app_get_strategy_state(null);
end;
$$;

create or replace function public.mcp_save_strategy(
    input_token_hash text,
    input_name text,
    input_monthly_contribution numeric,
    input_review_day integer,
    input_drift_threshold numeric,
    input_buckets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return public.app_save_strategy(input_name, input_monthly_contribution, input_review_day, input_drift_threshold, input_buckets);
end;
$$;

create or replace function public.mcp_get_news_state(input_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    return public.app_get_news_state(null);
end;
$$;

create or replace function public.mcp_save_news_record(
    input_token_hash text,
    input_country_code text,
    input_fact text,
    input_opinion text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    saved_fact jsonb;
    saved_annotation jsonb;
    normalized_fact text := trim(coalesce(input_fact, ''));
begin
    perform public.mcp_adopt_agent_token(input_token_hash);
    if normalized_fact = '' then raise exception 'Fact is required'; end if;

    saved_fact := public.app_save_news_fact(
        current_date,
        input_country_code,
        'general',
        left(normalized_fact, 100),
        null,
        null,
        normalized_fact
    );

    if nullif(trim(coalesce(input_opinion, '')), '') is not null then
        saved_annotation := public.app_save_news_fact_annotation(
            (saved_fact ->> 'id')::bigint,
            'observe',
            input_opinion
        );
    end if;

    return saved_fact || jsonb_build_object('annotation', saved_annotation);
end;
$$;

grant execute on function public.mcp_get_strategy_state(text) to anon, authenticated;
grant execute on function public.mcp_save_strategy(text, text, numeric, integer, numeric, jsonb) to anon, authenticated;
grant execute on function public.mcp_get_news_state(text) to anon, authenticated;
grant execute on function public.mcp_save_news_record(text, text, text, text) to anon, authenticated;
