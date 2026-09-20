create table public.daily_review_contexts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    timezone text not null,
    subject_tickers text[] not null default '{}',
    snapshot jsonb not null,
    constraint daily_review_contexts_expiry_check check (expires_at > created_at),
    constraint daily_review_contexts_snapshot_check check (jsonb_typeof(snapshot) = 'object')
);

create index daily_review_contexts_user_expiry_idx
    on public.daily_review_contexts (user_id, expires_at desc);

create table public.daily_briefings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    review_date date not null,
    timezone text not null,
    analyzed_at timestamptz not null default now(),
    status text not null check (status in ('no_action', 'attention', 'insufficient_data')),
    coverage_status text not null check (coverage_status in ('complete', 'partial', 'failed')),
    headline text not null check (char_length(trim(headline)) between 1 and 500),
    changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array'),
    uncertainties jsonb not null default '[]'::jsonb check (jsonb_typeof(uncertainties) = 'array'),
    context_snapshot jsonb not null check (jsonb_typeof(context_snapshot) = 'object'),
    supersedes_id uuid,
    created_at timestamptz not null default now(),
    unique (user_id, id),
    constraint daily_briefings_supersedes_fk
        foreign key (user_id, supersedes_id)
        references public.daily_briefings (user_id, id)
);

create index daily_briefings_user_analyzed_idx
    on public.daily_briefings (user_id, analyzed_at desc, id desc);

create table public.daily_briefing_evidence (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    briefing_id uuid not null,
    evidence_key text not null check (char_length(trim(evidence_key)) between 1 and 100),
    title text not null check (char_length(trim(title)) between 1 and 500),
    source_name text,
    source_url text not null check (source_url ~ '^https?://'),
    published_at timestamptz,
    accessed_at timestamptz not null default now(),
    summary text not null check (char_length(trim(summary)) between 1 and 4000),
    facts jsonb not null default '[]'::jsonb check (jsonb_typeof(facts) = 'array'),
    created_at timestamptz not null default now(),
    unique (briefing_id, evidence_key),
    unique (user_id, briefing_id, id),
    foreign key (user_id, briefing_id)
        references public.daily_briefings (user_id, id) on delete cascade
);

create table public.daily_briefing_scopes (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    briefing_id uuid not null,
    scope_key text not null check (char_length(trim(scope_key)) between 1 and 100),
    subject_kind text not null check (subject_kind in ('portfolio', 'instrument', 'category', 'account')),
    subject_ref text,
    window_from timestamptz not null,
    window_to timestamptz not null,
    coverage text not null check (coverage in ('sufficient', 'partial', 'unverified')),
    reason text,
    checked_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    unique (briefing_id, scope_key),
    unique (user_id, briefing_id, id),
    constraint daily_briefing_scopes_window_check check (window_to > window_from),
    constraint daily_briefing_scopes_reason_check check (
        coverage = 'sufficient' or nullif(trim(coalesce(reason, '')), '') is not null
    ),
    foreign key (user_id, briefing_id)
        references public.daily_briefings (user_id, id) on delete cascade
);

create table public.daily_briefing_scope_sources (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    briefing_id uuid not null,
    scope_id uuid not null,
    source_url text not null check (source_url ~ '^https?://'),
    checked_at timestamptz not null,
    outcome text not null check (outcome in ('checked', 'failed')),
    note text,
    created_at timestamptz not null default now(),
    foreign key (user_id, briefing_id, scope_id)
        references public.daily_briefing_scopes (user_id, briefing_id, id) on delete cascade
);

create table public.daily_briefing_scope_evidence (
    user_id uuid not null,
    briefing_id uuid not null,
    scope_id uuid not null,
    evidence_id uuid not null,
    primary key (scope_id, evidence_id),
    foreign key (user_id, briefing_id, scope_id)
        references public.daily_briefing_scopes (user_id, briefing_id, id) on delete cascade,
    foreign key (user_id, briefing_id, evidence_id)
        references public.daily_briefing_evidence (user_id, briefing_id, id) on delete cascade
);

create table public.daily_review_mutation_receipts (
    user_id uuid not null references auth.users(id) on delete cascade,
    operation text not null,
    idempotency_key uuid not null,
    request_payload jsonb not null,
    response_payload jsonb not null,
    created_at timestamptz not null default now(),
    primary key (user_id, operation, idempotency_key),
    constraint daily_review_receipt_request_check check (jsonb_typeof(request_payload) = 'object'),
    constraint daily_review_receipt_response_check check (jsonb_typeof(response_payload) = 'object')
);

