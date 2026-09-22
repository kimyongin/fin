begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(17);

create temp table operating_rule_test_context (
    owner_id uuid not null,
    other_id uuid not null,
    rule_id uuid not null,
    create_key uuid not null,
    update_key uuid not null,
    archive_key uuid not null
) on commit drop;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
    ('00000000-0000-0000-0000-000000000711', 'authenticated', 'authenticated', 'rule-owner@example.com', '', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000712', 'authenticated', 'authenticated', 'rule-other@example.com', '', now(), now(), now());

insert into operating_rule_test_context values (
    '00000000-0000-0000-0000-000000000711', '00000000-0000-0000-0000-000000000712',
    '71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002',
    '71000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000004'
);
grant select on operating_rule_test_context to authenticated;

select set_config('request.jwt.claim.sub', (select owner_id::text from operating_rule_test_context), true);
set local role authenticated;

select extensions.is(public.app_list_operating_rules('reconciliation', false) -> 'rules', '[]'::jsonb,
    'a new owner has an explicit empty operating-rule list');

select extensions.is(
    public.app_save_operating_rule(
        (select rule_id from operating_rule_test_context), null, (select create_key from operating_rule_test_context),
        '미래에셋 XLS 잔고', 'reconciliation', '미래에셋 국내주식 잔고 XLS',
        '평균가가 없으면 매입금액을 수량으로 나눈다. 수량이 0이면 계산하지 않는다.',
        '반복해서 사용할 파일 해석 기준을 저장합니다.', 'app'
    ) #>> '{rule,version}', '1', 'the owner can create a versioned operating rule');

select extensions.is(jsonb_array_length(public.app_list_operating_rules('reconciliation', false) -> 'rules'), 1,
    'the active rule is listed for its workflow');
select extensions.is((select count(*) from public.operating_rule_history where user_id = auth.uid()), 1::bigint,
    'creating a rule stores history');
select extensions.is(
    public.app_save_operating_rule(
        (select rule_id from operating_rule_test_context), null, (select create_key from operating_rule_test_context),
        '미래에셋 XLS 잔고', 'reconciliation', '미래에셋 국내주식 잔고 XLS',
        '평균가가 없으면 매입금액을 수량으로 나눈다. 수량이 0이면 계산하지 않는다.',
        '반복해서 사용할 파일 해석 기준을 저장합니다.', 'app'
    ) #>> '{rule,version}', '1', 'an identical create retry returns the original response');

select extensions.throws_ok(
    $$select public.app_save_operating_rule(
        '71000000-0000-0000-0000-000000000001', null, '71000000-0000-0000-0000-000000000002',
        '다른 제목', 'reconciliation', '미래에셋 국내주식 잔고 XLS', '본문', '이유', 'app')$$,
    'P0001', 'Idempotency key was already used with a different request',
    'an idempotency key cannot be reused for a different request');

select extensions.is(
    public.app_save_operating_rule(
        (select rule_id from operating_rule_test_context), 1, (select update_key from operating_rule_test_context),
        '미래에셋 XLS 잔고', 'reconciliation', '미래에셋 국내주식 잔고 XLS이며 통화가 KRW로 표시됨',
        '매입금액은 평가금액이 아니다. 평균가는 매입금액/수량이며 수량 0은 계산하지 않는다.',
        '통화와 금액 열의 의미를 명확히 합니다.', 'agent'
    ) #>> '{rule,version}', '2', 'the current version can be updated');
select extensions.is(public.app_list_operating_rules('reconciliation', false) #>> '{rules,0,body}',
    '매입금액은 평가금액이 아니다. 평균가는 매입금액/수량이며 수량 0은 계산하지 않는다.',
    'the updated body is returned');
select extensions.is((select count(*) from public.operating_rule_history where user_id = auth.uid()), 2::bigint,
    'updating a rule appends history');

select extensions.throws_ok(
    $$select public.app_save_operating_rule(
        '71000000-0000-0000-0000-000000000001', 1, gen_random_uuid(),
        '제목', 'reconciliation', '조건', '본문', '이유', 'app')$$,
    'P0001', 'Operating rule version conflict', 'a stale edit is rejected');

select extensions.is(
    public.app_archive_operating_rule(
        (select rule_id from operating_rule_test_context), 2, (select archive_key from operating_rule_test_context),
        '새 양식으로 바뀌어 더 이상 적용하지 않습니다.', 'app'
    ) #>> '{rule,status}', 'archived', 'the owner can archive the current rule');
select extensions.is(public.app_list_operating_rules('reconciliation', false) -> 'rules', '[]'::jsonb,
    'archived rules are excluded by default');
select extensions.is(jsonb_array_length(public.app_list_operating_rules('reconciliation', true) -> 'rules'), 1,
    'archived rules can be requested explicitly');
select extensions.is(
    public.app_archive_operating_rule(
        (select rule_id from operating_rule_test_context), 2, (select archive_key from operating_rule_test_context),
        '새 양식으로 바뀌어 더 이상 적용하지 않습니다.', 'app'
    ) #>> '{rule,version}', '3', 'an identical archive retry returns the original response');

select set_config('request.jwt.claim.sub', (select other_id::text from operating_rule_test_context), true);
select extensions.is(public.app_list_operating_rules('reconciliation', true) -> 'rules', '[]'::jsonb,
    'another user cannot list the owner rule');
select extensions.throws_ok(
    $$select public.app_save_operating_rule(
        '71000000-0000-0000-0000-000000000001', 3, gen_random_uuid(),
        '제목', 'reconciliation', '조건', '본문', '이유', 'app')$$,
    'P0001', 'Operating rule not found', 'another user cannot update the owner rule');
select extensions.is((select count(*) from public.operating_rules), 0::bigint,
    'RLS hides direct owner rows from another authenticated user');

select * from extensions.finish();
rollback;
