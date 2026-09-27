begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(15);

select extensions.is((select count(*) from public.activity_search_chunks('')),0::bigint,
  'empty source has no chunks');
select extensions.is((select count(*) from public.activity_search_chunks('짧은 기록')),1::bigint,
  'short source is one chunk');
select extensions.is((select excerpt from public.activity_search_chunks('제목' || E'\n' || repeat('가',12001))
  order by chunk_no desc limit 1) is not null,true,
  'the last chunk exists past 12000 characters');
select extensions.is((select string_agg(excerpt,'' order by chunk_no)
  from public.activity_search_chunks('제목' || E'\n' || repeat('가',12001))),
  '제목' || E'\n' || repeat('가',12001),
  'all source characters are covered once by excerpts');
select extensions.is((select bool_and(octet_length(embedding_input)<=900)
  from public.activity_search_chunks('제목' || E'\n' || repeat('😀가',500))),
  true,'Korean and emoji inputs stay under the byte budget');
select extensions.is((select bool_and(chunk_no=n-1) from
  (select chunk_no,row_number() over(order by chunk_no) n
   from public.activity_search_chunks(repeat('문장입니다. ',1500))) numbered),
  true,'chunk numbers are contiguous');
select extensions.is((select count(*)>1 from public.activity_search_chunks(repeat('긴URL',2000))),
  true,'unbroken text is split instead of being dropped');
select extensions.is(public.activity_search_content_hash('x'||repeat('a',12001)) <>
  public.activity_search_content_hash('x'||repeat('a',12000)||'b'),
  true,'a change past character 12000 changes the hash');
select extensions.is((select bool_and(excerpt <> '' and embedding_input <> '')
  from public.activity_search_chunks('제목' || E'\n' || repeat('본문',1000))),
  true,'every chunk has new source text and embedding input');
select extensions.is((select bool_and(strpos('제목' || E'\n' || repeat('짧은 문장. ',1000),excerpt)>0)
  from public.activity_search_chunks('제목' || E'\n' || repeat('짧은 문장. ',1000))),
  true,'an overlapped excerpt remains a contiguous source passage');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000001973','authenticated','authenticated',
  'pinecone-search-fixture@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001973',true);
set local role authenticated;
select public.app_create_activity('27333333-3333-4333-8333-333333333333',jsonb_build_object(
  'title','긴 투자 기록','body',repeat('가',12000)||' 매도 예외: 장기 가정 유지',
  'timezone','Asia/Seoul','authored_via','app'));
set local role postgres;
select set_config('test.pinecone.old_hash',(select message->>'content_hash'
  from pgmq.q_activity_search_index where message->>'user_id'='00000000-0000-0000-0000-000000001973'
  order by msg_id desc limit 1),true);
select extensions.ok((select count(*)>30 from pgmq.q_activity_search_index
  where message->>'user_id'='00000000-0000-0000-0000-000000001973'),
  'the queue includes chunks beyond the former 30-chunk cap');
select extensions.is((select count(*) from pgmq.q_activity_search_index
  where message->>'user_id'='00000000-0000-0000-0000-000000001973'
    and message->>'model'='multilingual-e5-large'),
  (select count(*) from public.activity_search_chunks('긴 투자 기록'||E'\n'||repeat('가',12000)||' 매도 예외: 장기 가정 유지')),
  'each expected chunk is queued with the current model');
set local role authenticated;
select extensions.is(public.app_activity_search_index_coverage()->>'missing_count','1',
  'missing last chunk prevents complete coverage');
select extensions.throws_ok($q$
  select public.app_search_activities_ranked_ticker(
    input_query=>'심리',
    input_query_embedding=>('['||repeat('0.1,',1023)||'0.1]')::extensions.vector,
    input_query_model=>'gte-small')
$q$,'P0001','Search embedding model mismatch',
  'a query cannot label a vector with an old model');
select public.app_update_activity((select id from public.activity_events where title='긴 투자 기록'),1,
  '27444444-4444-4444-8444-444444444444',
  jsonb_build_object('body',repeat('가',12000)||' 매도 예외: 변경됨'),'app');
set local role service_role;
select extensions.is(public.app_get_activity_search_job('activity',
  (select id::text from public.activity_events where title='긴 투자 기록'),0,
  current_setting('test.pinecone.old_hash'),'multilingual-e5-large')->>'stale','true',
  'a tail-only edit invalidates an old queued job');

select * from extensions.finish();
rollback;
