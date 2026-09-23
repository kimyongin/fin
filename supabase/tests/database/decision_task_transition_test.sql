begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(20);

create temp table transition_test_context (
    owner_id uuid not null,
    other_id uuid not null,
    decision_id uuid,
    task_id uuid,
    adopt_key uuid not null,
    resolve_key uuid not null
) on commit drop;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
    ('00000000-0000-0000-0000-000000000401', 'authenticated', 'authenticated', 'transition-owner@example.com', '', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000402', 'authenticated', 'authenticated', 'transition-other@example.com', '', now(), now(), now());

insert into transition_test_context (owner_id, other_id, adopt_key, resolve_key)
values (
    '00000000-0000-0000-0000-000000000401',
    '00000000-0000-0000-0000-000000000402',
    '40000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000004'
);

grant select, update on transition_test_context to authenticated;
select set_config('request.jwt.claim.sub', (select owner_id::text from transition_test_context), true);
set local role authenticated;

with recorded as (
    select public.app_record_investment_decision(
        '40000000-0000-0000-0000-000000000010',
        jsonb_build_object(
            'status', 'proposed',
            'subject', jsonb_build_object('kind', 'instrument', 'instrument_id', 'MSFT'),
            'question', '다음 실적 전까지 유지할까?',
            'options', jsonb_build_array('유지', '축소'),
            'timezone', 'Asia/Seoul',
            'authored_via', 'agent',
            'follow_up_tasks', '[]'::jsonb
        )
    ) result
), stored as (
    update transition_test_context
    set decision_id = (select (result ->> 'id')::uuid from recorded)
    returning decision_id
)
select extensions.ok((select decision_id is not null from stored), 'a proposed decision is recorded');

select extensions.is(
    public.app_transition_investment_decision(
        (select decision_id from transition_test_context), 1,
        (select adopt_key from transition_test_context),
        '{"action":"adopt","selected_option":"유지","reason":"현재 가설을 유지합니다.","authored_via":"app"}'::jsonb
    ) ->> 'status',
    'adopted',
    'a proposed decision can be explicitly adopted'
);

select extensions.is(
    (select version from public.investment_decisions where id = (select decision_id from transition_test_context)),
    2,
    'decision transition increments its version'
);

select extensions.is(
    (select count(*) from public.investment_decision_state_history where decision_id = (select decision_id from transition_test_context)),
    2::bigint,
    'decision transition appends history'
);

select extensions.is(
    public.app_transition_investment_decision(
        (select decision_id from transition_test_context), 1,
        (select adopt_key from transition_test_context),
        '{"action":"adopt","selected_option":"유지","reason":"현재 가설을 유지합니다.","authored_via":"app"}'::jsonb
    ) ->> 'version',
    '2',
    'an identical decision retry returns the stored response before version validation'
);

select extensions.is(
    (select count(*) from public.investment_decision_state_history where decision_id = (select decision_id from transition_test_context)),
    2::bigint,
    'decision retry does not append history'
);

select extensions.throws_ok(
    format(
        'select public.app_transition_investment_decision(%L::uuid, 1, %L::uuid, %L::jsonb)',
        (select decision_id from transition_test_context),
        '40000000-0000-0000-0000-000000000002',
        '{"action":"dismiss","reason":"변경","authored_via":"agent"}'
    ),
    'P0001', 'Decision version conflict',
    'a stale decision transition is rejected'
);

select extensions.throws_ok(
    format(
        'select public.app_transition_investment_decision(%L::uuid, 2, %L::uuid, %L::jsonb)',
        (select decision_id from transition_test_context),
        '40000000-0000-0000-0000-000000000003',
        '{"action":"dismiss","reason":"변경","authored_via":"agent"}'
    ),
    'P0001', 'Only a proposed decision can be adopted or dismissed',
    'an adopted decision cannot be silently changed'
);

with recorded as (
    select public.app_record_investment_decision(
        '40000000-0000-0000-0000-000000000011',
        jsonb_build_object(
            'status', 'adopted',
            'subject', jsonb_build_object('kind', 'instrument', 'instrument_id', 'MSFT'),
            'question', '유지를 계속할까?',
            'options', jsonb_build_array('유지'),
            'selected_option', '유지',
            'reason', '다음 실적을 확인합니다.',
            'timezone', 'Asia/Seoul',
            'authored_via', 'agent',
            'follow_up_tasks', jsonb_build_array(jsonb_build_object(
                'title', '다음 실적의 성장률 확인',
                'subject', jsonb_build_object('kind', 'instrument', 'instrument_id', 'MSFT')
            ))
        )
    ) result
), stored as (
    update transition_test_context
    set task_id = (select (result #>> '{tasks,0,id}')::uuid from recorded)
    returning task_id
)
select extensions.ok((select task_id is not null from stored), 'a research follow-up is available for transitions');

select extensions.is(
    public.app_transition_portfolio_task(
        (select task_id from transition_test_context), 1,
        '40000000-0000-0000-0000-000000000012',
        '{"action":"wait","reason":"실적 발표 대기","authored_via":"agent","evidence":[]}'::jsonb
    ) ->> 'research_state',
    'waiting',
    'an open task can move to waiting'
);

select extensions.throws_ok(
    format(
        'select public.app_transition_portfolio_task(%L::uuid, 2, %L::uuid, %L::jsonb)',
        (select task_id from transition_test_context),
        '40000000-0000-0000-0000-000000000013',
        '{"action":"resolve","answer":"성장 확인","authored_via":"agent","evidence":[]}'
    ),
    'P0001', 'Resolving a task needs evidence',
    'a task cannot be resolved without evidence'
);

select extensions.is(
    public.app_transition_portfolio_task(
        (select task_id from transition_test_context), 2,
        (select resolve_key from transition_test_context),
        jsonb_build_object(
            'action', 'resolve',
            'answer', '서비스 매출 성장률이 기준을 충족했습니다.',
            'reason', '공식 실적 자료 확인',
            'authored_via', 'agent',
            'evidence', jsonb_build_array(jsonb_build_object(
                'title', 'Microsoft earnings release',
                'source_url', 'https://www.microsoft.com/example',
                'summary', '공식 실적 발표 자료입니다.',
                'checked_at', '2026-09-21T01:00:00Z'
            ))
        )
    ) ->> 'research_state',
    'resolved',
    'a waiting task is resolved with an answer and evidence'
);

select extensions.is(
    (select answer from public.portfolio_task_history
     where task_id = (select task_id from transition_test_context) and version = 3),
    '서비스 매출 성장률이 기준을 충족했습니다.',
    'the resolved answer is stored in history'
);

select extensions.is(
    (select count(*) from public.portfolio_task_evidence where task_id = (select task_id from transition_test_context)),
    1::bigint,
    'resolution evidence is immutable task history data'
);

select extensions.is(
    public.app_transition_portfolio_task(
        (select task_id from transition_test_context), 2,
        (select resolve_key from transition_test_context),
        jsonb_build_object(
            'action', 'resolve',
            'answer', '서비스 매출 성장률이 기준을 충족했습니다.',
            'reason', '공식 실적 자료 확인',
            'authored_via', 'agent',
            'evidence', jsonb_build_array(jsonb_build_object(
                'title', 'Microsoft earnings release',
                'source_url', 'https://www.microsoft.com/example',
                'summary', '공식 실적 발표 자료입니다.',
                'checked_at', '2026-09-21T01:00:00Z'
            ))
        )
    ) ->> 'version',
    '3',
    'an identical task retry returns the original result'
);

select extensions.throws_ok(
    format(
        'select public.app_transition_portfolio_task(%L::uuid, 3, %L::uuid, %L::jsonb)',
        (select task_id from transition_test_context),
        '40000000-0000-0000-0000-000000000014',
        '{"action":"reopen","reason":"정정 필요","authored_via":"agent","evidence":[]}'
    ),
    'P0001', 'Reopening a task needs a reason and new evidence',
    'a resolved task cannot reopen without new evidence'
);

select extensions.is(
    (select count(*) from public.activity_events
     where user_id = auth.uid() and action_type in ('transition_investment_decision', 'transition_portfolio_task')),
    3::bigint,
    'successful transitions create audit events only once'
);

select extensions.is(
    jsonb_array_length(public.app_get_daily_context('Asia/Seoul', null) -> 'open_tasks'),
    0,
    'resolved tasks do not return as open work in the next daily context'
);

select set_config('request.jwt.claim.sub', (select other_id::text from transition_test_context), true);

select extensions.is(
    public.app_get_portfolio_task((select task_id from transition_test_context)),
    null::jsonb,
    'another user cannot read the transitioned task'
);

select extensions.throws_ok(
    format(
        'select public.app_transition_portfolio_task(%L::uuid, 3, %L::uuid, %L::jsonb)',
        (select task_id from transition_test_context),
        '40000000-0000-0000-0000-000000000015',
        '{"action":"pause","authored_via":"agent","evidence":[]}'
    ),
    'P0001', 'Task was not found',
    'another user cannot transition the task'
);

select * from extensions.finish();
rollback;
