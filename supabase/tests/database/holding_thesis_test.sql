begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(15);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
    ('00000000-0000-0000-0000-000000000601', 'authenticated', 'authenticated', 'thesis-owner@example.com', '', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000602', 'authenticated', 'authenticated', 'thesis-other@example.com', '', now(), now(), now());

set local role postgres;
insert into public.instruments (id, user_id, ticker, display_name, currency, instrument_type)
values (9601, '00000000-0000-0000-0000-000000000601', 'THESIS', 'Thesis Asset', 'KRW', 'market');
insert into public.accounts (id, user_id, name)
values
    (9601, '00000000-0000-0000-0000-000000000601', 'Owner Account'),
    (9602, '00000000-0000-0000-0000-000000000602', 'Other Account');
insert into public.holdings (user_id, account_id, ticker, quantity, avg_price)
values ('00000000-0000-0000-0000-000000000601', 9601, 'THESIS', 3, 100);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000601', true);
set local role authenticated;

select extensions.is(
    public.app_get_holding_thesis(9601, null) -> 'applied',
    'null'::jsonb,
    'a missing thesis remains unknown'
);

select extensions.is(
    public.app_save_holding_thesis(
        9601, null, null, '60000000-0000-0000-0000-000000000001',
        '{"reason_text":"장기 성장성을 보고 보유한다.","horizon_text":"3년 이상","review_condition_text":"성장률 둔화 여부","next_review_date":"2026-10-15"}'::jsonb,
        '종목 공통 보유 이유를 처음 기록합니다.', 'app'
    ) #>> '{thesis,version}',
    '1',
    'the owner can create an instrument thesis'
);

select extensions.is(
    public.app_get_holding_thesis(9601, 9601) #>> '{applied_scope}',
    'instrument',
    'an account falls back to the instrument thesis'
);

select extensions.is(
    public.app_save_holding_thesis(
        9601, 9601, null, '60000000-0000-0000-0000-000000000002',
        '{"reason_text":"이 계좌에서는 절세 목적까지 포함해 보유한다."}'::jsonb,
        '계좌별 재정의를 추가합니다.', 'agent'
    ) #>> '{thesis,version}',
    '1',
    'the owner can create an account override'
);

select extensions.is(
    public.app_get_holding_thesis(9601, 9601) #>> '{applied_scope}',
    'account',
    'the account override wins when present'
);

select extensions.is(
    jsonb_array_length(public.app_list_holding_theses()),
    2,
    'the list exposes base and override records separately'
);

select extensions.is(
    public.app_save_holding_thesis(
        9601, null, 1, '60000000-0000-0000-0000-000000000003',
        '{"horizon_text":"5년 이상","next_review_date":null}'::jsonb,
        '기간을 늘리고 날짜를 비웁니다.', 'app'
    ) #>> '{thesis,version}',
    '2',
    'a partial patch increments the version'
);

select extensions.is(
    public.app_get_holding_thesis(9601, null) #>> '{instrument_base,reason_text}',
    '장기 성장성을 보고 보유한다.',
    'a partial patch preserves omitted fields'
);

select extensions.is(
    public.app_get_holding_thesis(9601, null) #>> '{instrument_base,next_review_date}',
    null::text,
    'an explicit null clears the review date'
);

select extensions.is(
    public.app_save_holding_thesis(
        9601, null, 1, '60000000-0000-0000-0000-000000000003',
        '{"horizon_text":"5년 이상","next_review_date":null}'::jsonb,
        '기간을 늘리고 날짜를 비웁니다.', 'app'
    ) #>> '{thesis,version}',
    '2',
    'an identical retry returns the stored response'
);

select extensions.is(
    (select count(*) from public.holding_thesis_history where user_id = auth.uid()),
    3::bigint,
    'retries do not duplicate history'
);

select extensions.throws_ok(
    $$select public.app_save_holding_thesis(
        9601, null, 1, '60000000-0000-0000-0000-000000000004',
        '{"horizon_text":"오래된 변경"}'::jsonb, '충돌 확인', 'agent'
    )$$,
    'P0001', 'Holding thesis version conflict',
    'a stale version is rejected'
);

select extensions.throws_ok(
    $$select public.app_save_holding_thesis(
        9601, 9602, null, '60000000-0000-0000-0000-000000000005',
        '{"reason_text":"잘못된 계좌"}'::jsonb, '잘못된 계좌', 'agent'
    )$$,
    'P0001', 'Account does not hold this instrument',
    'an unrelated account cannot become an override scope'
);

select extensions.is(
    jsonb_array_length(public.app_create_daily_context('Asia/Seoul', null) #> '{snapshot,holding_theses}'),
    2,
    'daily context includes current holding theses'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000602', true);
select extensions.throws_ok(
    $$select public.app_get_holding_thesis(9601, null)$$,
    'P0001', 'Instrument was not found or is not accessible',
    'another user cannot read the owner thesis'
);

select * from extensions.finish();
rollback;
