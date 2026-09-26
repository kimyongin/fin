begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(14);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001001','authenticated','authenticated','sharing-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001002','authenticated','authenticated','sharing-viewer@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001003','authenticated','authenticated','sharing-other@example.com','',now(),now(),now());
set local role postgres;
insert into friendships(viewer_user_id,owner_user_id)
values('00000000-0000-0000-0000-000000001002','00000000-0000-0000-0000-000000001001');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001001',true);
set local role authenticated;
select extensions.throws_ok($$select public.set_viewer_profile('owner','secret',true)$$,
  'P0001','Refresh the app to enable whole-portfolio sharing','old client cannot expand sharing');
select extensions.throws_ok($$select public.set_viewer_profile('owner','secret',true,'old_scope')$$,
  'P0001','Whole-portfolio share scope is required','new client must name full scope');
select extensions.is((public.set_viewer_profile('owner','secret',false,'portfolio_all')).sharing_enabled,
  false,'credentials alone do not turn sharing on');
select extensions.is((public.set_viewer_profile('owner','',true,'portfolio_all')).sharing_enabled,
  true,'explicit full-scope request turns sharing on');
select extensions.lives_ok($$select public.app_create_activity('11111111-1111-4111-8111-111111111111',
  '{"title":"공유 기록","body":"사용자가 공개할 본문"}'::jsonb)$$,'owner records an activity');
create temporary table sharing_activity_target as select id from public.activity_events where title='공유 기록';
select extensions.lives_ok($$select public.app_save_general_task(null,null,'11222222-2222-4222-8222-222222222222',
  '{"title":"다음 확인","subject":{"kind":"portfolio"},"timezone":"Asia/Seoul","authored_via":"app"}'::jsonb)$$,
  'owner records a task');
create temporary table sharing_task_target as select id from public.portfolio_tasks where title='다음 확인';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001002',true);
select extensions.ok(public.can_view_feature('00000000-0000-0000-0000-000000001001','assets'),'friend reads assets');
select extensions.ok(public.can_view_feature('00000000-0000-0000-0000-000000001001','principles'),'friend reads principles');
select extensions.ok(not public.can_view_feature('00000000-0000-0000-0000-000000001001','briefings'),'retired key stays denied');
select extensions.ok((public.app_get_shared_feature_access('00000000-0000-0000-0000-000000001001')->'features'->>'activity')::boolean,
  'effective access includes activity');
select extensions.is(public.app_get_activity((select id from sharing_activity_target),
  '00000000-0000-0000-0000-000000001001')->>'body','사용자가 공개할 본문','friend reads activity');
select extensions.is(public.app_get_activity((select id from sharing_activity_target),
  '00000000-0000-0000-0000-000000001001')->>'after_data',null::text,'internal payload stays private');
select extensions.is(public.app_get_general_task_for_owner('00000000-0000-0000-0000-000000001001',
  (select id from sharing_task_target))->>'title','다음 확인','friend reads task');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001003',true);
select extensions.ok(not public.can_view_feature('00000000-0000-0000-0000-000000001001','assets'),'unrelated user is denied');
select * from extensions.finish();
rollback;
