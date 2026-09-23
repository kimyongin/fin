begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(8);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001991','authenticated','authenticated','shared-task-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001992','authenticated','authenticated','shared-task-friend@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001993','authenticated','authenticated','shared-task-other@example.com','',now(),now(),now());
insert into public.profiles(user_id,public_name,public_name_normalized,sharing_enabled)
values ('00000000-0000-0000-0000-000000001991','shared-task-owner','shared-task-owner',true);
insert into public.friendships(viewer_user_id,owner_user_id)
values ('00000000-0000-0000-0000-000000001992','00000000-0000-0000-0000-000000001991');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001991',true);
set local role authenticated;
select extensions.is(public.app_save_general_task(null,null,'19911111-1111-4111-8111-111111111111',jsonb_build_object(
  'title','다음 주 점검','subject',jsonb_build_object('kind','portfolio'),
  'timezone','Asia/Seoul','trigger_text','내 메모','authored_via','app'))->>'kind','general','owner creates one general task');
create temporary table shared_task_target as select id from public.portfolio_tasks where title='다음 주 점검';
select extensions.is(public.app_get_general_task_for_owner('00000000-0000-0000-0000-000000001991',
  (select id from shared_task_target))->>'title','다음 주 점검','owner detail uses current general task read');
select extensions.is((public.app_get_general_task_for_owner('00000000-0000-0000-0000-000000001991',
  (select id from shared_task_target))->'history')::text,
  (public.app_get_general_task((select id from shared_task_target))->'history')::text,
  'owner keeps own history');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001992',true);
select extensions.is(public.app_get_general_task_for_owner('00000000-0000-0000-0000-000000001991',
  (select id from shared_task_target)),null::jsonb,'friend without tasks grant receives no detail');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001991',true);
select extensions.is(public.app_update_sharing_policy(0,'{"tasks":true}'::jsonb)->>'preset','custom','owner enables task sharing');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001992',true);
select extensions.is(public.app_get_general_task_for_owner('00000000-0000-0000-0000-000000001991',
  (select id from shared_task_target))->>'title','다음 주 점검','friend can read general task detail');
select extensions.is(public.app_get_general_task_for_owner('00000000-0000-0000-0000-000000001991',
  (select id from shared_task_target))->'history','[]'::jsonb,'friend does not receive private task history');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001993',true);
select extensions.is(public.app_get_general_task_for_owner('00000000-0000-0000-0000-000000001991',
  (select id from shared_task_target)),null::jsonb,'unrelated user cannot read detail');

select * from extensions.finish();
rollback;
