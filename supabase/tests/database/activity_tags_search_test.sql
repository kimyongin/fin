begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(30);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001911','authenticated','authenticated','activity-search-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001912','authenticated','authenticated','activity-search-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001911',true);
set local role authenticated;

select extensions.is(public.app_save_activity_tag(null,null,'20111111-1111-4111-8111-111111111111','실적')->>'name','실적','creates an activity tag');
select extensions.is(public.app_save_activity_tag(null,null,'20222222-2222-4222-8222-222222222222','확인')->>'name','확인','creates another activity tag');
select extensions.is(jsonb_array_length(public.app_list_activity_tags(null)),2,'lists reusable owner tags');
select extensions.throws_ok(
  $$select public.app_save_activity_tag(null,null,'20333333-3333-4333-8333-333333333333','실적')$$,
  'P0001','Activity tag name already exists','tag names are unique per owner'
);

select public.app_create_activity('20444444-4444-4444-8444-444444444444',jsonb_build_object(
  'title','삼성전자 실적 확인','body','이익 증가. 보유 유지','timezone','Asia/Seoul','authored_via','app'));
select extensions.is(public.app_set_activity_tags(
  (select id from activity_events where title='삼성전자 실적 확인'),1,
  array[(select id from activity_tags where name='실적')],
  '20555555-5555-4555-8555-555555555555'
)->>'version','2','sets activity tags and advances its conflict version');
select extensions.is(jsonb_array_length(public.app_get_activity((select id from activity_events where title='삼성전자 실적 확인'),null)->'tags'),1,'activity detail returns tags');
select extensions.is((public.app_get_activity((select id from activity_events where title='삼성전자 실적 확인'),null)#>>'{tags,0,name}'),'실적','activity detail returns tag names');

select public.app_save_general_task(null,null,'20666666-6666-4666-8666-666666666666',jsonb_build_object(
  'title','매일 시세 확인','subject',jsonb_build_object('kind','portfolio'),'timezone','Asia/Seoul',
  'recurrence_kind','daily','recurrence_start_on',(clock_timestamp() at time zone 'Asia/Seoul')::date::text,'authored_via','app'));
set local role postgres;
update public.portfolio_tasks set subject=jsonb_build_object('kind','portfolio','instrument_id','not-a-number') where title='매일 시세 확인';
set local role authenticated;
select extensions.lives_ok($$select public.app_search_activities()$$,'free-form task subject does not break instrument navigation');
select extensions.is(public.app_set_general_task_tags(
  (select id from portfolio_tasks where title='매일 시세 확인'),1,
  array[(select id from activity_tags where name='확인')],
  '20777777-7777-4777-8777-777777777777'
)#>>'{tags,0,name}','확인','sets tags on a general task');
select public.app_transition_general_task((select id from portfolio_tasks where title='매일 시세 확인'),1,'complete','변화 없음',null,(clock_timestamp() at time zone 'Asia/Seoul')::date,
  '20888888-8888-4888-8888-888888888888','app');
select extensions.is((select count(*) from activity_event_tags relation join activity_events event on event.id=relation.activity_event_id where event.action_type='complete_general_task'),1::bigint,'completion copies current task tags');
select extensions.is(public.app_set_general_task_tags(
  (select id from portfolio_tasks where title='매일 시세 확인'),2,
  array[(select id from activity_tags where name='실적')],
  '20999999-9999-4999-8999-999999999999'
)#>>'{tags,0,name}','실적','later task tag edits are allowed');
select extensions.is((select tag.name from activity_event_tags relation join activity_events event on event.id=relation.activity_event_id join activity_tags tag on tag.id=relation.tag_id where event.action_type='complete_general_task'),'확인','later task tag edits do not rewrite past completion tags');

select extensions.is(jsonb_array_length(public.app_search_activities(input_query=>'삼성전자',input_record_state=>'done')->'items'),1,'keyword search finds current activity title');
select extensions.is((public.app_search_activities(input_query=>'보유 유지',input_record_state=>'done')#>>'{items,0,title}'),'삼성전자 실적 확인','body text is searchable');
select extensions.is(jsonb_array_length(public.app_search_activities(input_record_state=>'done',input_tag_ids=>array[(select id from activity_tags where name='실적')])->'items'),1,'tag filter finds the tagged activity');
select extensions.is(jsonb_array_length(public.app_search_activities(input_record_state=>'done',input_tag_ids=>array[(select id from activity_tags where name='실적'),(select id from activity_tags where name='확인')])->'items'),2,'multiple tags match any by default');
select extensions.is(jsonb_array_length(public.app_search_activities(input_record_state=>'done',input_tag_ids=>array[(select id from activity_tags where name='실적'),(select id from activity_tags where name='확인')],input_tag_match=>'all')->'items'),0,'all-tag option requires every selected tag');
select extensions.is(jsonb_array_length(public.app_search_activities(input_query=>'시세',input_record_state=>'todo')->'items'),1,'completed recurring definition remains searchable for stopping');
select extensions.is(jsonb_array_length(public.app_search_activities(input_query=>'변화 없음',input_record_state=>'done')->'items'),1,'completion body is searchable');
select extensions.is(jsonb_array_length(public.app_search_activities(input_query=>'삼성전자',input_record_state=>'done',input_tag_ids=>array[(select id from activity_tags where name='확인')])->'items'),0,'keyword and tag conditions intersect before pagination');
select extensions.is(jsonb_array_length(public.app_search_activities(input_record_state=>'done',input_limit=>1,input_cursor=>public.app_search_activities(input_record_state=>'done',input_limit=>1)->'next_cursor')->'items'),1,'tagless results paginate without losing matches');
select extensions.throws_ok($$select public.app_search_activities(input_tag_match=>'invalid')$$,'P0001','Invalid activity tag match','invalid tag match is rejected');
select extensions.ok(exists(select 1 from jsonb_array_elements(public.app_list_action_timeline()->'days') d cross join lateral jsonb_array_elements(d->'items') i where i->>'title'='삼성전자 실적 확인' and i->>'body'='이익 증가. 보유 유지'),'timeline includes readable body rather than a kind');
select extensions.ok((public.app_search_activities(input_record_state=>'done',input_limit=>1)->'next_cursor') is not null,'combined search has stable pagination');

select extensions.is(public.app_save_activity_tag(
  (select id from activity_tags where name='실적'),1,'20aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','기업 실적'
)->>'name','기업 실적','renames a tag without changing relations');
select extensions.is((public.app_get_activity((select id from activity_events where title='삼성전자 실적 확인'),null)#>>'{tags,0,name}'),'기업 실적','renamed tag is reflected in activity detail');
select extensions.is(public.app_delete_activity_tag(
  (select id from activity_tags where name='확인'),1,'20bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
)->>'deleted','true','deletes a tag and its relations');
select extensions.is((select count(*) from activity_event_tags relation join activity_tags tag on tag.id=relation.tag_id where tag.name='확인'),0::bigint,'tag deletion removes relation rows');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001912',true);
select extensions.is(jsonb_array_length(public.app_search_activities(input_query=>'삼성전자')->'items'),0,'search never returns another owner data');
select extensions.is(jsonb_array_length(public.app_list_activity_tags(null)),0,'tag dictionary is owner isolated');

select * from extensions.finish();
rollback;
