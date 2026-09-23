begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(22);

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
select public.app_create_activity('98333333-3333-4333-8333-333333333333','{"title":"별도 판단","category":"decision","note":"비공개 판단 메모","context":{"decision_state":"adopted","reason":"비공개 사유","sources":[{"title":"내부 출처","url":"https://example.com/private"}]}}'::jsonb);

select extensions.is(jsonb_array_length(public.app_list_narrative_activities('review')->'items'),2,'owner reads both review activities');
select extensions.is(public.app_list_narrative_activities('review',null,1)->'items'->0->>'title','오늘 점검','newest review first');
select extensions.is(jsonb_array_length(public.app_list_narrative_activities('review',null,1,public.app_list_narrative_activities('review',null,1)->'next_cursor')->'items'),1,'cursor reads next review');
select extensions.is(jsonb_array_length(public.app_list_narrative_activities('decision')->'items'),1,'kind filter excludes reviews');
select extensions.is(public.app_list_narrative_activities('review')->'items'->1->'context'->>'scope','비공개 범위','owner receives review context');
select extensions.is(public.app_get_daily_context('Asia/Seoul')->'last_review'->>'title','오늘 점검','current context reads latest saved review');
select extensions.hasnt_table('public','daily_review_contexts','reading current context has no snapshot table');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001982',true);
select extensions.is(jsonb_array_length(public.app_list_narrative_activities('review','00000000-0000-0000-0000-000000001981')->'items'),0,'friend without review grant sees nothing');
select extensions.is(jsonb_array_length(public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001981',input_record_kinds=>array['review','research'])->'items'),0,'multi kind search cannot bypass missing review grant');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001981',true);
select public.app_update_sharing_policy(0,'{"briefings":true}'::jsonb);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001982',true);
select extensions.is(jsonb_array_length(public.app_list_narrative_activities('review','00000000-0000-0000-0000-000000001981')->'items'),2,'review grant permits friend summary');
select extensions.is(jsonb_array_length(public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001981',input_record_kinds=>array['review','decision'])->'items'),2,'search returns shared reviews but not private decisions');
select extensions.is(jsonb_array_length(public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001981',input_record_kinds=>array['review'],input_query=>'내부 메모')->'items'),0,'private note cannot be used as search oracle');
select extensions.is(public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001981',input_query=>'어제 점검')->'items'->0->>'note',null::text,'shared search strips private note');
select extensions.is(public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001981',input_query=>'어제 점검')->'items'->0->'context'->>'scope',null::text,'shared search strips private context');
select extensions.is(jsonb_array_length(public.app_search_activities(input_owner_user_id=>'00000000-0000-0000-0000-000000001981',input_record_kinds=>array['review'],input_tag_ids=>array['00000000-0000-0000-0000-000000001981'::uuid])->'items'),0,'private tag predicates never expose shared reviews');
select extensions.is(public.app_list_narrative_activities('review','00000000-0000-0000-0000-000000001981')->'items'->1->>'note',null::text,'friend cannot read private note');
select extensions.is(public.app_list_narrative_activities('review','00000000-0000-0000-0000-000000001981')->'items'->1->'context'->>'scope',null::text,'friend cannot read private scope or sources');
select extensions.is(jsonb_array_length(public.app_list_narrative_activities('decision','00000000-0000-0000-0000-000000001981')->'items'),0,'review grant does not expose decisions');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001981',true);
select public.app_update_sharing_policy(1,'{"decisions":true}'::jsonb);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001982',true);
select extensions.is(public.app_list_narrative_activities('decision','00000000-0000-0000-0000-000000001981')->'items'->0->'context'->>'decision_state','adopted','decision grant shares adopted state');
select extensions.is(public.app_list_narrative_activities('decision','00000000-0000-0000-0000-000000001981')->'items'->0->>'note',null::text,'decision grant does not share private note');
select extensions.is(public.app_list_narrative_activities('decision','00000000-0000-0000-0000-000000001981')->'items'->0->'context'->>'reason',null::text,'decision grant does not share private context');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001983',true);
select extensions.is(jsonb_array_length(public.app_list_narrative_activities('review','00000000-0000-0000-0000-000000001981')->'items'),0,'unrelated user cannot read granted reviews');
select * from extensions.finish();
rollback;
