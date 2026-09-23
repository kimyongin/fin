begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(15);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values('00000000-0000-0000-0000-000000001981','authenticated','authenticated','delete-activity-owner@example.com','',now(),now(),now()),
      ('00000000-0000-0000-0000-000000001982','authenticated','authenticated','delete-activity-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001981',true);
set local role authenticated;

select public.app_create_activity('98111111-1111-4111-8111-111111111111',
  '{"title":"삭제할 조사","category":"research","result":"검색에서 사라질 내용","authored_via":"app"}'::jsonb);
select public.app_save_general_task(null,null,'98222222-2222-4222-8222-222222222222',
  jsonb_build_object('title','남아야 하는 후속 일','subject',jsonb_build_object('kind','portfolio'),
    'timezone','Asia/Seoul','recurrence_kind','none','authored_via','app'));
set local role postgres;
insert into public.activity_embeddings(user_id,activity_event_id,model,content_hash,embedding)
select event.user_id,event.id,'fixture',md5('삭제할 조사'),
  ('[' || array_to_string(array_fill(0,ARRAY[384]),',') || ']')::extensions.vector(384)
from public.activity_events event where event.title='삭제할 조사';
set local role authenticated;

select extensions.throws_ok(
  $$select public.app_delete_manual_activity((select id from public.activity_events where title='삭제할 조사'),2)$$,
  'P0001','Activity version conflict','stale version cannot delete an activity');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001982',true);
select extensions.throws_ok(
  $$select public.app_delete_manual_activity((select id from public.activity_events where title='삭제할 조사'),1)$$,
  'P0001','Manual activity was not found','another user cannot delete it');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001981',true);

select extensions.is(public.app_delete_manual_activity(
  (select id from public.activity_events where title='삭제할 조사'),1)->>'deleted','true','owner deletes manual activity');
select extensions.is((select status from public.activity_events where action_type='record_manual_activity' and user_id=auth.uid()),
  'deleted','event identity becomes a tombstone');
select extensions.is((select title from public.activity_events where action_type='record_manual_activity' and user_id=auth.uid()),
  null::text,'narrative content is scrubbed');
select extensions.is((select count(*) from public.activity_embeddings where user_id=auth.uid()),
  0::bigint,'semantic embedding is removed');
select extensions.is((select count(*) from public.activity_mutation_receipts
  where user_id=auth.uid() and operation='create_activity' and request_payload::text like '%삭제할 조사%'),
  0::bigint,'receipt no longer retains deleted narrative');
select extensions.throws_ok(
  $$select public.app_create_activity('98111111-1111-4111-8111-111111111111',
    '{"title":"삭제할 조사","category":"research","result":"검색에서 사라질 내용","authored_via":"app"}'::jsonb)$$,
  'P0001','Idempotency key was already used with a different request','late create retry cannot recreate a deleted activity');
select extensions.is((select count(*) from public.portfolio_tasks where title='남아야 하는 후속 일'),
  1::bigint,'deleting a record does not delete an independent task');
select extensions.is((select control_state from public.portfolio_tasks where title='남아야 하는 후속 일'),
  'active','independent task status does not change');
select extensions.is(public.app_get_activity(
  (select id from public.activity_events where action_type='record_manual_activity' and user_id=auth.uid()),null),
  null::jsonb,'deleted detail is no longer readable');
select extensions.is(jsonb_array_length(public.app_search_activities(input_query=>'삭제할 조사')->'items'),
  0,'deleted activity is not keyword-searchable');
select extensions.is((select count(*) from public.app_list_recent_activity(20) where action_type='record_manual_activity'),
  0::bigint,'legacy recent feed excludes tombstones');
select extensions.is(public.app_delete_manual_activity(
  (select id from public.activity_events where action_type='record_manual_activity' and user_id=auth.uid()),1)->>'deleted',
  'true','retry is idempotent after deletion');
select extensions.throws_ok(
  $$select public.app_delete_manual_activity((select id from public.activity_events where action_type='create_general_task' and user_id=auth.uid()),1)$$,
  'P0001','Manual activity was not found','automatic task events cannot be deleted');

select * from extensions.finish();
rollback;
