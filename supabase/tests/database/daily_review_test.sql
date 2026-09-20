begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select extensions.plan(23);

create temp table daily_review_test_context (
    user_id uuid not null,
    other_user_id uuid not null,
    context_id uuid,
    expired_context_id uuid,
    idempotency_key uuid not null,
    briefing_id uuid,
    payload jsonb not null
) on commit drop;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
    ('00000000-0000-0000-0000-000000000201', 'authenticated', 'authenticated', 'daily-review-owner@example.com', '', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000202', 'authenticated', 'authenticated', 'daily-review-other@example.com', '', now(), now(), now());

insert into daily_review_test_context (user_id, other_user_id, idempotency_key, payload)
values (
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000202',
    '10000000-0000-0000-0000-000000000001',
    jsonb_build_object(
        'status', 'attention',
        'coverage_status', 'partial',
        'headline', '금리 변화가 포트폴리오의 핵심 점검 사항입니다.',
        'changes', jsonb_build_array(jsonb_build_object('subject', 'portfolio', 'summary', '금리 기대가 바뀌었습니다.')),
        'uncertainties', jsonb_build_array(jsonb_build_object('summary', '다음 발표 전까지 변동성이 남아 있습니다.')),
        'evidence', jsonb_build_array(jsonb_build_object(
            'evidence_key', 'fed-release',
            'title', 'Federal Reserve release',
            'source_name', 'Federal Reserve',
            'source_url', 'https://www.federalreserve.gov/example',
            'published_at', '2026-09-20T18:00:00Z',
            'accessed_at', '2026-09-21T00:00:00Z',
            'summary', '정책 경로에 관한 공식 발표입니다.',
            'facts', jsonb_build_array('정책금리를 유지했습니다.')
        )),
        'scopes', jsonb_build_array(jsonb_build_object(
            'scope_key', 'portfolio-macro',
            'subject_kind', 'portfolio',
            'window_from', '2026-09-20T00:00:00Z',
            'window_to', '2026-09-21T00:00:00Z',
            'coverage', 'partial',
            'reason', '미국 시장과 공식 발표를 확인했습니다.',
            'checked_at', '2026-09-21T00:05:00Z',
            'checked_sources', jsonb_build_array(jsonb_build_object(
                'source_url', 'https://www.federalreserve.gov/example',
                'checked_at', '2026-09-21T00:05:00Z',
                'outcome', 'checked',
                'note', '공식 발표 페이지를 확인했습니다.'
            )),
            'evidence_keys', jsonb_build_array('fed-release')
        ))
    )
);

grant select, update on daily_review_test_context to authenticated;

select set_config('request.jwt.claim.sub', (select user_id::text from daily_review_test_context), true);
set local role authenticated;

with created as (
    select public.app_create_daily_context('Asia/Seoul', array[' aapl ', 'AAPL', ' msft ']) result
), saved as (
    update daily_review_test_context
    set context_id = (select (result ->> 'context_id')::uuid from created)
    returning context_id
)
select extensions.ok((select context_id is not null from saved), 'app_create_daily_context returns a context id');

select extensions.is(
    (select snapshot ->> 'schema_version' from public.daily_review_contexts where id = (select context_id from daily_review_test_context)),
    '1',
    'daily context stores a versioned snapshot'
);

select extensions.is(
    (select subject_tickers from public.daily_review_contexts where id = (select context_id from daily_review_test_context)),
    array['AAPL', 'MSFT']::text[],
    'daily context normalizes and deduplicates requested tickers'
);

select extensions.ok(
    (select snapshot ?& array['portfolio', 'strategy', 'saved_news', 'recent_activity', 'previous_briefing', 'research_windows']
     from public.daily_review_contexts where id = (select context_id from daily_review_test_context)),
    'daily context contains the inputs needed for analysis'
);

select extensions.is(
    (select count(*) from public.activity_events where user_id = auth.uid()),
    0::bigint,
    'creating temporary context does not mark an activity as completed'
);

with saved as (
    select public.app_save_daily_briefing(
        (select context_id from daily_review_test_context),
        (select idempotency_key from daily_review_test_context),
        (select payload from daily_review_test_context)
    ) result
), updated as (
    update daily_review_test_context
    set briefing_id = (select (result ->> 'id')::uuid from saved)
    returning briefing_id
)
select extensions.ok((select briefing_id is not null from updated), 'app_save_daily_briefing returns the saved briefing');

select extensions.is(
    (select count(*) from public.daily_briefings where user_id = auth.uid()),
    1::bigint,
    'save creates one briefing'
);

select extensions.is(
    (select coverage_status from public.daily_briefings where id = (select briefing_id from daily_review_test_context)),
    'partial',
    'server derives overall coverage from saved scopes'
);

select extensions.ok(
    (select briefing.context_snapshot = context.snapshot
     from public.daily_briefings briefing
     join public.daily_review_contexts context on context.id = (select context_id from daily_review_test_context)
     where briefing.id = (select briefing_id from daily_review_test_context)),
    'save copies the immutable context snapshot into the briefing'
);

select extensions.is(
    (select count(*) from public.daily_briefing_evidence where briefing_id = (select briefing_id from daily_review_test_context)),
    1::bigint,
    'save stores source evidence'
);

select extensions.is(
    (select count(*) from public.daily_briefing_scope_evidence where briefing_id = (select briefing_id from daily_review_test_context)),
    1::bigint,
    'save links research scope to its evidence'
);

select extensions.is(
    (select count(*) from public.daily_briefing_scope_sources where briefing_id = (select briefing_id from daily_review_test_context)),
    1::bigint,
    'save records a checked source even when no new article is required'
);

select extensions.is(
    (select action_type from public.activity_events where user_id = auth.uid() order by id desc limit 1),
    'save_daily_briefing',
    'save records one successful activity event'
);

select extensions.is(
    public.app_get_daily_briefing((select briefing_id from daily_review_test_context)) -> 'evidence' -> 0 ->> 'evidence_key',
    'fed-release',
    'get returns structured evidence'
);

select extensions.is(
    jsonb_array_length(public.app_list_daily_briefings(20, null)),
    1,
    'list returns the saved briefing summary'
);

select extensions.is(
    public.app_save_daily_briefing(
        (select context_id from daily_review_test_context),
        (select idempotency_key from daily_review_test_context),
        (select payload from daily_review_test_context)
    ) ->> 'id',
    (select briefing_id::text from daily_review_test_context),
    'an identical idempotent retry returns the original result'
);

select extensions.is(
    (select count(*) from public.daily_briefings where user_id = auth.uid()),
    1::bigint,
    'an idempotent retry does not create a duplicate briefing'
);

select extensions.throws_like(
    format(
        'select public.app_save_daily_briefing(%L::uuid, %L::uuid, %L::jsonb)',
        (select context_id from daily_review_test_context),
        '10000000-0000-0000-0000-000000000003',
        (select (payload || jsonb_build_object('status', 'no_action'))::text from daily_review_test_context)
    ),
    '%No-action briefing requires complete research coverage%',
    'partial research cannot be presented as no action required'
);

select extensions.throws_like(
    format(
        'select public.app_save_daily_briefing(%L::uuid, %L::uuid, %L::jsonb)',
        (select context_id from daily_review_test_context),
        '10000000-0000-0000-0000-000000000004',
        (select jsonb_set(
            jsonb_set(payload, '{scopes,0,coverage}', '"sufficient"'::jsonb),
            '{scopes,0,checked_sources}', '[]'::jsonb
        )::text from daily_review_test_context)
    ),
    '%A sufficient scope needs at least one successfully checked source%',
    'sufficient coverage requires an explicitly checked source'
);

select extensions.throws_like(
    format(
        'select public.app_save_daily_briefing(%L::uuid, %L::uuid, %L::jsonb)',
        (select context_id from daily_review_test_context),
        (select idempotency_key from daily_review_test_context),
        (select (payload || jsonb_build_object('headline', '다른 요청'))::text from daily_review_test_context)
    ),
    '%Idempotency key was already used with a different request%',
    'reusing an idempotency key for a different request is rejected'
);

with created as (
    select public.app_create_daily_context('Asia/Seoul', null) result
)
update daily_review_test_context
set expired_context_id = (select (result ->> 'context_id')::uuid from created);

reset role;
update public.daily_review_contexts
set created_at = clock_timestamp() - interval '2 hours',
    expires_at = clock_timestamp() - interval '1 hour'
where id = (select expired_context_id from daily_review_test_context);
set local role authenticated;

select extensions.throws_like(
    format(
        'select public.app_save_daily_briefing(%L::uuid, %L::uuid, %L::jsonb)',
        (select expired_context_id from daily_review_test_context),
        '10000000-0000-0000-0000-000000000002',
        (select payload::text from daily_review_test_context)
    ),
    '%Daily review context has expired%',
    'an expired context cannot create a new briefing'
);

select extensions.is(
    (select count(*) from public.daily_briefings where user_id = auth.uid()),
    1::bigint,
    'a rejected save leaves the briefing aggregate unchanged'
);

select set_config('request.jwt.claim.sub', (select other_user_id::text from daily_review_test_context), true);

select extensions.is(
    public.app_get_daily_briefing((select briefing_id from daily_review_test_context)),
    null::jsonb,
    'another user cannot read the briefing'
);

select * from extensions.finish();
rollback;
