begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select extensions.plan(16);

create temp table decision_task_test_context (
    owner_id uuid not null,
    other_id uuid not null,
    decision_id uuid,
    task_id uuid,
    idempotency_key uuid not null,
    payload jsonb not null
) on commit drop;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
    ('00000000-0000-0000-0000-000000000301', 'authenticated', 'authenticated', 'decision-owner@example.com', '', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000302', 'authenticated', 'authenticated', 'decision-other@example.com', '', now(), now(), now());

insert into decision_task_test_context (owner_id, other_id, idempotency_key, payload)
values (
    '00000000-0000-0000-0000-000000000301',
    '00000000-0000-0000-0000-000000000302',
    '30000000-0000-0000-0000-000000000001',
    jsonb_build_object(
        'status', 'adopted',
        'subject', jsonb_build_object('kind', 'instrument', 'instrument_id', 'AAPL'),
        'question', '실적 발표 전까지 보유를 유지할까?',
        'options', jsonb_build_array('유지', '축소 검토'),
        'selected_option', '유지',
        'reason', '핵심 가설을 훼손한 새 사실이 아직 없습니다.',
        'uncertainty', '다음 분기 성장률은 아직 확인되지 않았습니다.',
        'review_condition', '다음 실적 발표',
        'policy_snapshot', jsonb_build_object('summary', '장기 보유 원칙'),
        'timezone', 'Asia/Seoul',
        'authored_via', 'agent',
        'follow_up_tasks', jsonb_build_array(jsonb_build_object(
            'title', '다음 실적에서 서비스 매출 성장률 확인',
            'subject', jsonb_build_object('kind', 'instrument', 'instrument_id', 'AAPL'),
            'trigger_text', '다음 분기 실적 발표'
        ))
    )
);

grant select, update on decision_task_test_context to authenticated;
select set_config('request.jwt.claim.sub', (select owner_id::text from decision_task_test_context), true);
set local role authenticated;

with recorded as (
    select public.app_record_investment_decision(
        (select idempotency_key from decision_task_test_context),
        (select payload from decision_task_test_context)
    ) result
), stored as (
    update decision_task_test_context
    set decision_id = (select (result ->> 'id')::uuid from recorded),
        task_id = (select (result #>> '{tasks,0,id}')::uuid from recorded)
    returning decision_id, task_id
)
select extensions.ok(
    (select decision_id is not null and task_id is not null from stored),
    'record creates an adopted decision and linked research task'
);

select extensions.is(
    (select status from public.investment_decisions where id = (select decision_id from decision_task_test_context)),
    'adopted',
    'decision stores adopted status'
);

select extensions.is(
    (select research_state from public.portfolio_tasks where id = (select task_id from decision_task_test_context)),
    'open',
    'follow-up task starts open'
);

select extensions.is(
    (select kind from public.portfolio_tasks where id = (select task_id from decision_task_test_context)),
    'research',
    'follow-up task cannot be mistaken for an execution plan'
);

select extensions.is(
    (select count(*) from public.investment_decision_state_history where decision_id = (select decision_id from decision_task_test_context)),
    1::bigint,
    'initial decision history is stored'
);

select extensions.is(
    (select count(*) from public.portfolio_task_history where task_id = (select task_id from decision_task_test_context)),
    1::bigint,
    'initial task history is stored'
);

select extensions.is(
    (select count(*) from public.investment_decision_tasks where decision_id = (select decision_id from decision_task_test_context)),
    1::bigint,
    'decision and task are linked with snapshots'
);

select extensions.is(
    jsonb_array_length(public.app_list_investment_decisions()),
    1,
    'decision list returns the owner decision'
);

select extensions.is(
    jsonb_array_length(public.app_list_portfolio_tasks('open')),
    1,
    'task list filters current research state'
);

select extensions.is(
    jsonb_array_length(public.app_get_daily_context('Asia/Seoul', null) -> 'open_tasks'),
    0,
    'current context excludes the retired research-task state from pending work'
);

select extensions.is(
    public.app_record_investment_decision(
        (select idempotency_key from decision_task_test_context),
        (select payload from decision_task_test_context)
    ) ->> 'id',
    (select decision_id::text from decision_task_test_context),
    'an identical retry returns the original decision'
);

select extensions.is(
    (select count(*) from public.investment_decisions where user_id = auth.uid()),
    1::bigint,
    'an identical retry does not duplicate the decision'
);

select extensions.throws_ok(
    format(
        'select public.app_record_investment_decision(%L::uuid, %L::jsonb)',
        (select idempotency_key from decision_task_test_context),
        (select payload || jsonb_build_object('reason', 'changed') from decision_task_test_context)
    ),
    'P0001',
    'Idempotency key was already used with a different request',
    'the same key cannot be reused for changed input'
);

select extensions.throws_ok(
    $$select public.app_record_investment_decision(
        '30000000-0000-0000-0000-000000000002',
        '{"status":"adopted","subject":{"kind":"portfolio"},"question":"유지할까?","options":["유지"],"follow_up_tasks":[]}'::jsonb
    )$$,
    'P0001',
    'Adopted decision needs selected_option and reason',
    'adopted decision requires an explicit selection and reason'
);

select set_config('request.jwt.claim.sub', (select other_id::text from decision_task_test_context), true);

select extensions.is(
    public.app_get_investment_decision((select decision_id from decision_task_test_context)),
    null::jsonb,
    'another user cannot read the decision'
);

select extensions.is(
    jsonb_array_length(public.app_list_portfolio_tasks()),
    0,
    'another user cannot list the task'
);

select * from extensions.finish();
rollback;
