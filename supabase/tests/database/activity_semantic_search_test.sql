begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(12);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001921','authenticated','authenticated','semantic-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001922','authenticated','authenticated','semantic-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001921',true);
set local role authenticated;

select public.app_create_activity('21111111-1111-4111-8111-111111111111',jsonb_build_object('title','손실 위험 줄이기','body','비중 축소 검토','timezone','Asia/Seoul','authored_via','app'));
select public.app_create_activity('21222222-2222-4222-8222-222222222222',jsonb_build_object('title','배당 유지 확인','body','현금흐름 유지','timezone','Asia/Seoul','authored_via','app'));

select extensions.is(jsonb_array_length(public.app_list_activity_embedding_jobs(20)),2,'new current activities are pending embedding jobs');
select extensions.ok((public.app_list_activity_embedding_jobs(20)#>>'{0,content_hash}') is not null,'job exposes a current content hash');

select public.app_upsert_activity_embedding(
  (select id from activity_events where title='손실 위험 줄이기'),
  (select item->>'content_hash' from jsonb_array_elements(public.app_list_activity_embedding_jobs(20)) item where (item->>'activity_id')::bigint=(select id from activity_events where title='손실 위험 줄이기')),
  'fixture-384',
  ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[383]),',')||']')::extensions.vector
);
select public.app_upsert_activity_embedding(
  (select id from activity_events where title='배당 유지 확인'),
  (select item->>'content_hash' from jsonb_array_elements(public.app_list_activity_embedding_jobs(20)) item where (item->>'activity_id')::bigint=(select id from activity_events where title='배당 유지 확인')),
  'fixture-384',
  ('['||array_to_string(array_fill(0.0::real,array[383])||array[1.0::real],',')||']')::extensions.vector
);
select extensions.is(jsonb_array_length(public.app_list_activity_embedding_jobs(20)),0,'current embeddings clear the pending jobs');
select extensions.is(
  public.app_search_activity_semantic(
    ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[383]),',')||']')::extensions.vector,
    null,null,null,null,null,null,null,'any',10,'Asia/Seoul'
  )#>>'{items,0,title}',
  '손실 위험 줄이기',
  'semantic search orders the nearest current activity first'
);
select extensions.ok((public.app_search_activity_semantic(
    ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[383]),',')||']')::extensions.vector,
    null,null,null,null,null,null,null,'any',10,'Asia/Seoul'
  )#>>'{items,0,semantic_score}')::numeric > 0.99,'semantic search returns a similarity score');

select public.app_update_activity((select id from activity_events where title='손실 위험 줄이기'),1,
  '21333333-3333-4333-8333-333333333333','{"body":"위험 해소"}'::jsonb,'app');
select extensions.is(jsonb_array_length(public.app_list_activity_embedding_jobs(20)),1,'editing current content makes only that embedding stale');
select extensions.is(jsonb_array_length(public.app_search_activity_semantic(
    ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[383]),',')||']')::extensions.vector,
    null,null,null,null,null,null,null,'any',10,'Asia/Seoul'
  )->'items'),1,'stale embeddings are excluded instead of serving old content');
select extensions.throws_ok(
  $$select public.app_upsert_activity_embedding(
    (select id from activity_events where title='손실 위험 줄이기'),'00000000000000000000000000000000','fixture-384',
    ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[383]),',')||']')::extensions.vector)$$,
  'P0001','Activity embedding content changed','an old embedding job cannot overwrite current content'
);

select extensions.is(jsonb_array_length(public.app_search_activity_semantic(
    ('['||array_to_string(array_fill(0.0::real,array[383])||array[1.0::real],',')||']')::extensions.vector,
    null,null,null,999999,null,null,null,'any',10,'Asia/Seoul'
  )->'items'),0,'structured filters are applied before semantic results');
select extensions.is((select count(*) from activity_embeddings),2::bigint,'derived embeddings are stored once per activity');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001922',true);
select extensions.is(jsonb_array_length(public.app_list_activity_embedding_jobs(20)),0,'pending jobs are owner isolated');
select extensions.is(jsonb_array_length(public.app_search_activity_semantic(
    ('['||array_to_string(array[1.0::real]||array_fill(0.0::real,array[383]),',')||']')::extensions.vector,
    null,null,null,null,null,null,null,'any',10,'Asia/Seoul'
  )->'items'),0,'semantic results are owner isolated');

select * from extensions.finish();
rollback;
