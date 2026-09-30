begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.no_plan();

select extensions.ok(to_regprocedure('public.activity_search_chunks(text)') is null,'splitter is retired');
select extensions.ok(to_regprocedure('public.activity_search_clip_bytes(text,integer)') is null,'chunk clipping is retired');
select extensions.ok(not exists(select 1 from information_schema.columns where table_schema='public'
  and table_name='activity_search_vectors' and column_name='chunk_no'),'chunk column is retired');
select extensions.ok(public.activity_search_input_eligible(repeat('😀',100)||E'\n'||repeat('😀',300)),
  'maximum new Unicode upper text is eligible as one whole input');
select extensions.ok(public.activity_search_input_eligible(repeat('x',1800)),'legacy input at byte budget is eligible');
select extensions.ok(not public.activity_search_input_eligible(repeat('x',1801)),'over-budget legacy input is excluded without splitting');
select extensions.ok(not public.activity_search_input_eligible(' '),'blank input is excluded');
select extensions.is(public.activity_search_content_hash('x'),md5('pinecone-llama-summary-v3:x'),'new pipeline has a new hash');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000091975','authenticated','authenticated',
  'single-input-fixture@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000091975',true);
set local role authenticated;
select set_config('test.single.created',public.app_create_structured_activity(gen_random_uuid(),jsonb_build_object(
  'title',repeat('😀',100),'summary',repeat('한',300),'body',repeat('본문전용',2000),'authored_via','app'))::text,true);
select extensions.is(char_length(current_setting('test.single.created')::jsonb->>'title'),100,'100 code points are accepted');
select extensions.throws_ok($q$select public.app_create_structured_activity(gen_random_uuid(),jsonb_build_object(
  'title',repeat('😀',101),'summary','요약','body','본문'))$q$,
  'P0001','title is required and must be at most 100 characters','101 emoji title is rejected');
select extensions.throws_ok($q$select public.app_create_structured_activity(gen_random_uuid(),jsonb_build_object(
  'title','제목','summary',repeat('한',301),'body','본문'))$q$,
  'P0001','summary is required and must be at most 300 characters','301 Hangul summary is rejected');
set local role postgres;
select set_config('test.single.id',current_setting('test.single.created')::jsonb->>'id',true);
select set_config('test.single.hash',(select message->>'content_hash' from pgmq.q_activity_search_index
  where message->>'record_id'=current_setting('test.single.id') and message->>'record_type'='activity'),true);
select set_config('test.single.message',(select msg_id::text from pgmq.q_activity_search_index
  where message->>'record_id'=current_setting('test.single.id') and message->>'record_type'='activity'),true);
select extensions.is((select count(*) from pgmq.q_activity_search_index where message->>'record_id'=current_setting('test.single.id')
  and message->>'record_type'='activity'),1::bigint,'one whole upper input creates one job');
select extensions.ok((select not (message?'chunk_no') from pgmq.q_activity_search_index
  where msg_id=current_setting('test.single.message')::bigint),'job has no chunk identity');
set local role service_role;
select extensions.is(public.app_get_activity_search_job('activity',current_setting('test.single.id'),
  current_setting('test.single.hash'),'llama-text-embed-v2')->>'embedding_input',repeat('😀',100)||E'\n'||repeat('한',300),
  'provider receives the complete title and summary, without body or clipping');
set local role authenticated;
select public.app_update_activity(current_setting('test.single.id')::bigint,1,gen_random_uuid(),'{"body":"수정한 본문"}');
set local role service_role;
select extensions.is(public.app_get_activity_search_job('activity',current_setting('test.single.id'),
  current_setting('test.single.hash'),'llama-text-embed-v2')->>'stale','false','body-only edit preserves job');
set local role authenticated;
select public.app_update_activity(current_setting('test.single.id')::bigint,2,gen_random_uuid(),'{"summary":"첫 수정"}');
select public.app_update_activity(current_setting('test.single.id')::bigint,3,gen_random_uuid(),'{"summary":"최신 수정"}');
set local role postgres;
select extensions.is((select count(*) from pgmq.q_activity_search_index where message->>'record_id'=current_setting('test.single.id')
  and message->>'record_type'='activity'),1::bigint,'rapid upper edits replace the pending job');
set local role service_role;
select extensions.is(public.app_get_activity_search_job('activity',current_setting('test.single.id'),
  current_setting('test.single.hash'),'llama-text-embed-v2')->>'stale','true','late source fetch is stale');
select extensions.is(public.app_finish_activity_search_job(current_setting('test.single.message')::bigint,
  '00000000-0000-0000-0000-000000091975','activity',current_setting('test.single.id'),
  current_setting('test.single.hash'),'llama-text-embed-v2',repeat('😀',100)||E'\n'||repeat('한',300),
  ('['||repeat('0.1,',1023)||'0.1]')::extensions.vector),false,'late provider result cannot overwrite current input');
set local role postgres;
select set_config('test.single.hash',(select message->>'content_hash' from pgmq.q_activity_search_index
  where message->>'record_id'=current_setting('test.single.id') and message->>'record_type'='activity'),true);
select set_config('test.single.message',(select msg_id::text from pgmq.q_activity_search_index
  where message->>'record_id'=current_setting('test.single.id') and message->>'record_type'='activity'),true);
