begin; create extension if not exists pgtap with schema extensions; set local search_path=public,extensions; select extensions.plan(20);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001001','authenticated','authenticated','sharing-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001002','authenticated','authenticated','sharing-viewer@example.com','',now(),now(),now());
set local role postgres;
insert into profiles(user_id,public_name,public_name_normalized,sharing_enabled) values('00000000-0000-0000-0000-000000001001','owner','owner',true);
insert into friendships(viewer_user_id,owner_user_id) values('00000000-0000-0000-0000-000000001002','00000000-0000-0000-0000-000000001001');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001001',true); set local role authenticated;
select extensions.is(public.app_get_sharing_policy()->>'preset','portfolio_only','legacy sharing starts with portfolio-only preset');
select extensions.is((public.app_get_sharing_policy()->'grants'->>'briefings')::boolean,false,'reviews default private');
select extensions.is(public.app_update_sharing_policy(0,'{"briefings":true,"decisions":true,"tasks":true}'::jsonb)->>'preset','portfolio_and_reviews','review bundle updates atomically');
select extensions.throws_ok($$select public.app_update_sharing_policy(0,'{"briefings":false}'::jsonb)$$,'P0001','Sharing policy version conflict','stale update rejected');
select extensions.lives_ok($$select public.app_create_activity('11111111-1111-4111-8111-111111111111','{"title":"공유 판단","category":"decision","note":"비공개 메모","context":{"decision_state":"adopted","reason":"비공개 사유"}}'::jsonb)$$,'owner records a decision activity');
select extensions.lives_ok($$select public.app_save_general_task(null,null,'11222222-2222-4222-8222-222222222222','{"title":"다음 확인","subject":{"kind":"portfolio"},"timezone":"Asia/Seoul","authored_via":"app"}'::jsonb)$$,'owner records a general task');
create temporary table sharing_task_target as select id from public.portfolio_tasks where title='다음 확인';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001002',true);
select extensions.ok(public.can_view_feature('00000000-0000-0000-0000-000000001001','assets'),'friend can read legacy assets');
select extensions.ok(public.can_view_feature('00000000-0000-0000-0000-000000001001','briefings'),'friend can read enabled briefings');
select extensions.ok(not public.can_view_feature('00000000-0000-0000-0000-000000001001','investment_profile'),'friend cannot read private profile');
select extensions.ok((public.app_get_shared_feature_access('00000000-0000-0000-0000-000000001001')->>'relationship_access')::boolean,'friend effective access confirms relationship');
select extensions.ok((public.app_get_shared_feature_access('00000000-0000-0000-0000-000000001001')->'features'->>'briefings')::boolean,'friend effective access exposes enabled briefing menu');
select extensions.ok(not (public.app_get_shared_feature_access('00000000-0000-0000-0000-000000001001')->'features'->>'investment_profile')::boolean,'friend effective access keeps private profile hidden');
select extensions.is(jsonb_array_length(public.app_list_narrative_activities('decision','00000000-0000-0000-0000-000000001001')->'items'),1,'enabled decision activity is visible');
select extensions.is(public.app_get_general_task_for_owner('00000000-0000-0000-0000-000000001001',(select id from sharing_task_target))->>'title','다음 확인','enabled general task detail is visible');
select extensions.ok(
 public.app_list_narrative_activities('decision','00000000-0000-0000-0000-000000001001')->'items'->0->>'note' is null,
 'shared decision activity excludes private note');
select extensions.is(
 public.app_get_general_task_for_owner('00000000-0000-0000-0000-000000001001',(select id from sharing_task_target))->'history',
 '[]'::jsonb, 'shared task detail omits private history');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001001',true);
select extensions.is((public.app_update_sharing_policy(1,'{"decisions":false}'::jsonb)->>'version')::integer,2,'owner can revoke one feature');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001002',true);
select extensions.is(jsonb_array_length(public.app_list_narrative_activities('decision','00000000-0000-0000-0000-000000001001')->'items'),0,'revoked decision activity list is empty');
set local role postgres; update profiles set sharing_enabled=false where user_id='00000000-0000-0000-0000-000000001001'; set local role authenticated;
select extensions.ok(not public.can_view_feature('00000000-0000-0000-0000-000000001001','briefings'),'disabling sharing revokes access immediately');
select extensions.ok(not (public.app_get_shared_feature_access('00000000-0000-0000-0000-000000001001')->>'relationship_access')::boolean,'effective access fails closed after sharing is disabled');
select * from extensions.finish(); rollback;