alter table public.daily_review_contexts enable row level security;
alter table public.daily_briefings enable row level security;
alter table public.daily_briefing_evidence enable row level security;
alter table public.daily_briefing_scopes enable row level security;
alter table public.daily_briefing_scope_sources enable row level security;
alter table public.daily_briefing_scope_evidence enable row level security;
alter table public.daily_review_mutation_receipts enable row level security;

create policy daily_review_contexts_select_own on public.daily_review_contexts
    for select to authenticated using (user_id = auth.uid());
create policy daily_briefings_select_own on public.daily_briefings
    for select to authenticated using (user_id = auth.uid());
create policy daily_briefing_evidence_select_own on public.daily_briefing_evidence
    for select to authenticated using (user_id = auth.uid());
create policy daily_briefing_scopes_select_own on public.daily_briefing_scopes
    for select to authenticated using (user_id = auth.uid());
create policy daily_briefing_scope_sources_select_own on public.daily_briefing_scope_sources
    for select to authenticated using (user_id = auth.uid());
create policy daily_briefing_scope_evidence_select_own on public.daily_briefing_scope_evidence
    for select to authenticated using (user_id = auth.uid());
create policy daily_review_mutation_receipts_select_own on public.daily_review_mutation_receipts
    for select to authenticated using (user_id = auth.uid());

create or replace function public.app_get_daily_briefing(input_briefing_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
        'id', briefing.id,
        'review_date', briefing.review_date,
        'timezone', briefing.timezone,
        'analyzed_at', briefing.analyzed_at,
        'status', briefing.status,
        'coverage_status', briefing.coverage_status,
        'headline', briefing.headline,
        'changes', briefing.changes,
        'uncertainties', briefing.uncertainties,
        'context_snapshot', briefing.context_snapshot,
        'supersedes_id', briefing.supersedes_id,
        'created_at', briefing.created_at,
        'evidence', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', evidence.id,
                'evidence_key', evidence.evidence_key,
                'title', evidence.title,
                'source_name', evidence.source_name,
                'source_url', evidence.source_url,
                'published_at', evidence.published_at,
                'accessed_at', evidence.accessed_at,
                'summary', evidence.summary,
                'facts', evidence.facts
            ) order by evidence.created_at, evidence.id)
            from public.daily_briefing_evidence evidence
            where evidence.user_id = auth.uid() and evidence.briefing_id = briefing.id
        ), '[]'::jsonb),
        'scopes', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', scope.id,
                'scope_key', scope.scope_key,
                'subject_kind', scope.subject_kind,
                'subject_ref', scope.subject_ref,
                'window_from', scope.window_from,
                'window_to', scope.window_to,
                'coverage', scope.coverage,
                'reason', scope.reason,
                'checked_at', scope.checked_at,
                'checked_sources', coalesce((
                    select jsonb_agg(jsonb_build_object(
                        'source_url', source.source_url,
                        'checked_at', source.checked_at,
                        'outcome', source.outcome,
                        'note', source.note
                    ) order by source.created_at, source.id)
                    from public.daily_briefing_scope_sources source
                    where source.user_id = auth.uid() and source.scope_id = scope.id
                ), '[]'::jsonb),
                'evidence_keys', coalesce((
                    select jsonb_agg(evidence.evidence_key order by evidence.evidence_key)
                    from public.daily_briefing_scope_evidence link
                    join public.daily_briefing_evidence evidence on evidence.id = link.evidence_id
                    where link.user_id = auth.uid() and link.scope_id = scope.id
                ), '[]'::jsonb)
            ) order by scope.created_at, scope.id)
            from public.daily_briefing_scopes scope
            where scope.user_id = auth.uid() and scope.briefing_id = briefing.id
        ), '[]'::jsonb)
    )
    from public.daily_briefings briefing
    where briefing.id = input_briefing_id and briefing.user_id = auth.uid();
$$;

