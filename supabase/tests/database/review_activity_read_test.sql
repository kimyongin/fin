begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(11);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001981','authenticated','authenticated','review-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001982','authenticated','authenticated','review-friend@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001983','authenticated','authenticated','review-stranger@example.com','',now(),now(),now());
set local role postgres;
insert into public.profiles(user_id,public_name,public_name_normalized,sharing_enabled)
values('00000000-0000-0000-0000-000000001981','review-owner','review-owner',true);
insert into public.friendships(viewer_user_id,owner_user_id)
values('00000000-0000-0000-0000-000000001982','00000000-0000-0000-0000-000000001981');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001981',true);
set local role authenticated;

select public.app_create_activity('98111111-1111-4111-8111-111111111111','{"title":"어제 점검","category":"review","result":"공개 변화","conclusion":"추가 확인","note":"내부 메모","context":{"status":"attention","coverage_status":"partial","scope":"비공개 범위","sources":[{"title":"출처","url":"https://example.com/source"}]}}'::jsonb);
select public.app_create_activity('98222222-2222-4222-8222-222222222222','{"title":"오늘 점검","category":"review","context":{"status":"no_action","coverage_status":"complete"}}'::jsonb);
select public.app_create_activity('98333333-3333-4333-8333-333333333333','{"title":"별도 판단","category":"decision"}'::jsonb);

select extensions.is(jsonb_array_length(public.app_list_narrative_activities('review')->'items'),2,'owner reads both review activities');
select extensions.is(public.app_list_narrative_activities('review',null,1)->'items'->0->>'title','오늘 점검','newest review first');
select extensions.is(jsonb_array_length(public.app_list_narrative_activities('review',null,1,public.app_list_narrative_activities('review',null,1)->'next_cursor')->'items'),1,'cursor reads next review');
select extensions.is(jsonb_array_length(public.app_list_narrative_activities('decision')->'items'),1,'kind filter excludes reviews');
select extensions.is(public.app_list_narrative_activities('review')->'items'->1->'context'->>'scope','비공개 범위','owner receives review context');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001982',true);
select extensions.is(jsonb_array_length(public.app_list_narrative_activities('review','00000000-0000-0000-0000-000000001981')->'items'),0,'friend without review grant sees nothing');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001981',true);
select public.app_update_sharing_policy(0,'{"briefings":true}'::jsonb);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001982',true);
select extensions.is(jsonb_array_length(public.app_list_narrative_activities('review','00000000-0000-0000-0000-000000001981')->'items'),2,'review grant permits friend summary');
select extensions.is(public.app_list_narrative_activities('review','00000000-0000-0000-0000-000000001981')->'items'->1->>'note',null::text,'friend cannot read private note');
select extensions.is(public.app_list_narrative_activities('review','00000000-0000-0000-0000-000000001981')->'items'->1->'context'->>'scope',null::text,'friend cannot read private scope or sources');
select extensions.is(jsonb_array_length(public.app_list_narrative_activities('decision','00000000-0000-0000-0000-000000001981')->'items'),0,'review grant does not expose decisions');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001983',true);
select extensions.is(jsonb_array_length(public.app_list_narrative_activities('review','00000000-0000-0000-0000-000000001981')->'items'),0,'unrelated user cannot read granted reviews');
select * from extensions.finish();
rollback;
