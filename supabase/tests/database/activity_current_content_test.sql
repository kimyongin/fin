begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(18);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001901','authenticated','authenticated','activity-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001902','authenticated','authenticated','activity-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001901',true);
set local role authenticated;

select extensions.is(
  public.app_create_activity('19111111-1111-4111-8111-111111111111',jsonb_build_object(
    'title','실적 자료 확인','body','보유 유지. 다음 실적까지 관찰',
    'occurred_at',(clock_timestamp()-interval '1 hour')::text,'timezone','Asia/Seoul','authored_via','app'
  ))->>'title',
  '실적 자료 확인',
  'creates one editable activity'
);
select extensions.is((select count(*) from activity_events where title='실적 자료 확인'),1::bigint,'creation stores one event');
select extensions.is((select version from activity_events where title='실적 자료 확인'),1,'new activity starts at version one');
select extensions.is(
  public.app_create_activity('19111111-1111-4111-8111-111111111111',jsonb_build_object(
    'title','실적 자료 확인','body','보유 유지. 다음 실적까지 관찰',
    'occurred_at',(select occurred_at::text from activity_events where title='실적 자료 확인'),'timezone','Asia/Seoul','authored_via','app'
  ))->>'title',
  '실적 자료 확인',
  'identical creation retry returns the stored activity'
);
select extensions.is((select count(*) from activity_events where title='실적 자료 확인'),1::bigint,'creation retry does not duplicate activity');

select extensions.is(
  public.app_update_activity(
    (select id from activity_events where title='실적 자료 확인'),1,
    '19222222-2222-4222-8222-222222222222',
    jsonb_build_object('body','보유 유지, 다음 달 재확인. 컨퍼런스콜 확인 필요'),'app'
  )->>'body',
  '보유 유지, 다음 달 재확인. 컨퍼런스콜 확인 필요',
  'updates the current body on the same activity'
);
select extensions.is((select version from activity_events where title='실적 자료 확인'),2,'editing advances only the current activity version');
select extensions.is((select count(*) from activity_events where title='실적 자료 확인'),1::bigint,'editing does not add another activity');
select extensions.throws_ok(
  $$select public.app_update_activity((select id from activity_events where title='실적 자료 확인'),1,
    '19333333-3333-4333-8333-333333333333','{"body":"stale"}'::jsonb,'agent')$$,
  'P0001','Activity version conflict','stale activity edits fail closed'
);

select extensions.is(
  public.app_save_general_task(null,null,'19444444-4444-4444-8444-444444444444',jsonb_build_object(
    'title','자동 변경 만들기','subject',jsonb_build_object('kind','portfolio'),'timezone','Asia/Seoul',
    'recurrence_kind','none','authored_via','app'
  ))->>'title',
  '자동 변경 만들기',
  'existing task write remains compatible'
);
select extensions.is(public.app_update_activity(
    (select id from activity_events where action_type='create_general_task'),1,
    '19555555-5555-4555-8555-555555555555','{"title":"자동 기록 제목 정정"}'::jsonb,'app')->>'title',
  '자동 기록 제목 정정','automatic record title is editable without changing the task');
select extensions.is(
  public.app_update_activity((select id from activity_events where action_type='create_general_task'),2,
    '19666666-6666-4666-8666-666666666666','{"body":"자동 기록 설명"}'::jsonb,'app')->>'body',
  '자동 기록 설명',
  'automatic event note remains editable'
);

select extensions.is(
  public.app_save_general_task(null,null,'19777777-7777-4777-8777-777777777777',
    jsonb_build_object('title','다음 실적 확인','subject',jsonb_build_object('kind','portfolio'),
      'trigger_text','실적 발표 확인','due_date',current_date::text,
      'timezone','Asia/Seoul','recurrence_kind','none','authored_via','app'))->>'title',
  '다음 실적 확인','scheduled intent is an independent task');
select extensions.is((select count(*) from information_schema.columns where table_schema='public' and table_name='portfolio_tasks' and column_name='origin_event_id'),0::bigint,'reverse follow-up column is retired');
select extensions.is(public.app_transition_general_task(
  (select id from portfolio_tasks where title='다음 실적 확인'),1,'complete','실적 확인 완료',null,
  null,'19888888-8888-4888-8888-888888888888','app') #>> '{status}',
  'done','completing a task creates a performed fact');
select extensions.is(public.app_get_activity(
  (select id from activity_events where action_type='complete_general_task' and title='다음 실적 확인'),null) #>> '{origin_task,title}',
  '다음 실적 확인','completion detail includes the original task title');
select extensions.is(public.app_get_activity(
  (select id from activity_events where action_type='complete_general_task' and title='다음 실적 확인'),null) #>> '{origin_task,trigger_text}',
  '실적 발표 확인','completion detail includes the original task instructions');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001902',true);
select extensions.is(public.app_get_activity((select id from activity_events where title='실적 자료 확인'),null),null,'another user cannot read the activity');

select * from extensions.finish();
rollback;
