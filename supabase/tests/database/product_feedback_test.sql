begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(27);

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000001501', 'authenticated', 'authenticated', 'feedback-owner@example.com', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000001502', 'authenticated', 'authenticated', 'feedback-other@example.com', '', now(), now(), now());

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001501', true);
set local role authenticated;

select extensions.is(
  public.app_submit_product_feedback(
    '  모바일 필터가 너무 깁니다.  ',
    '{"page_key":"instruments","app_version":"1.0.0"}'::jsonb,
    'app',
    '15111111-1111-4111-8111-111111111111'
  )->>'status',
  'received',
  'authenticated user can submit feedback'
);

select extensions.is(
  public.app_submit_product_feedback(
    '모바일 필터가 너무 깁니다.',
    '{"page_key":"instruments","app_version":"1.0.0"}'::jsonb,
    'app',
    '15111111-1111-4111-8111-111111111111'
  )->>'body',
  '모바일 필터가 너무 깁니다.',
  'an identical retry returns the stored response'
);

select extensions.is((select count(*) from public.product_feedback), 1::bigint, 'an identical retry does not duplicate feedback');

select extensions.throws_ok(
  $$select public.app_submit_product_feedback('다른 내용', '{"page_key":"instruments"}'::jsonb, 'app', '15111111-1111-4111-8111-111111111111')$$,
  'P0001',
  'idempotency key already used with a different request',
  'an idempotency key cannot be reused for another request'
);

select extensions.throws_ok(
  $$select public.app_submit_product_feedback('내용', '{"email":"secret@example.com"}'::jsonb, 'app', '15111111-1111-4111-8111-111111111112')$$,
  'P0001',
  'feedback context contains an unsupported field',
  'unknown context fields are rejected'
);

select extensions.throws_ok(
  $$select public.app_submit_product_feedback(' ', '{}'::jsonb, 'app', '15111111-1111-4111-8111-111111111113')$$,
  'P0001',
  'feedback body must contain 1 to 4000 characters',
  'blank feedback is rejected'
);

select extensions.throws_ok(
  $$select public.app_submit_product_feedback('내용', '{}'::jsonb, 'webhook', '15111111-1111-4111-8111-111111111114')$$,
  'P0001',
  'invalid feedback source',
  'unknown feedback sources are rejected'
);

select extensions.is(jsonb_array_length(public.app_list_my_product_feedback()->'items'), 1, 'the reporter can list their feedback');
select extensions.ok(not (public.app_list_my_product_feedback()->>'is_admin')::boolean, 'ordinary reporters are not admins');

set local role postgres;
insert into public.product_feedback_admins(user_id) values ('00000000-0000-0000-0000-000000001501');
set local role authenticated;
select extensions.ok(public.app_is_product_feedback_admin(), 'an allowlisted user is recognized as an admin');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001502', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000001502","is_anonymous":true}', true);
select extensions.throws_ok(
  $$select public.app_submit_product_feedback('익명 접수', '{}'::jsonb, 'app', '15222222-2222-4222-8222-222222222221')$$,
  'P0001',
  'anonymous sessions cannot submit product feedback',
  'anonymous sessions cannot submit feedback'
);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000001502","is_anonymous":false}', true);
select extensions.is(jsonb_array_length(public.app_list_my_product_feedback()->'items'), 0, 'another user cannot list the reporter feedback');
select extensions.is((select count(*) from public.product_feedback), 0::bigint, 'RLS hides another user feedback from direct selects');
select extensions.is(
  public.app_submit_product_feedback('다른 사용자의 제안', '{"page_key":"today"}'::jsonb, 'mcp', '15222222-2222-4222-8222-222222222222')->>'source',
  'mcp',
  'another user can submit private feedback'
);
select extensions.throws_ok(
  $$select public.app_list_product_feedback_admin(null, 20, null)$$,
  'P0001',
  'feedback administrator access required',
  'a reporter cannot read the admin queue'
);
select extensions.throws_ok(
  $$select public.app_update_product_feedback_admin((public.app_list_my_product_feedback()#>>'{items,0,id}')::uuid, 1, 'reviewing', '검토 중', null)$$,
  'P0001',
  'feedback administrator access required',
  'a reporter cannot triage feedback'
);
select extensions.lives_ok(
  $$update public.product_feedback set body = '직접 변경'$$,
  'another authenticated user cannot use a direct update to reach hidden feedback'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001501', true);
select extensions.is((select body from public.product_feedback limit 1), '모바일 필터가 너무 깁니다.', 'the hidden row was not changed');
select extensions.is(jsonb_array_length(public.app_list_product_feedback_admin(null, 20, 'received')->'items'), 2, 'an admin can filter and list the full queue');
select extensions.is(
  public.app_update_product_feedback_admin(
    (select (item->>'id')::uuid from jsonb_array_elements(public.app_list_product_feedback_admin(null, 20, null)->'items') as item where item->>'body' = '다른 사용자의 제안'),
    1,
    'resolved',
    '수정 내용을 배포했습니다.',
    'https://github.com/kimyongin/fin/issues/68'
  )->>'status',
  'resolved',
  'an admin can resolve feedback with a response and issue link'
);
select extensions.throws_ok(
  $$select public.app_update_product_feedback_admin((select (item->>'id')::uuid from jsonb_array_elements(public.app_list_product_feedback_admin(null, 20, null)->'items') as item where item->>'body' = '다른 사용자의 제안'), 1, 'planned', '다음 배포', null)$$,
  'P0001',
  'feedback version conflict',
  'a stale admin update cannot overwrite a newer response'
);
select extensions.throws_ok(
  $$select public.app_update_product_feedback_admin((select id from public.product_feedback limit 1), 1, 'planned', '검토', 'http://github.com/kimyongin/fin/issues/68')$$,
  'P0001',
  'github issue URL must be a canonical HTTPS issue URL',
  'noncanonical issue links are rejected'
);
select extensions.throws_ok(
  $$select public.app_update_product_feedback_admin((select id from public.product_feedback limit 1), 1, 'resolved', null, null)$$,
  'P0001',
  'resolved feedback requires a response',
  'resolved feedback requires a user-visible response'
);
set local role postgres;
select extensions.is((select count(*) from public.product_feedback_admin_events), 1::bigint, 'admin changes create one minimal audit event');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001502', true);
select extensions.is(public.app_list_my_product_feedback()#>>'{items,0,status}', 'resolved', 'the reporter sees the updated status');
select extensions.is(public.app_list_my_product_feedback()#>>'{items,0,response}', '수정 내용을 배포했습니다.', 'the reporter sees the admin response');
select extensions.is(public.app_list_my_product_feedback()#>>'{items,0,github_issue_url}', 'https://github.com/kimyongin/fin/issues/68', 'the reporter sees the linked issue');

select * from extensions.finish();
rollback;
