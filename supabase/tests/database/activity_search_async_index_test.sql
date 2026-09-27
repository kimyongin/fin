begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(23);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000001961','authenticated','authenticated',
  'async-search-fixture@example.com','',now(),now(),now()),
  ('00000000-0000-0000-0000-000000001962','authenticated','authenticated',
  'async-search-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001961',true);
set local role authenticated;

select public.app_create_activity('26111111-1111-4111-8111-111111111111',jsonb_build_object(
  'title','손실 심리 자료','body','투자자가 불안할 때 오래된 이론을 다시 읽는다',
  'timezone','Asia/Seoul','authored_via','app'));
select public.app_save_general_task(null,null,'26222222-2222-4222-8222-222222222222',
  jsonb_build_object('title','심리 점검','subject',jsonb_build_object('kind','portfolio'),
    'timezone','Asia/Seoul','authored_via','app'));

set local role postgres;
select extensions.is((select count(*) from pgmq.q_activity_search_index q
  where q.message->>'user_id'='00000000-0000-0000-0000-000000001961'),2::bigint,
  'record and task writes queue one document each');
select extensions.is((select count(*) from public.activity_search_vectors
  where user_id='00000000-0000-0000-0000-000000001961'),0::bigint,
  'saving returns before embedding is generated');
select set_config('test.search_message_id',(select msg_id::text from pgmq.q_activity_search_index
    where message->>'record_type'='activity' and message->>'user_id'='00000000-0000-0000-0000-000000001961'
    order by msg_id desc limit 1),true);
select set_config('test.search_content_hash',(select message->>'content_hash' from pgmq.q_activity_search_index
    where message->>'record_type'='activity' and message->>'user_id'='00000000-0000-0000-0000-000000001961'
    order by msg_id desc limit 1),true);

set local role service_role;
select extensions.is(public.app_get_activity_search_job('activity',
  (select id::text from public.activity_events where title='손실 심리 자료'),0,
  current_setting('test.search_content_hash'),'multilingual-e5-large')->>'stale','false','worker receives current document');
select public.app_finish_activity_search_job(
  current_setting('test.search_message_id')::bigint,
  '00000000-0000-0000-0000-000000001961','activity',
  (select id::text from public.activity_events where title='손실 심리 자료'),0,
  current_setting('test.search_content_hash'),'multilingual-e5-large',
  (select concat_ws(E'\n',title,body) from public.activity_events where title='손실 심리 자료'),
  ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[1023]),',')||']')::extensions.vector);

set local role authenticated;
select extensions.is(public.app_activity_search_index_coverage()->>'missing_count','1',
  'coverage distinguishes the pending task from the indexed record');
select extensions.is(public.app_search_activities_ranked('심리',
  ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[1023]),',')||']')::extensions.vector
  )->'items'->0->>'record_type','task','title prefix ranks ahead of a body match');
select extensions.is(jsonb_array_length(public.app_search_activities_ranked('심리',
  ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[1023]),',')||']')::extensions.vector
  )->'items'),2,'task and record search in one list');
select extensions.is(public.app_search_activities_ranked('심리',
  ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[1023]),',')||']')::extensions.vector
  )->>'search_mode','hybrid','ranked response reports the actual hybrid mode');
select extensions.is(public.app_search_activities_ranked('심리',
  ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[1023]),',')||']')::extensions.vector
  )->'items'->0->'matched_by','["keyword"]'::jsonb,'pending task is a keyword hit only');
select extensions.is(public.app_search_activities_ranked('심리',
  ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[1023]),',')||']')::extensions.vector
  )->'items'->1->'matched_by','["keyword","semantic"]'::jsonb,'indexed record reports both match conditions');
select extensions.is(public.app_search_activities_ranked('심리',
  ('['||array_to_string(array[0.0::real,1.0::real]||array_fill(0.0::real,array[1022]),',')||']')::extensions.vector
  )->'items'->1->'matched_by','["keyword"]'::jsonb,'below-threshold score is not a semantic hit');
select extensions.ok((public.app_search_activities_ranked('심리',
  ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[1023]),',')||']')::extensions.vector,
  input_limit=>1)->'next_cursor') is not null,'ranked search returns a cursor');
select extensions.is(public.app_search_activities_ranked('심리',
  ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[1023]),',')||']')::extensions.vector,
  input_limit=>1,input_cursor=>public.app_search_activities_ranked('심리',
    ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[1023]),',')||']')::extensions.vector,
    input_limit=>1)->'next_cursor')->'items'->0->>'record_type','activity',
  'ranked cursor reaches the next result without duplication');
select extensions.is(public.app_search_activities_ranked('두려움',
  ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[1023]),',')||']')::extensions.vector
  )->'items'->0->>'record_type','activity','semantic match finds different wording');
select extensions.is(public.app_search_activities_ranked('두려움',
  ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[1023]),',')||']')::extensions.vector
  )->'items'->0->'matched_by','["semantic"]'::jsonb,'semantic-only hit reports its actual match condition');
select extensions.is(public.app_search_activities_ranked('심리',null)->>'search_mode','keyword',
  'fallback response reports keyword mode');
select extensions.is(jsonb_array_length(public.app_search_activities_ranked('심리',null,
  input_from=>date '2099-01-01')->'items'),1,
  'record period applies before ranking without restricting tasks');
select extensions.is(jsonb_array_length(public.app_search_activities_ranked('심리',null)->'items'),
  2,'keyword fallback uses the same task and record scope');
select extensions.throws_ok($$select public.app_search_activities_ranked('다른 검색',null,
  input_cursor=>jsonb_build_object('rank',80,'sort_at',now(),'key','task:x',
    'fingerprint','wrong'))$$,
  'P0001','Search conditions changed; start a new search',
  'cursor rejects changed conditions');

select public.app_update_activity((select id from public.activity_events where title='손실 심리 자료'),1,
  '26333333-3333-4333-8333-333333333333','{"body":"문구 수정"}'::jsonb,'app');
set local role postgres;
select extensions.is((select count(*) from public.activity_search_vectors
  where user_id='00000000-0000-0000-0000-000000001961'),0::bigint,
  'editing removes the old vector immediately');
set local role authenticated;
select extensions.is(public.app_activity_search_index_coverage()->>'missing_count','2',
  'edited record is pending again');
select extensions.ok(not has_function_privilege('authenticated',
  'public.app_get_activity_search_job(text,text,integer,text,text)','EXECUTE'),
  'authenticated users cannot fetch worker source text');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001962',true);
select extensions.is(jsonb_array_length(public.app_search_activities_ranked('심리',null,
  input_owner_user_id=>'00000000-0000-0000-0000-000000001961')->'items'),0,
  'another owner cannot read private search results');

set local role postgres;
select extensions.is((select count(*) from pgmq.q_activity_search_index q
  where q.message->>'user_id'='00000000-0000-0000-0000-000000001961'),2::bigint,
  'task and new record work remain after the completed job is acknowledged');

select * from extensions.finish();
rollback;