create or replace function public.app_list_daily_briefings(
    input_limit integer default 20,
    input_before timestamptz default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(to_jsonb(item) order by item.analyzed_at desc, item.id desc), '[]'::jsonb)
    from (
        select briefing.id, briefing.review_date, briefing.timezone, briefing.analyzed_at,
               briefing.status, briefing.coverage_status, briefing.headline,
               briefing.supersedes_id, briefing.created_at
        from public.daily_briefings briefing
        where briefing.user_id = auth.uid()
          and (input_before is null or briefing.analyzed_at < input_before)
        order by briefing.analyzed_at desc, briefing.id desc
        limit greatest(1, least(coalesce(input_limit, 20), 100))
    ) item;
$$;

create or replace function public.app_create_daily_context(
    input_timezone text default 'Asia/Seoul',
    input_subject_tickers text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_timezone text := trim(coalesce(input_timezone, ''));
    normalized_subject_tickers text[];
    context_id uuid;
    context_expires_at timestamptz := clock_timestamp() + interval '6 hours';
    context_as_of timestamptz := clock_timestamp();
    context_snapshot jsonb;
    recent_activity jsonb;
    previous_briefing jsonb;
    research_windows jsonb;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;
    if normalized_timezone = '' or not exists (
        select 1 from pg_timezone_names where name = normalized_timezone
    ) then
        raise exception 'Invalid timezone';
    end if;

    select coalesce(array_agg(distinct upper(trim(ticker)) order by upper(trim(ticker))), '{}')
    into normalized_subject_tickers
    from unnest(coalesce(input_subject_tickers, '{}'::text[])) ticker
    where trim(ticker) <> '';

    if cardinality(normalized_subject_tickers) > 200 then
        raise exception 'Daily review context accepts at most 200 subjects';
    end if;

    delete from public.daily_review_contexts
    where user_id = current_user_id and expires_at <= context_as_of;

    delete from public.daily_review_contexts
    where id in (
        select id
        from public.daily_review_contexts
        where user_id = current_user_id
        order by created_at desc, id desc
        offset 9
    );

    select coalesce(jsonb_agg(to_jsonb(activity) order by activity.created_at desc), '[]'::jsonb)
    into recent_activity
    from (
        select event.id, event.source, event.action_type, event.target_table,
               event.target_id, event.status, event.created_at
        from public.activity_events event
        where event.user_id = current_user_id
        order by event.created_at desc, event.id desc
        limit 20
    ) activity;

    select jsonb_build_object(
        'id', briefing.id,
        'analyzed_at', briefing.analyzed_at,
        'status', briefing.status,
        'coverage_status', briefing.coverage_status,
        'headline', briefing.headline,
        'changes', briefing.changes,
        'uncertainties', briefing.uncertainties
    )
    into previous_briefing
    from public.daily_briefings briefing
    where briefing.user_id = current_user_id
    order by briefing.analyzed_at desc, briefing.id desc
    limit 1;

    select coalesce(jsonb_agg(to_jsonb(research_window) order by research_window.checked_at desc), '[]'::jsonb)
    into research_windows
    from (
        select distinct on (scope.subject_kind, coalesce(scope.subject_ref, ''))
            scope.subject_kind, scope.subject_ref, scope.window_from, scope.window_to,
            scope.coverage, scope.reason, scope.checked_at
        from public.daily_briefing_scopes scope
        where scope.user_id = current_user_id
        order by scope.subject_kind, coalesce(scope.subject_ref, ''), scope.checked_at desc, scope.id desc
    ) research_window;

    context_snapshot := jsonb_build_object(
        'schema_version', 1,
        'as_of', context_as_of,
        'review_date', (context_as_of at time zone normalized_timezone)::date,
        'timezone', normalized_timezone,
        'requested_subject_tickers', to_jsonb(normalized_subject_tickers),
        'portfolio', public.app_get_portfolio_state(null),
        'strategy', public.app_get_strategy_state(null),
        'saved_news', public.app_get_news_state(null),
        'recent_activity', recent_activity,
        'previous_briefing', previous_briefing,
        'research_windows', jsonb_build_object(
            'overlap_days', 3,
            'last_scopes', research_windows
        ),
        'open_tasks', jsonb_build_object('status', 'unavailable', 'items', '[]'::jsonb),
        'decisions', jsonb_build_object('status', 'unavailable', 'items', '[]'::jsonb),
        'completeness', jsonb_build_object('status', 'complete', 'omitted', '[]'::jsonb)
    );

    if pg_column_size(context_snapshot) > 2097152 then
        raise exception 'Daily review context exceeds the 2 MiB size limit';
    end if;

    insert into public.daily_review_contexts (
        user_id, expires_at, timezone, subject_tickers, snapshot
    ) values (
        current_user_id, context_expires_at, normalized_timezone,
        normalized_subject_tickers, context_snapshot
    ) returning id into context_id;

    return jsonb_build_object(
        'context_id', context_id,
        'expires_at', context_expires_at,
        'snapshot', context_snapshot
    );
end;
$$;

create or replace function public.app_save_daily_briefing(
    input_context_id uuid,
    input_idempotency_key uuid,
    input_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    stored_context public.daily_review_contexts%rowtype;
    stored_receipt public.daily_review_mutation_receipts%rowtype;
    request_payload jsonb;
    saved_briefing_id uuid;
    superseded_briefing_id uuid;
    evidence_input jsonb;
    scope_input jsonb;
    evidence_key_input text;
    evidence_id_input uuid;
    scope_id_input uuid;
    source_input jsonb;
    derived_coverage_status text;
    response_payload jsonb;
begin
    if current_user_id is null then
        raise exception 'Authentication required';
    end if;
    if input_context_id is null then
        raise exception 'Context id is required';
    end if;
    if input_idempotency_key is null then
        raise exception 'Idempotency key is required';
    end if;
    if coalesce(jsonb_typeof(input_payload), 'null') <> 'object' then
        raise exception 'Briefing payload must be an object';
    end if;

    request_payload := jsonb_build_object('context_id', input_context_id, 'payload', input_payload);
    perform pg_advisory_xact_lock(hashtextextended(
        current_user_id::text || ':save_daily_briefing:' || input_idempotency_key::text, 0
    ));

    select * into stored_receipt
    from public.daily_review_mutation_receipts receipt
    where receipt.user_id = current_user_id
      and receipt.operation = 'save_daily_briefing'
      and receipt.idempotency_key = input_idempotency_key;

    if found then
        if stored_receipt.request_payload <> request_payload then
            raise exception 'Idempotency key was already used with a different request';
        end if;
        return stored_receipt.response_payload;
    end if;

    select * into stored_context
    from public.daily_review_contexts context
    where context.id = input_context_id and context.user_id = current_user_id;

    if not found then
        raise exception 'Daily review context was not found';
    end if;
    if stored_context.expires_at <= clock_timestamp() then
        raise exception 'Daily review context has expired';
    end if;

    if trim(coalesce(input_payload ->> 'status', '')) not in ('no_action', 'attention', 'insufficient_data') then
        raise exception 'Invalid briefing status';
    end if;
    if char_length(trim(coalesce(input_payload ->> 'headline', ''))) not between 1 and 500 then
        raise exception 'Briefing headline is required and must be at most 500 characters';
    end if;
    if coalesce(jsonb_typeof(input_payload -> 'changes'), 'null') <> 'array'
       or jsonb_array_length(input_payload -> 'changes') > 20 then
        raise exception 'Briefing changes must be an array with at most 20 items';
    end if;
    if coalesce(jsonb_typeof(input_payload -> 'uncertainties'), 'null') <> 'array'
       or jsonb_array_length(input_payload -> 'uncertainties') > 20 then
        raise exception 'Briefing uncertainties must be an array with at most 20 items';
    end if;
    if coalesce(jsonb_typeof(input_payload -> 'evidence'), 'null') <> 'array'
       or jsonb_array_length(input_payload -> 'evidence') > 50 then
        raise exception 'Briefing evidence must be an array with at most 50 items';
    end if;
    if coalesce(jsonb_typeof(input_payload -> 'scopes'), 'null') <> 'array'
       or jsonb_array_length(input_payload -> 'scopes') not between 1 and 200 then
        raise exception 'Briefing scopes must contain between 1 and 200 items';
    end if;

    if nullif(trim(coalesce(input_payload ->> 'supersedes_id', '')), '') is not null then
        begin
            superseded_briefing_id := (input_payload ->> 'supersedes_id')::uuid;
        exception when invalid_text_representation then
            raise exception 'Invalid supersedes id';
        end;
        if not exists (
            select 1 from public.daily_briefings briefing
            where briefing.id = superseded_briefing_id and briefing.user_id = current_user_id
        ) then
            raise exception 'Superseded briefing was not found';
        end if;
    end if;

    insert into public.daily_briefings (
        user_id, review_date, timezone, status, coverage_status, headline,
        changes, uncertainties, context_snapshot, supersedes_id
    ) values (
        current_user_id,
        (stored_context.snapshot ->> 'review_date')::date,
        stored_context.timezone,
        trim(input_payload ->> 'status'),
        'failed',
        trim(input_payload ->> 'headline'),
        input_payload -> 'changes',
        input_payload -> 'uncertainties',
        stored_context.snapshot,
        superseded_briefing_id
    ) returning id into saved_briefing_id;

    for evidence_input in select value from jsonb_array_elements(input_payload -> 'evidence') loop
        if coalesce(jsonb_typeof(evidence_input), 'null') <> 'object' then
            raise exception 'Each evidence item must be an object';
        end if;
        evidence_key_input := trim(coalesce(evidence_input ->> 'evidence_key', ''));
        if char_length(evidence_key_input) not between 1 and 100 then
            raise exception 'Each evidence item needs an evidence_key of at most 100 characters';
        end if;
        if char_length(trim(coalesce(evidence_input ->> 'title', ''))) not between 1 and 500 then
            raise exception 'Each evidence item needs a title of at most 500 characters';
        end if;
        if trim(coalesce(evidence_input ->> 'source_url', '')) !~ '^https?://' then
            raise exception 'Each evidence item needs an http or https source_url';
        end if;
        if char_length(trim(coalesce(evidence_input ->> 'summary', ''))) not between 1 and 4000 then
            raise exception 'Each evidence item needs a summary of at most 4000 characters';
        end if;
        if coalesce(jsonb_typeof(evidence_input -> 'facts'), 'null') <> 'array' then
            raise exception 'Evidence facts must be an array';
        end if;

        insert into public.daily_briefing_evidence (
            user_id, briefing_id, evidence_key, title, source_name, source_url,
            published_at, accessed_at, summary, facts
        ) values (
            current_user_id, saved_briefing_id, evidence_key_input,
            trim(evidence_input ->> 'title'), nullif(trim(evidence_input ->> 'source_name'), ''),
            trim(evidence_input ->> 'source_url'),
            nullif(evidence_input ->> 'published_at', '')::timestamptz,
            coalesce(nullif(evidence_input ->> 'accessed_at', '')::timestamptz, clock_timestamp()),
            trim(evidence_input ->> 'summary'), evidence_input -> 'facts'
        );
    end loop;

    for scope_input in select value from jsonb_array_elements(input_payload -> 'scopes') loop
        if coalesce(jsonb_typeof(scope_input), 'null') <> 'object' then
            raise exception 'Each scope item must be an object';
        end if;
        if char_length(trim(coalesce(scope_input ->> 'scope_key', ''))) not between 1 and 100 then
            raise exception 'Each scope item needs a scope_key of at most 100 characters';
        end if;
        if trim(coalesce(scope_input ->> 'subject_kind', '')) not in ('portfolio', 'instrument', 'category', 'account') then
            raise exception 'Invalid scope subject kind';
        end if;
        if trim(coalesce(scope_input ->> 'coverage', '')) not in ('sufficient', 'partial', 'unverified') then
            raise exception 'Invalid scope coverage';
        end if;
        if trim(scope_input ->> 'coverage') <> 'sufficient'
           and nullif(trim(coalesce(scope_input ->> 'reason', '')), '') is null then
            raise exception 'Partial or unverified scope needs a reason';
        end if;
        if coalesce(jsonb_typeof(scope_input -> 'evidence_keys'), 'null') <> 'array' then
            raise exception 'Scope evidence_keys must be an array';
        end if;
        if coalesce(jsonb_typeof(scope_input -> 'checked_sources'), 'null') <> 'array' then
            raise exception 'Scope checked_sources must be an array';
        end if;
        if trim(scope_input ->> 'coverage') = 'sufficient' and not exists (
            select 1
            from jsonb_array_elements(scope_input -> 'checked_sources') source
            where source ->> 'outcome' = 'checked'
        ) then
            raise exception 'A sufficient scope needs at least one successfully checked source';
        end if;

        insert into public.daily_briefing_scopes (
            user_id, briefing_id, scope_key, subject_kind, subject_ref,
            window_from, window_to, coverage, reason, checked_at
        ) values (
            current_user_id, saved_briefing_id, trim(scope_input ->> 'scope_key'),
            trim(scope_input ->> 'subject_kind'), nullif(trim(scope_input ->> 'subject_ref'), ''),
            (scope_input ->> 'window_from')::timestamptz,
            (scope_input ->> 'window_to')::timestamptz,
            trim(scope_input ->> 'coverage'), nullif(trim(scope_input ->> 'reason'), ''),
            coalesce(nullif(scope_input ->> 'checked_at', '')::timestamptz, clock_timestamp())
        ) returning id into scope_id_input;

        for source_input in select value from jsonb_array_elements(scope_input -> 'checked_sources') loop
            if coalesce(jsonb_typeof(source_input), 'null') <> 'object'
               or trim(coalesce(source_input ->> 'source_url', '')) !~ '^https?://' then
                raise exception 'Each checked source needs an http or https source_url';
            end if;
            if trim(coalesce(source_input ->> 'outcome', '')) not in ('checked', 'failed') then
                raise exception 'Invalid checked source outcome';
            end if;
            insert into public.daily_briefing_scope_sources (
                user_id, briefing_id, scope_id, source_url, checked_at, outcome, note
            ) values (
                current_user_id, saved_briefing_id, scope_id_input,
                trim(source_input ->> 'source_url'),
                coalesce(nullif(source_input ->> 'checked_at', '')::timestamptz, clock_timestamp()),
                trim(source_input ->> 'outcome'), nullif(trim(source_input ->> 'note'), '')
            );
        end loop;

        for evidence_key_input in
            select value from jsonb_array_elements_text(scope_input -> 'evidence_keys')
        loop
            select evidence.id into evidence_id_input
            from public.daily_briefing_evidence evidence
            where evidence.user_id = current_user_id
              and evidence.briefing_id = saved_briefing_id
              and evidence.evidence_key = evidence_key_input;
            if not found then
                raise exception 'Scope references unknown evidence key: %', evidence_key_input;
            end if;
            insert into public.daily_briefing_scope_evidence (
                user_id, briefing_id, scope_id, evidence_id
            ) values (
                current_user_id, saved_briefing_id, scope_id_input, evidence_id_input
            );
        end loop;
    end loop;

    select case
        when bool_and(scope.coverage = 'sufficient') then 'complete'
        when bool_and(scope.coverage = 'unverified') then 'failed'
        else 'partial'
    end
    into derived_coverage_status
    from public.daily_briefing_scopes scope
    where scope.user_id = current_user_id and scope.briefing_id = saved_briefing_id;

    if trim(input_payload ->> 'status') = 'no_action' and derived_coverage_status <> 'complete' then
        raise exception 'No-action briefing requires complete research coverage';
    end if;

    update public.daily_briefings
    set coverage_status = derived_coverage_status
    where id = saved_briefing_id and user_id = current_user_id;

    insert into public.activity_events (
        user_id, source, action_type, target_table, target_id, after_data, status
    ) values (
        current_user_id, 'agent', 'save_daily_briefing', 'daily_briefings',
        saved_briefing_id::text,
        jsonb_build_object(
            'headline', trim(input_payload ->> 'headline'),
            'status', trim(input_payload ->> 'status'),
            'coverage_status', derived_coverage_status
        ),
        'succeeded'
    );

    response_payload := public.app_get_daily_briefing(saved_briefing_id);

    insert into public.daily_review_mutation_receipts (
        user_id, operation, idempotency_key, request_payload, response_payload
    ) values (
        current_user_id, 'save_daily_briefing', input_idempotency_key,
        request_payload, response_payload
    );

    return response_payload;
end;
$$;

grant select on public.daily_review_contexts, public.daily_briefings,
    public.daily_briefing_evidence, public.daily_briefing_scopes,
    public.daily_briefing_scope_sources, public.daily_briefing_scope_evidence to authenticated;

grant execute on function public.app_get_daily_briefing(uuid) to authenticated;
grant execute on function public.app_list_daily_briefings(integer, timestamptz) to authenticated;
grant execute on function public.app_create_daily_context(text, text[]) to authenticated;
grant execute on function public.app_save_daily_briefing(uuid, uuid, jsonb) to authenticated;
