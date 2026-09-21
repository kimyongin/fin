begin; create extension if not exists pgtap with schema extensions; set local search_path=public,extensions; select extensions.plan(21);
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
select extensions.lives_ok($$select public.app_record_investment_decision('11111111-1111-4111-8111-111111111111',jsonb_build_object('status','adopted','subject',jsonb_build_object('kind','portfolio'),'question','공유 판단','options',jsonb_build_array('유지'),'selected_option','유지','reason','원칙 유지','timezone','Asia/Seoul','authored_via','app','follow_up_tasks',jsonb_build_array(jsonb_build_object('title','다음 확인','subject',jsonb_build_object('kind','portfolio')))))$$,'owner records a decision and task');
set local role postgres;
insert into public.daily_briefings(id,user_id,review_date,timezone,status,coverage_status,headline,context_snapshot)
values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001001',current_date,'Asia/Seoul','attention','complete','공유 점검','{}');
update public.investment_decisions set source_briefing_id='10000000-0000-0000-0000-000000000001' where user_id='00000000-0000-0000-0000-000000001001';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001002',true);
select extensions.ok(public.can_view_feature('00000000-0000-0000-0000-000000001001','assets'),'friend can read legacy assets');
select extensions.ok(public.can_view_feature('00000000-0000-0000-0000-000000001001','briefings'),'friend can read enabled briefings');
select extensions.ok(not public.can_view_feature('00000000-0000-0000-0000-000000001001','investment_profile'),'friend cannot read private profile');
select extensions.ok((public.app_get_shared_feature_access('00000000-0000-0000-0000-000000001001')->>'relationship_access')::boolean,'friend effective access confirms relationship');
select extensions.ok((public.app_get_shared_feature_access('00000000-0000-0000-0000-000000001001')->'features'->>'briefings')::boolean,'friend effective access exposes enabled briefing menu');
select extensions.ok(not (public.app_get_shared_feature_access('00000000-0000-0000-0000-000000001001')->'features'->>'investment_profile')::boolean,'friend effective access keeps private profile hidden');
select extensions.is(jsonb_array_length(public.app_list_investment_decisions_for_owner('00000000-0000-0000-0000-000000001001',20,null)),1,'enabled decision DTO is visible');
select extensions.is(jsonb_array_length(public.app_list_portfolio_tasks_for_owner('00000000-0000-0000-0000-000000001001',null,20,null)),1,'enabled task DTO is visible');
select extensions.ok(
 not (public.app_get_investment_decision_for_owner('00000000-0000-0000-0000-000000001001',(public.app_list_investment_decisions_for_owner('00000000-0000-0000-0000-000000001001',20,null)#>>'{0,id}')::uuid) ?| array['user_id','policy_snapshot','source_briefing_id']),
 'shared decision detail excludes every private field explicitly');
select extensions.is(
 (select count(*) from jsonb_object_keys(public.app_get_investment_decision_for_owner('00000000-0000-0000-0000-000000001001',(public.app_list_investment_decisions_for_owner('00000000-0000-0000-0000-000000001001',20,null)#>>'{0,id}')::uuid))),
 14::bigint, 'shared decision detail has an exact allowlisted key set');
select extensions.is(public.app_list_briefing_related_tasks('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001001',3)->>'status','ok','shared related tasks are available only with the complete grant set');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001001',true);
select extensions.is((public.app_update_sharing_policy(1,'{"decisions":false}'::jsonb)->>'version')::integer,2,'owner can revoke one feature');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001002',true);
select extensions.is(jsonb_array_length(public.app_list_investment_decisions_for_owner('00000000-0000-0000-0000-000000001001',20,null)),0,'revoked decision list is empty');
select extensions.is(public.app_list_briefing_related_tasks('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000001001',3)->>'status','forbidden','partial grants do not expose briefing relationship metadata');
set local role postgres; update profiles set sharing_enabled=false where user_id='00000000-0000-0000-0000-000000001001'; set local role authenticated;
select extensions.ok(not public.can_view_feature('00000000-0000-0000-0000-000000001001','briefings'),'disabling sharing revokes access immediately');
select extensions.ok(not (public.app_get_shared_feature_access('00000000-0000-0000-0000-000000001001')->>'relationship_access')::boolean,'effective access fails closed after sharing is disabled');
select * from extensions.finish(); rollback;
