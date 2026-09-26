begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(17);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000009591','authenticated','authenticated','domain-context-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000009592','authenticated','authenticated','domain-context-other@example.com','',now(),now(),now());
set local role postgres;
insert into public.accounts(id,user_id,name) values (9591,'00000000-0000-0000-0000-000000009591','Main');
insert into public.instruments(id,user_id,ticker,display_name,currency,instrument_type,note)
values (9591,'00000000-0000-0000-0000-000000009591','CONTEXT','Before','KRW','market',null);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009591',true);
set local role authenticated;
select set_config('test.activity_tag',public.app_save_activity_tag(null,null,'95910000-0000-4000-8000-000000000001','실적')->>'id',true);
select set_config('test.asset_tag',(select tag_id::text from public.app_save_tag(null,'Domestic',1,'user',null)),true);
create temp table context_fixture(kind text,response jsonb) on commit drop;
grant select,insert on context_fixture to authenticated;

insert into context_fixture values ('asset',public.app_save_asset_detail_with_activity(9591,
  '{"display_name":"Before","currency":"KRW","instrument_type":"market","note":null,"tag_id":null}'::jsonb,
  '{"display_name":"After","currency":"KRW","instrument_type":"market","note":null,"tag_id":null}'::jsonb,
  jsonb_build_array(jsonb_build_object('id',null,'account_id',9591,'quantity',2,'avg_price',100)),
  '95910000-0000-4000-8000-000000000002','확인 후 수정',array[current_setting('test.activity_tag')::uuid]));
select extensions.ok((select (response->>'activity_id')::bigint>0 from context_fixture where kind='asset'),'asset returns its activity id');
select extensions.is((select count(*) from public.activity_event_tags where activity_event_id=(select (response->>'activity_id')::bigint from context_fixture where kind='asset')),1::bigint,'asset activity is tagged once');
select extensions.is((select count(*) from public.activity_events where user_id=auth.uid() and action_type='save_asset_detail'),1::bigint,'multi-field asset save has one activity');
select extensions.is((select response from context_fixture where kind='asset'),public.app_save_asset_detail_with_activity(9591,
  '{"display_name":"Before","currency":"KRW","instrument_type":"market","note":null,"tag_id":null}'::jsonb,
  '{"display_name":"After","currency":"KRW","instrument_type":"market","note":null,"tag_id":null}'::jsonb,
  jsonb_build_array(jsonb_build_object('id',null,'account_id',9591,'quantity',2,'avg_price',100)),
  '95910000-0000-4000-8000-000000000002','확인 후 수정',array[current_setting('test.activity_tag')::uuid]),'asset lost-response retry returns same receipt');
select extensions.throws_ok($$select public.app_save_asset_detail_with_activity(9591,
  '{"display_name":"After","currency":"KRW","instrument_type":"market","note":null,"tag_id":null}'::jsonb,
  '{"display_name":"Changed","currency":"KRW","instrument_type":"market","note":null,"tag_id":null}'::jsonb,
  '[]'::jsonb,'95910000-0000-4000-8000-000000000003',null,array['95910000-0000-4000-8000-000000000099'::uuid])$$,
  'P0001','Invalid activity tag','missing tag rejects the whole asset save');
select extensions.is((select display_name from public.instruments where id=9591),'After','failed tag does not change instrument');
select extensions.is(jsonb_array_length(public.app_search_activities(input_record_state=>'done',input_tag_ids=>array[current_setting('test.activity_tag')::uuid])->'items'),1,'tag search finds asset save');

insert into context_fixture values ('allocation',public.app_save_allocation_targets_with_activity(
  jsonb_build_array(jsonb_build_object('tag_id',current_setting('test.asset_tag')::bigint,'target_percentage',100)),
  '[]'::jsonb,'목표 변경',array[current_setting('test.activity_tag')::uuid],
  '95910000-0000-4000-8000-000000000004'));
select extensions.ok((select (response->>'activity_id')::bigint>0 from context_fixture where kind='allocation'),'allocation returns activity id');
select extensions.is((select count(*) from public.activity_event_tags where activity_event_id=(select (response->>'activity_id')::bigint from context_fixture where kind='allocation')),1::bigint,'allocation activity is tagged');
select extensions.is((select response from context_fixture where kind='allocation'),public.app_save_allocation_targets_with_activity(
  jsonb_build_array(jsonb_build_object('tag_id',current_setting('test.asset_tag')::bigint,'target_percentage',100)),
  '[]'::jsonb,'목표 변경',array[current_setting('test.activity_tag')::uuid],
  '95910000-0000-4000-8000-000000000004'),'allocation retry returns same activity');
select extensions.is(public.app_clear_allocation_targets_with_activity((select jsonb_agg(jsonb_build_object('tag_id',tag_id,'target_percentage',target_percentage) order by tag_id) from public.allocation_targets where user_id=auth.uid()),null,
  array[current_setting('test.activity_tag')::uuid],'95910000-0000-4000-8000-000000000005')->>'configured','false','clear keeps unconfigured state');
select extensions.is((select count(*) from public.activity_event_tags relation join public.activity_events event on event.id=relation.activity_event_id where event.action_type='reset_allocation_targets' and event.user_id=auth.uid()),1::bigint,'clear activity is tagged');

insert into context_fixture values ('principle',public.app_save_principle_with_activity(
  '95910000-0000-4000-8000-000000000006',null,null,null,'첫 원칙','첫 작성',
  array[current_setting('test.activity_tag')::uuid]));
select extensions.ok((select (response->>'activity_id')::bigint>0 from context_fixture where kind='principle'),'principle returns activity id');
select extensions.is((select count(*) from public.activity_event_tags where activity_event_id=(select (response->>'activity_id')::bigint from context_fixture where kind='principle')),1::bigint,'principle activity is tagged');
select extensions.is((select count(*) from public.principles where user_id=auth.uid()),1::bigint,'one principle revision saved');
select extensions.is((select response from context_fixture where kind='principle'),public.app_save_principle_with_activity(
  '95910000-0000-4000-8000-000000000006',null,null,null,'첫 원칙','첫 작성',
  array[current_setting('test.activity_tag')::uuid]),'principle retry does not append another row');
select extensions.is((select count(*) from public.activity_events where user_id=auth.uid() and target_table='principles'),1::bigint,'principle retry does not add activity');
select * from extensions.finish();
rollback;