set local role service_role;
select extensions.is(public.app_finish_activity_search_job(current_setting('test.single.message')::bigint,
  '00000000-0000-0000-0000-000000091976','activity',current_setting('test.single.id'),
  current_setting('test.single.hash'),'llama-text-embed-v2',repeat('😀',100)||E'\n'||'최신 수정',
  ('['||repeat('0.1,',1023)||'0.1]')::extensions.vector),false,'wrong owner cannot finish or consume another owner job');
select extensions.is(public.app_finish_activity_search_job(current_setting('test.single.message')::bigint,
  '00000000-0000-0000-0000-000000091975','activity',current_setting('test.single.id'),
  current_setting('test.single.hash'),'llama-text-embed-v2',repeat('😀',100)||E'\n'||'최신 수정',
  ('['||repeat('0.1,',1023)||'0.1]')::extensions.vector),true,'current whole input finishes successfully');
select extensions.is(public.app_finish_activity_search_job(current_setting('test.single.message')::bigint,
  '00000000-0000-0000-0000-000000091975','activity',current_setting('test.single.id'),
  current_setting('test.single.hash'),'llama-text-embed-v2',repeat('😀',100)||E'\n'||'최신 수정',
  ('['||repeat('0.1,',1023)||'0.1]')::extensions.vector),false,'duplicate delivery cannot create or replace another vector');
set local role postgres;
select extensions.is((select count(*) from public.activity_search_vectors where user_id='00000000-0000-0000-0000-000000091975'),
  1::bigint,'one record has one vector');

-- Simulate retained source from before this migration, never rewrite it.
alter table public.activity_events disable trigger activity_events_zzz_upper_limits;
insert into public.activity_events(user_id,source,action_type,status,title,summary,body)
values ('00000000-0000-0000-0000-000000091975','user','record_manual_activity','succeeded',repeat('한',500),repeat('요',1000),'기존 상세');
alter table public.activity_events enable trigger activity_events_zzz_upper_limits;
select set_config('test.single.legacy',(select id::text from public.activity_events where title=repeat('한',500)),true);
select extensions.is((select title from public.activity_events where id=current_setting('test.single.legacy')::bigint),
  repeat('한',500),'legacy source title is not truncated');
select extensions.is((select count(*) from pgmq.q_activity_search_index where message->>'record_id'=current_setting('test.single.legacy')
  and message->>'record_type'='activity'),0::bigint,'over-budget legacy source creates no retrying job');
set local role authenticated;
select extensions.is(public.app_activity_search_index_coverage()->>'excluded_count','1','coverage reports excluded legacy source');
select extensions.is(public.app_activity_search_index_coverage()->>'missing_count','0','excluded source is not forever pending');
select extensions.is(jsonb_array_length(public.app_search_activities_ranked_ticker('기존 상세')->'items'),1,'excluded source remains keyword searchable');
select extensions.lives_ok($q$select public.app_update_activity(current_setting('test.single.legacy')::bigint,1,
  gen_random_uuid(),'{"body":"기존 상세 정정"}')$q$,'legacy upper fields are preserved on body edit');
select public.app_update_activity(current_setting('test.single.legacy')::bigint,2,gen_random_uuid(),'{"title":"짧은 제목","summary":"짧은 요약"}');
select extensions.is(public.app_activity_search_index_coverage()->>'excluded_count','0','corrected legacy source becomes eligible');
set local role postgres;
select extensions.is((select count(*) from pgmq.q_activity_search_index where message->>'record_id'=current_setting('test.single.legacy')
  and message->>'record_type'='activity'),1::bigint,'corrected legacy source queues one whole input');
set local role authenticated;
select public.app_delete_activity(current_setting('test.single.legacy')::bigint,3);
set local role postgres;
select extensions.is((select count(*) from pgmq.q_activity_search_index where message->>'record_id'=current_setting('test.single.legacy')
  and message->>'record_type'='activity'),0::bigint,'delete removes pending job');
select extensions.ok(not has_function_privilege('authenticated','public.app_get_activity_search_job(text,text,text,text)','EXECUTE'),
  'worker source remains service-only');
alter table public.portfolio_tasks disable trigger portfolio_tasks_upper_limits;
insert into public.portfolio_tasks(user_id,kind,title,summary,trigger_text,subject,timezone)
values ('00000000-0000-0000-0000-000000091975','general',repeat('제',200),repeat('요',500),'할 일 상세',
  '{"kind":"portfolio"}','Asia/Seoul');
alter table public.portfolio_tasks enable trigger portfolio_tasks_upper_limits;
select set_config('test.single.task',(select id::text from public.portfolio_tasks where title=repeat('제',200)),true);
set local role authenticated;
select extensions.lives_ok($q$select public.app_save_structured_general_task(current_setting('test.single.task')::uuid,1,
  gen_random_uuid(),jsonb_build_object('title',repeat('제',200),'summary',repeat('요',500),
  'trigger_text','수정한 할 일 본문','timezone','Asia/Seoul','subject',jsonb_build_object('kind','portfolio')))$q$,
  'structured task edits retain unchanged oversized legacy upper fields');
select extensions.throws_ok($q$select public.app_save_structured_general_task(current_setting('test.single.task')::uuid,2,
  gen_random_uuid(),jsonb_build_object('title',repeat('제',201),'summary',repeat('요',500),
  'trigger_text','할 일 본문','timezone','Asia/Seoul'))$q$,
  'P0001','title is required and must be at most 100 characters','changed legacy task title must use the new limit');
select * from extensions.finish();
rollback;
