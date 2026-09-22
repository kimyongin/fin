begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(23);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000000721','authenticated','authenticated','todo-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000000722','authenticated','authenticated','todo-other@example.com','',now(),now(),now());
insert into public.portfolio_tasks(id,user_id,kind,title,subject,timezone,control_state,research_state) values
('72000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000721','research','실적 발표 확인','{"kind":"portfolio"}','Asia/Seoul','active','open'),
('72000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000722','research','타인 과제','{"kind":"portfolio"}','Asia/Seoul','active','open');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000721',true);
set local role authenticated;
select extensions.is(public.app_list_todo_bundles('all',20,null)->'items','[]'::jsonb,'new owner has no bundles');

select extensions.is(public.app_save_todo_bundle(
  '72000000-0000-0000-0000-000000000001',null,'72000000-0000-0000-0000-000000000101',
  '오늘 정리','한 세션에서 처리한 작업','["대조","대조"," 완료 "]',jsonb_build_array(
    jsonb_build_object('id','72000000-0000-0000-0000-000000000201','kind','general','sort_order',0,'title','잔고 파일 확인','status','done','result','열 확인 완료','performed_at','2026-09-22T01:00:00Z'),
    jsonb_build_object('id','72000000-0000-0000-0000-000000000202','kind','general','sort_order',1,'title','평균가 계산','status','done','result','계산 완료','performed_at','2026-09-22T01:01:00Z'),
    jsonb_build_object('id','72000000-0000-0000-0000-000000000203','kind','general','sort_order',2,'title','메모 저장','status','done','result','저장 완료','performed_at','2026-09-22T01:02:00Z'),
    jsonb_build_object('id','72000000-0000-0000-0000-000000000204','kind','general','sort_order',3,'title','확인 기록','status','done','result','기록 완료','performed_at','2026-09-22T01:03:00Z')
  ),'[]',null,null,null,'agent') #>> '{status}','completed','four completed actions become one completed bundle');
select extensions.is(jsonb_array_length(public.app_get_todo_bundle('72000000-0000-0000-0000-000000000001')->'items'),4,'the bundle retains four ordered items');
select extensions.is(public.app_get_todo_bundle('72000000-0000-0000-0000-000000000001')->'tags','["대조","완료"]'::jsonb,'tags are trimmed and deduplicated');
select extensions.is(jsonb_array_length(public.app_list_todo_bundles('completed',20,null)->'items'),1,'completed filter returns the bundle once');
select extensions.is(public.app_save_todo_bundle(
  '72000000-0000-0000-0000-000000000001',null,'72000000-0000-0000-0000-000000000101',
  '오늘 정리','한 세션에서 처리한 작업','["대조","대조"," 완료 "]',jsonb_build_array(
    jsonb_build_object('id','72000000-0000-0000-0000-000000000201','kind','general','sort_order',0,'title','잔고 파일 확인','status','done','result','열 확인 완료','performed_at','2026-09-22T01:00:00Z'),
    jsonb_build_object('id','72000000-0000-0000-0000-000000000202','kind','general','sort_order',1,'title','평균가 계산','status','done','result','계산 완료','performed_at','2026-09-22T01:01:00Z'),
    jsonb_build_object('id','72000000-0000-0000-0000-000000000203','kind','general','sort_order',2,'title','메모 저장','status','done','result','저장 완료','performed_at','2026-09-22T01:02:00Z'),
    jsonb_build_object('id','72000000-0000-0000-0000-000000000204','kind','general','sort_order',3,'title','확인 기록','status','done','result','기록 완료','performed_at','2026-09-22T01:03:00Z')
  ),'[]',null,null,null,'agent') #>> '{version}','1','identical retry returns the original bundle');

select extensions.is(public.app_save_todo_bundle('72000000-0000-0000-0000-000000000001',1,
 '72000000-0000-0000-0000-000000000102','오늘 작업 정리',null,'["대조"]','[]','[]',null,null,null,'app') #>> '{version}','2','metadata can change without resending items');
select extensions.is(jsonb_array_length(public.app_get_todo_bundle('72000000-0000-0000-0000-000000000001')->'items'),4,'omitted items remain in the bundle');
select extensions.is(jsonb_array_length(public.app_save_todo_bundle('72000000-0000-0000-0000-000000000001',2,
 '72000000-0000-0000-0000-000000000103','오늘 작업 정리',null,'["대조"]','[]','["72000000-0000-0000-0000-000000000204"]',null,null,null,'app')->'items'),3,'explicit removal deletes only the named item');

select extensions.throws_ok($$select public.app_save_todo_bundle('72000000-0000-0000-0000-000000000001',3,
 '72000000-0000-0000-0000-000000000104','깨지면 안 됨',null,'[]',
 '[{"kind":"task","task_id":"72000000-0000-0000-0000-000000000020","sort_order":0}]','[]',null,null,null,'app')$$,
 'P0001','Linked task not found','a foreign task rejects the whole array write');
select extensions.is(public.app_get_todo_bundle('72000000-0000-0000-0000-000000000001') #>> '{title}','오늘 작업 정리','a failed item write rolls back metadata');

select extensions.throws_ok($$select public.app_save_todo_bundle('72000000-0000-0000-0000-000000000002',null,
 '72000000-0000-0000-0000-000000000105','빈 묶음',null,'[]','[]','[]',null,null,null,'app')$$,
 'P0001','ToDo bundle must contain at least one item','an empty bundle is rejected');

select extensions.is(public.app_save_todo_bundle('72000000-0000-0000-0000-000000000003',null,
 '72000000-0000-0000-0000-000000000106','실적 확인',null,'["실적"]',
 '[{"id":"72000000-0000-0000-0000-000000000205","kind":"task","task_id":"72000000-0000-0000-0000-000000000010","sort_order":0}]','[]',null,null,null,'app') #>> '{status}',
 'in_progress','an open research task makes its bundle active');
select extensions.is(public.app_create_daily_context('Asia/Seoul',null) #>> '{snapshot,todo_bundles,status}','retired',
    'daily context declares the legacy ToDo bundle projection retired');
select extensions.is(jsonb_array_length(public.app_create_daily_context('Asia/Seoul',null) #> '{snapshot,open_tasks,items}'),1,
    'daily context exposes the linked task through the unified pending task list');

reset role;
update public.portfolio_tasks set control_state='paused',version=version+1 where id='72000000-0000-0000-0000-000000000010';
set local role authenticated;
select extensions.is(public.app_get_todo_bundle('72000000-0000-0000-0000-000000000003') #>> '{status}','paused','task pause is reflected without copying state');
select extensions.is(jsonb_array_length(public.app_list_todo_bundles('paused',20,null)->'items'),1,'paused bundles have a dedicated filter');
select extensions.is(public.app_list_todo_linked_task_ids(),'["72000000-0000-0000-0000-000000000010"]'::jsonb,'linked task IDs support a non-duplicated legacy task list');
reset role;
update public.portfolio_tasks set control_state='active',research_state='resolved',version=version+1 where id='72000000-0000-0000-0000-000000000010';
set local role authenticated;
select extensions.is(public.app_get_todo_bundle('72000000-0000-0000-0000-000000000003') #>> '{status}','completed','task resolution completes the derived bundle');
reset role;
update public.portfolio_tasks set control_state='active',research_state='open',version=version+1 where id='72000000-0000-0000-0000-000000000010';
set local role authenticated;
select extensions.is(public.app_get_todo_bundle('72000000-0000-0000-0000-000000000003') #>> '{status}','in_progress','task reopening reactivates the bundle');

select extensions.throws_ok($$select public.app_save_todo_bundle('72000000-0000-0000-0000-000000000004',null,
 '72000000-0000-0000-0000-000000000107','중복 편입',null,'[]',
 '[{"kind":"task","task_id":"72000000-0000-0000-0000-000000000010","sort_order":0}]','[]',null,null,null,'app')$$,
 '23505',null,'one task cannot belong to two current bundles');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000722',true);
select extensions.is(public.app_list_todo_bundles('all',20,null)->'items','[]'::jsonb,'another user cannot list owner bundles');
select extensions.is((select count(*) from public.todo_bundles),0::bigint,'RLS hides direct bundle rows from another user');

select * from extensions.finish();
rollback;
