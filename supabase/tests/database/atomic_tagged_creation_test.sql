begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(13);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000009201','authenticated','authenticated','tagged-create-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000009202','authenticated','authenticated','tagged-create-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009201',true);
set local role authenticated;

select public.app_save_activity_tag(null,null,'92000000-0000-4000-8000-000000000001','검토');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009202',true);
select set_config('test.other_tag_id',(public.app_save_activity_tag(null,null,'92000000-0000-4000-8000-000000000002','타인')->>'id'),true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009201',true);

select extensions.throws_ok(
  $$select public.app_create_activity_with_tags('92000000-0000-4000-8000-000000000003','{"title":"실패 활동"}'::jsonb,array[current_setting('test.other_tag_id')::uuid])$$,
  'P0001','Activity tag was not found','foreign tag rejects activity creation');
select extensions.is((select count(*) from activity_events where title='실패 활동'),0::bigint,'failed activity has no event');
select extensions.is((select count(*) from activity_mutation_receipts where idempotency_key='92000000-0000-4000-8000-000000000003'),0::bigint,'failed activity has no receipt');

select extensions.is(public.app_create_activity_with_tags('92000000-0000-4000-8000-000000000004','{"title":"완료 활동"}'::jsonb,array[(select id from activity_tags where name='검토')])->>'version','2','tagged activity returns final version');
select extensions.is(public.app_create_activity_with_tags('92000000-0000-4000-8000-000000000004','{"title":"완료 활동"}'::jsonb,array[(select id from activity_tags where name='검토')])#>>'{tags,0,name}','검토','same request replays final tags');
select extensions.is((select count(*) from activity_events where title='완료 활동'),1::bigint,'activity retry creates one event');
select extensions.throws_ok(
  $$select public.app_create_activity_with_tags('92000000-0000-4000-8000-000000000004','{"title":"완료 활동"}'::jsonb,array[]::uuid[])$$,
  'P0001','Idempotency key was already used with a different request','same activity key cannot change tags');

select extensions.throws_ok(
  $$select public.app_create_general_task_with_tags('92000000-0000-4000-8000-000000000005','{"title":"실패 할 일"}'::jsonb,array[current_setting('test.other_tag_id')::uuid])$$,
  'P0001','Activity tag was not found','foreign tag rejects task creation');
select extensions.is((select count(*) from portfolio_tasks where title='실패 할 일'),0::bigint,'failed task has no row');
select extensions.is((select count(*) from activity_events where action_type='create_general_task' and after_data->>'title'='실패 할 일'),0::bigint,'failed task has no action event');

select extensions.is(public.app_create_general_task_with_tags('92000000-0000-4000-8000-000000000006','{"title":"완료 할 일"}'::jsonb,array[(select id from activity_tags where name='검토')])->>'title','완료 할 일','tagged task is created');
select extensions.is(public.app_create_general_task_with_tags('92000000-0000-4000-8000-000000000006','{"title":"완료 할 일"}'::jsonb,array[(select id from activity_tags where name='검토')])->>'id', (select id::text from portfolio_tasks where title='완료 할 일'),'same task request returns same id');
select extensions.is((select count(*) from portfolio_task_activity_tags relation join portfolio_tasks task on task.id=relation.task_id where task.title='완료 할 일'),1::bigint,'tagged task has one tag relation');

select * from extensions.finish();
rollback;
