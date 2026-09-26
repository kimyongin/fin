begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(9);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000009521','authenticated','authenticated','task-delete-owner@example.com','',now(),now(),now()),
       ('00000000-0000-0000-0000-000000009522','authenticated','authenticated','task-delete-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009521',true);
set local role authenticated;

select public.app_save_general_task(null,null,'95200000-0000-0000-0000-000000000001',
  '{"title":"반복 점검","subject":{"kind":"portfolio"},"timezone":"Asia/Seoul","recurrence_kind":"daily","recurrence_start_on":"2026-09-20","authored_via":"app"}'::jsonb);
select extensions.is((select count(*)::integer from public.portfolio_tasks where user_id=auth.uid()),1,'task exists');
select extensions.ok((select count(*)>0 from public.activity_events where user_id=auth.uid() and task_id=
  (select id from public.portfolio_tasks where user_id=auth.uid())),'creation event is linked');
select extensions.throws_ok($$select public.app_delete_general_task(
  (select id from public.portfolio_tasks where user_id=auth.uid()),2,'95200000-0000-0000-0000-000000000002')$$,
  'P0001','General task version conflict','stale version rejects deletion');
select extensions.is(public.app_delete_general_task(
  (select id from public.portfolio_tasks where user_id=auth.uid()),1,'95200000-0000-0000-0000-000000000002')->>'deleted',
  'true','deletes the task');
select extensions.is((select count(*)::integer from public.portfolio_tasks where user_id=auth.uid()),0,'task row removed');
select extensions.ok((select count(*)>0 from public.activity_events where user_id=auth.uid() and action_type='create_general_task' and task_id is null),
  'existing performed activity remains without a task link');
select extensions.is(public.app_delete_general_task(
  (select (request_payload->>'task_id')::uuid from public.general_task_mutation_receipts where operation='delete_general_task' and user_id=auth.uid()),
  1,'95200000-0000-0000-0000-000000000002')->>'deleted','true','same-key retry returns deletion');
select extensions.is(public.app_save_general_task(null,null,'95200000-0000-0000-0000-000000000001',
  '{"title":"반복 점검","subject":{"kind":"portfolio"},"timezone":"Asia/Seoul","recurrence_kind":"daily","recurrence_start_on":"2026-09-20","authored_via":"app"}'::jsonb)->>'deleted',
  'true','old creation retry cannot resurrect deleted task');
select set_config('test.deleted_task_id',
  (select request_payload->>'task_id' from public.general_task_mutation_receipts where operation='delete_general_task' and user_id=auth.uid()),true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009522',true);
select extensions.throws_ok($$select public.app_delete_general_task(
  current_setting('test.deleted_task_id')::uuid,
  1,'95200000-0000-0000-0000-000000000003')$$,'P0001','General task was not found','another owner cannot delete');
select * from extensions.finish();
rollback;
