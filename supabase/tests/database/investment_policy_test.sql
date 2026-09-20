begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(16);

create temp table policy_test_context (
    owner_id uuid not null,
    other_id uuid not null,
    create_key uuid not null,
    update_key uuid not null
) on commit drop;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
    ('00000000-0000-0000-0000-000000000501', 'authenticated', 'authenticated', 'policy-owner@example.com', '', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000502', 'authenticated', 'authenticated', 'policy-other@example.com', '', now(), now(), now());

insert into policy_test_context (owner_id, other_id, create_key, update_key)
values (
    '00000000-0000-0000-0000-000000000501',
    '00000000-0000-0000-0000-000000000502',
    '50000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000002'
);

grant select on policy_test_context to authenticated;
select set_config('request.jwt.claim.sub', (select owner_id::text from policy_test_context), true);
set local role authenticated;

select extensions.is(
    public.app_get_investment_policy() -> 'profile',
    'null'::jsonb,
    'a missing policy remains missing instead of becoming inferred defaults'
);

select extensions.is(
    public.app_save_investment_policy(
        null,
        (select create_key from policy_test_context),
        jsonb_build_object(
            'raw_text', '장기 투자하고 자주 매매하지 않는다.',
            'goal_text', '은퇴 자산을 장기적으로 늘린다.',
            'horizon_text', '10년 이상',
            'trading_preference_text', '잦은 매매를 피한다.',
            'restrictions', jsonb_build_array(
                jsonb_build_object('kind', 'prohibition', 'text', '레버리지 상품은 매수하지 않는다.'),
                jsonb_build_object('kind', 'preference', 'text', '적립식 매수를 선호한다.')
            )
        ),
        '처음 투자 기준을 저장합니다.',
        'app'
    ) #>> '{profile,version}',
    '1',
    'the owner can create a versioned investment policy'
);

select extensions.is(
    (select count(*) from public.investment_policy_history where user_id = auth.uid()),
    1::bigint,
    'creating a policy stores its first history snapshot'
);

select extensions.is(
    public.app_save_investment_policy(
        1,
        (select update_key from policy_test_context),
        '{"goal_text":null,"risk_tolerance_text":"큰 변동성은 감수하지만 원금 전액 손실 가능 상품은 피한다."}'::jsonb,
        '목표 표현을 비우고 위험 기준을 추가합니다.',
        'agent'
    ) #>> '{profile,version}',
    '2',
    'a partial patch increments the policy version'
);

select extensions.is(
    public.app_get_investment_policy() #>> '{profile,raw_text}',
    '장기 투자하고 자주 매매하지 않는다.',
    'a partial patch preserves omitted fields'
);

select extensions.is(
    public.app_get_investment_policy() #>> '{profile,goal_text}',
    null::text,
    'an explicit null clears an optional field'
);

select extensions.is(
    (select count(*) from public.investment_policy_history where user_id = auth.uid()),
    2::bigint,
    'updating a policy appends history'
);

select extensions.is(
    public.app_save_investment_policy(
        1,
        (select update_key from policy_test_context),
        '{"goal_text":null,"risk_tolerance_text":"큰 변동성은 감수하지만 원금 전액 손실 가능 상품은 피한다."}'::jsonb,
        '목표 표현을 비우고 위험 기준을 추가합니다.',
        'agent'
    ) #>> '{profile,version}',
    '2',
    'an identical retry returns the original response before version validation'
);

select extensions.is(
    (select count(*) from public.investment_policy_history where user_id = auth.uid()),
    2::bigint,
    'an identical retry does not duplicate history'
);

select extensions.throws_ok(
    $$select public.app_save_investment_policy(
        1, '50000000-0000-0000-0000-000000000003',
        '{"horizon_text":"변경"}'::jsonb, '오래된 변경', 'agent'
    )$$,
    'P0001', 'Investment policy version conflict',
    'a stale policy patch is rejected'
);

select extensions.throws_ok(
    $$select public.app_save_investment_policy(
        2, '50000000-0000-0000-0000-000000000004',
        '{"invented_score":7}'::jsonb, '알 수 없는 필드', 'agent'
    )$$,
    'P0001', 'Policy patch contains an unknown field',
    'unknown inferred profile fields are rejected'
);

select extensions.throws_ok(
    $$select public.app_save_investment_policy(
        2, '50000000-0000-0000-0000-000000000005',
        '{"restrictions":[{"kind":"limit","text":"임의 숫자 한도"}]}'::jsonb,
        '잘못된 제한', 'agent'
    )$$,
    'P0001', 'Each policy restriction needs kind and text',
    'a restriction must distinguish preference from prohibition'
);

select extensions.is(
    public.app_create_daily_context('Asia/Seoul', null) #>> '{snapshot,investment_policy,version}',
    '2',
    'daily review context includes the current policy version'
);

select extensions.is(
    (select count(*) from public.activity_events where user_id = auth.uid() and action_type = 'save_investment_policy'),
    2::bigint,
    'successful policy changes create one audit event each'
);

select set_config('request.jwt.claim.sub', (select other_id::text from policy_test_context), true);

select extensions.is(
    public.app_get_investment_policy() -> 'profile',
    'null'::jsonb,
    'another user cannot read the owner policy'
);

select extensions.throws_ok(
    $$select public.app_save_investment_policy(
        2, '50000000-0000-0000-0000-000000000006',
        '{"goal_text":"타인 변경"}'::jsonb, '타인 변경', 'agent'
    )$$,
    'P0001', 'Investment policy version conflict',
    'another user cannot update the owner version'
);

select * from extensions.finish();
rollback;
