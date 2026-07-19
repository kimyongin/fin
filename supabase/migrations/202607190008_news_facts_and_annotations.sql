create table public.news_facts (
    id bigserial primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    fact_date date not null,
    country_code text not null check (country_code ~ '^[A-Z]{2,3}$'),
    axis text not null check (axis in ('growth', 'inflation_monetary', 'financial_conditions', 'policy_geopolitics', 'earnings_valuation')),
    title text not null,
    source_name text,
    source_url text,
    body text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.news_fact_annotations (
    id bigserial primary key,
    fact_id bigint not null references public.news_facts(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    signal text not null check (signal in ('observe', 'positive', 'neutral', 'negative')),
    body text not null,
    created_at timestamptz not null default now()
);

create index news_facts_user_date_idx on public.news_facts (user_id, fact_date desc, id desc);
create index news_fact_annotations_fact_idx on public.news_fact_annotations (fact_id, created_at, id);

alter table public.news_facts enable row level security;
alter table public.news_fact_annotations enable row level security;

create policy news_facts_select_own on public.news_facts for select to authenticated using (user_id = auth.uid());
create policy news_facts_insert_own on public.news_facts for insert to authenticated with check (user_id = auth.uid());
create policy news_facts_update_own on public.news_facts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy news_facts_delete_own on public.news_facts for delete to authenticated using (user_id = auth.uid());

create policy news_fact_annotations_select_own on public.news_fact_annotations for select to authenticated using (user_id = auth.uid());
create policy news_fact_annotations_insert_own on public.news_fact_annotations for insert to authenticated with check (user_id = auth.uid());
create policy news_fact_annotations_update_own on public.news_fact_annotations for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy news_fact_annotations_delete_own on public.news_fact_annotations for delete to authenticated using (user_id = auth.uid());

create or replace function public.app_get_news_state(input_owner_user_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with requested_owner as (
        select coalesce(input_owner_user_id, auth.uid()) as user_id
    ), current_user_ctx as (
        select user_id from requested_owner where public.can_view_owner(user_id)
    )
    select jsonb_build_object(
        'facts', coalesce((
            select jsonb_agg(
                to_jsonb(f) || jsonb_build_object('annotations', coalesce((
                    select jsonb_agg(to_jsonb(a) order by a.created_at, a.id)
                    from public.news_fact_annotations a
                    where a.fact_id = f.id
                ), '[]'::jsonb))
                order by f.fact_date desc, f.id desc
            )
            from public.news_facts f
            join current_user_ctx ctx on ctx.user_id = f.user_id
        ), '[]'::jsonb)
    );
$$;

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
    if normalized_axis not in ('growth', 'inflation_monetary', 'financial_conditions', 'policy_geopolitics', 'earnings_valuation') then raise exception 'Invalid news axis'; end if;
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
    returning * into saved_annotation;

    insert into public.activity_events (user_id, source, action_type, target_table, target_id, after_data, status)
    values (current_user_id, 'user', 'create_news_annotation', 'news_fact_annotations', saved_annotation.id::text, jsonb_build_object('fact_id', input_fact_id, 'signal', saved_annotation.signal), 'succeeded');

    return to_jsonb(saved_annotation);
end;
$$;

grant execute on function public.app_get_news_state(uuid) to authenticated;
grant execute on function public.app_save_news_fact(date, text, text, text, text, text, text) to authenticated;
grant execute on function public.app_save_news_fact_annotation(bigint, text, text) to authenticated;
