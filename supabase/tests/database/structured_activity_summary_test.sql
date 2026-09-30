begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000091974','authenticated','authenticated','structured-fixture@example.com','',now(),now(),now()),
 ('00000000-0000-0000-0000-000000091975','authenticated','authenticated','structured-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000091974',true);
set local role authenticated;

select extensions.throws_ok($q$select public.app_create_structured_activity(gen_random_uuid(),'{"title":"new","body":"detail"}')$q$,
 'P0001','summary is required and must be at most 300 characters','missing summary is rejected');
select extensions.throws_ok($q$select public.app_create_structured_activity(gen_random_uuid(),'{"title":"new","summary":" ","body":"detail"}')$q$,
 'P0001','summary is required and must be at most 300 characters','blank summary is rejected');
select extensions.throws_ok($q$select public.app_create_structured_activity(gen_random_uuid(),'{"title":"new","summary":null,"body":"detail"}')$q$,
 'P0001','summary is required and must be at most 300 characters','null summary is rejected');
select extensions.throws_ok($q$select public.app_create_structured_activity(gen_random_uuid(),'{"title":"new","summary":7,"body":"detail"}')$q$,
 'P0001','summary is required and must be at most 300 characters','wrong summary type is rejected');
select extensions.throws_ok($q$select public.app_create_structured_activity(gen_random_uuid(),jsonb_build_object('title','new','summary',E'\n\t','body','detail'))$q$,
 'P0001','summary is required and must be at most 300 characters','newline and tab only summary is rejected');
select extensions.throws_ok($q$select public.app_create_structured_activity(gen_random_uuid(),jsonb_build_object('title','new','summary',repeat('x',301),'body','detail'))$q$,
 'P0001','summary is required and must be at most 300 characters','oversize summary is rejected');
select extensions.throws_ok($q$select public.app_create_structured_activity(gen_random_uuid(),'{"title":"new","summary":"upper"}')$q$,
 'P0001','body is required and must be at most 25000 characters','missing body is rejected');
select extensions.throws_ok($q$select public.app_save_structured_general_task(null,null,gen_random_uuid(),'{"title":"new","summary":"upper","trigger_text":" "}')$q$,
 'P0001','body is required and must be at most 25000 characters','task body is required too');
select extensions.throws_ok($q$select public.app_create_structured_activity(gen_random_uuid(),'{"title":"atomic-invalid-tags","summary":"upper","body":"detail"}',
 array['ffffffff-ffff-4fff-8fff-ffffffffffff']::uuid[])$q$,
 'P0001','Activity tag was not found','invalid tags reject the entire structured create');
select extensions.is((select count(*) from public.activity_events where user_id=auth.uid() and title='atomic-invalid-tags'),0::bigint,'invalid tags leave no record');

select set_config('test.structured.task',public.app_save_structured_general_task(null,null,
 '30000000-0000-4000-8000-000000000001',jsonb_build_object('title','현금 확보 점검','summary','대출 만기 전에 상환 재원을 확인한다.',
 'trigger_text',repeat('본문 전용 비밀 절차 ',200),'authored_via','app'))::text,true);
select extensions.is(current_setting('test.structured.task')::jsonb->>'summary','대출 만기 전에 상환 재원을 확인한다.','task detail preserves summary');
select extensions.ok(char_length(current_setting('test.structured.task')::jsonb->>'trigger_text')>1000,'long task body is retained');
select extensions.is(public.app_save_structured_general_task(null,null,
 '30000000-0000-4000-8000-000000000001',jsonb_build_object('title','현금 확보 점검','summary','대출 만기 전에 상환 재원을 확인한다.',
 'trigger_text',repeat('본문 전용 비밀 절차 ',200),'authored_via','app')),
 current_setting('test.structured.task')::jsonb,'same-key retry returns original task and summary');

select set_config('test.structured.activity',public.app_create_structured_activity(
 '30000000-0000-4000-8000-000000000002','{"title":"상환 재원 확인","summary":"대출 조건 미확정으로 추가 매수를 보류했다.","body":"본문전용표식-174: 상세 판단과 출처"}')::text,true);
select extensions.is(current_setting('test.structured.activity')::jsonb->>'summary','대출 조건 미확정으로 추가 매수를 보류했다.','activity detail preserves summary');
select extensions.is(jsonb_array_length(public.app_search_activities_ticker(input_query=>'본문전용표식-174')->'items'),1,'body keyword search remains supported');
select extensions.is(public.app_search_activities_ticker(input_query=>'본문전용표식-174')->'items'->0->>'summary',
 '대출 조건 미확정으로 추가 매수를 보류했다.','keyword result includes the upper summary');
select extensions.throws_ok($q$select public.app_save_activity_market_ticker_detail(
 (current_setting('test.structured.activity')::jsonb->>'id')::bigint,1,gen_random_uuid(),'{"summary":null}',null)$q$,
 'P0001','summary is required and must be at most 300 characters','partial edit cannot clear summary');
select extensions.throws_ok($q$select public.app_save_activity_market_ticker_detail(
 (current_setting('test.structured.activity')::jsonb->>'id')::bigint,1,gen_random_uuid(),'{"body":" "}',null)$q$,
 'P0001','body is required and must be at most 25000 characters','partial edit cannot clear body');

set local role postgres;
select set_config('test.structured.hash',(select message->>'content_hash' from pgmq.q_activity_search_index
 where message->>'record_type'='activity' and message->>'record_id'=current_setting('test.structured.activity')::jsonb->>'id' order by msg_id desc limit 1),true);
