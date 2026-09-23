begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(18);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001001','authenticated','authenticated','sharing-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001002','authenticated','authenticated','sharing-viewer@example.com','',now(),now(),now());
set local role postgres;
insert into profiles(user_id,public_name,public_name_normalized,sharing_enabled)
values('00000000-0000-0000-0000-000000001001','owner','owner',true);
insert into friendships(viewer_user_id,owner_user_id)
values('00000000-0000-0000-0000-000000001002','00000000-0000-0000-0000-000000001001');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001001',true);
set local role authenticated;
select extensions.is(public.app_get_sharing_policy()->>'preset','portfolio_only','new owner keeps portfolio-only preset');
select extensions.is((public.app_get_sharing_policy()->'grants'->>'activity')::boolean,false,'new activity sharing defaults private');
select extensions.is(public.app_update_sharing_policy(0,'{"activity":true,"tasks":true}'::jsonb)->>'preset','custom','explicit activity and task grants update atomically');
select extensions.throws_ok($$select public.app_update_sharing_policy(0,'{"activity":false}'::jsonb)$$,
  'P0001','Sharing policy version conflict','stale update rejected');
select extensions.throws_ok($$select public.app_update_sharing_policy(1,'{"briefings":true}'::jsonb)$$,
  'P0001','Invalid sharing feature or value','retired review grant cannot be reopened');
select extensions.lives_ok($$select public.app_create_activity('11111111-1111-4111-8111-111111111111',
  '{"title":"공유 기록","body":"사용자가 공개할 본문"}'::jsonb)$$,'owner records a general activity');
create temporary table sharing_activity_target as select id from public.activity_events where title='공유 기록';
select extensions.lives_ok($$select public.app_save_general_task(null,null,'11222222-2222-4222-8222-222222222222',
  '{"title":"다음 확인","subject":{"kind":"portfolio"},"timezone":"Asia/Seoul","authored_via":"app"}'::jsonb)$$,
  'owner records an independent task');
create temporary table sharing_task_target as select id from public.portfolio_tasks where title='다음 확인';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001002',true);
select extensions.ok(public.can_view_feature('00000000-0000-0000-0000-000000001001','assets'),'friend can read default assets');
select extensions.ok(public.can_view_feature('00000000-0000-0000-0000-000000001001','activity'),'friend can read explicitly enabled activity');
select extensions.ok(not public.can_view_feature('00000000-0000-0000-0000-000000001001','briefings'),'retired review grant remains inert');
select extensions.ok(not public.can_view_feature('00000000-0000-0000-0000-000000001001','investment_profile'),'profile remains private');
select extensions.ok((public.app_get_shared_feature_access('00000000-0000-0000-0000-000000001001')->'features'->>'activity')::boolean,
  'effective access advertises activity');
select extensions.ok(not (public.app_get_shared_feature_access('00000000-0000-0000-0000-000000001001')->'features' ? 'briefings'),
  'effective access omits retired review grant');
select extensions.is(public.app_get_activity((select id from sharing_activity_target),
  '00000000-0000-0000-0000-000000001001')->>'body','사용자가 공개할 본문','friend reads enabled body');
select extensions.is(public.app_get_activity((select id from sharing_activity_target),
  '00000000-0000-0000-0000-000000001001')->>'after_data',null::text,'friend does not read internal payload');
select extensions.is(public.app_get_general_task_for_owner('00000000-0000-0000-0000-000000001001',
  (select id from sharing_task_target))->>'title','다음 확인','task access remains independent');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001001',true);
select extensions.is((public.app_update_sharing_policy(1,'{"activity":false}'::jsonb)->>'version')::integer,2,
  'owner can revoke activity grant');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001002',true);
select extensions.is(public.app_get_activity((select id from sharing_activity_target),
  '00000000-0000-0000-0000-000000001001'),null::jsonb,'revocation closes activity detail');
select * from extensions.finish();
rollback;