select set_config('test.structured.queues',(select count(*)::text from pgmq.q_activity_search_index
 where message->>'user_id'='00000000-0000-0000-0000-000000091974'),true);
set local role service_role;
select extensions.ok(strpos(public.app_get_activity_search_job('activity',current_setting('test.structured.activity')::jsonb->>'id',
 current_setting('test.structured.hash'),'llama-text-embed-v2')->>'embedding_input','대출 조건')>0,'provider passage contains summary');
select extensions.is(strpos(public.app_get_activity_search_job('activity',current_setting('test.structured.activity')::jsonb->>'id',
 current_setting('test.structured.hash'),'llama-text-embed-v2')->>'embedding_input','본문전용표식-174'),0,'provider passage excludes body');
select extensions.is(public.app_get_activity_search_job('activity',current_setting('test.structured.activity')::jsonb->>'id',
 md5('pinecone-e5-context-v1:상환 재원 확인'),'llama-text-embed-v2')->>'stale','true','old full-body pipeline job is stale');
set local role authenticated;
select public.app_update_activity((current_setting('test.structured.activity')::jsonb->>'id')::bigint,1,
 '30000000-0000-4000-8000-000000000003','{"body":"본문전용표식-174: 본문만 정정"}');
set local role postgres;
select extensions.is((select count(*)::text from pgmq.q_activity_search_index
 where message->>'user_id'='00000000-0000-0000-0000-000000091974'),current_setting('test.structured.queues'),'body edit does not queue embedding');
set local role service_role;
select extensions.is(public.app_get_activity_search_job('activity',current_setting('test.structured.activity')::jsonb->>'id',
 current_setting('test.structured.hash'),'llama-text-embed-v2')->>'stale','false','body edit keeps current upper job valid');
set local role authenticated;
select public.app_update_activity((current_setting('test.structured.activity')::jsonb->>'id')::bigint,2,
 '30000000-0000-4000-8000-000000000004','{"summary":"대출 조건 확정 후 현금 여력을 재검토한다."}');
set local role service_role;
select extensions.is(public.app_get_activity_search_job('activity',current_setting('test.structured.activity')::jsonb->>'id',
 current_setting('test.structured.hash'),'llama-text-embed-v2')->>'stale','true','summary edit rejects late old job');
set local role authenticated;
select extensions.throws_ok($q$select public.app_transition_general_task_structured(
 (current_setting('test.structured.task')::jsonb->>'id')::uuid,1,'complete','실제 결과',null,null,gen_random_uuid(),'app')$q$,
 'P0001','result_title is required and must be at most 100 characters','completion requires its own result title');
select extensions.is(public.app_get_general_task((current_setting('test.structured.task')::jsonb->>'id')::uuid)->>'status','open','invalid completion leaves task open');
select extensions.throws_ok($q$select public.app_transition_general_task_structured(
 (current_setting('test.structured.task')::jsonb->>'id')::uuid,1,'complete','実際の結果',null,null,gen_random_uuid(),'app','result title',null)$q$,
 'P0001','result_summary is required and must be at most 300 characters','completion also requires a result summary');
select extensions.throws_ok($q$select public.app_transition_general_task_structured(
 (current_setting('test.structured.task')::jsonb->>'id')::uuid,1,'complete',null,null,null,gen_random_uuid(),'app','result title','result summary')$q$,
 'P0001','result is required and must be at most 25000 characters','completion also requires a result body');
select public.app_transition_general_task_structured((current_setting('test.structured.task')::jsonb->>'id')::uuid,1,'complete',
 '공식 조건을 확인했지만 대출 일정은 미확정이었다.',null,null,'30000000-0000-4000-8000-000000000005','app',
 '대출 일정 미확정으로 매수 보류','상환 현금 확인이 끝날 때까지 추가 매수를 보류했다.');
select extensions.is(public.app_get_general_task((current_setting('test.structured.task')::jsonb->>'id')::uuid)->>'status','done','valid result completes task');
set local role postgres;
select extensions.is((select summary from public.activity_events where task_id=(current_setting('test.structured.task')::jsonb->>'id')::uuid
 and action_type='complete_general_task'),'상환 현금 확인이 끝날 때까지 추가 매수를 보류했다.','completion uses actual result summary rather than task intent');
select extensions.is((select body from public.activity_events where task_id=(current_setting('test.structured.task')::jsonb->>'id')::uuid
 and action_type='complete_general_task'),'공식 조건을 확인했지만 대출 일정은 미확정이었다.','completion retains result body');
insert into public.accounts(id,user_id,name) values(9197401,'00000000-0000-0000-0000-000000091974','요약 검증 계좌');
set local role authenticated;
select public.app_update_entity_note('account',9197401,null,'계좌 메모를 수정한 사실입니다.','30000000-0000-4000-8000-000000000006','app');
set local role postgres;
select extensions.ok((select summary like '%계좌 메모를 수정한 사실%' from public.activity_events
 where user_id='00000000-0000-0000-0000-000000091974' and action_type='update_entity_note' order by id desc limit 1),'automatic summary derives from committed note facts');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000091975',true);
select extensions.is(public.app_get_activity_market_ticker((current_setting('test.structured.activity')::jsonb->>'id')::bigint,
 '00000000-0000-0000-0000-000000091974'),null::jsonb,'summary follows private activity access boundary');
select * from extensions.finish();
rollback;
