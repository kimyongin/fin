begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(15);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000009311','authenticated','authenticated','allocation-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000009312','authenticated','authenticated','allocation-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009311',true);
set local role authenticated;
select set_config('test.allocation_tag1',(select tag_id::text from public.app_save_tag(null,'Allocation One',1,'user',null)),true);
select set_config('test.allocation_tag2',(select tag_id::text from public.app_save_tag(null,'Allocation Two',2,'user',null)),true);
select extensions.is(public.app_get_strategy_state()->>'configured','false','starts with no target set');
select extensions.is(public.app_get_strategy_state()->'targets','[]'::jsonb,'unset is not an invented target');

select extensions.is(public.app_save_allocation_targets(jsonb_build_array(
  jsonb_build_object('tag_id',current_setting('test.allocation_tag1')::bigint,'target_percentage',35.25),
  jsonb_build_object('tag_id',current_setting('test.allocation_tag2')::bigint,'target_percentage',64.75)), '[]'::jsonb)->>'configured','true','saves a complete target set');
select extensions.is((select sum(target_percentage) from public.allocation_targets where user_id=auth.uid()),100.00::numeric,'saved sum is exact');
select extensions.is(jsonb_array_length(public.app_get_strategy_state()->'targets'),2,'reads both target rows');
select extensions.is(public.app_save_allocation_targets(jsonb_build_array(
  jsonb_build_object('tag_id',current_setting('test.allocation_tag1')::bigint,'target_percentage',35.25),
  jsonb_build_object('tag_id',current_setting('test.allocation_tag2')::bigint,'target_percentage',64.75)), '[]'::jsonb)->>'configured','true','same request retry is safe');
select extensions.is((select count(*) from public.activity_events where user_id=auth.uid() and target_table='allocation_targets'),1::bigint,'retry does not add another activity');
select extensions.throws_ok(format('select public.app_save_allocation_targets(''[{"tag_id":%s,"target_percentage":99}]''::jsonb,''[]''::jsonb)',current_setting('test.allocation_tag1')),'P0001','Allocation targets must total 100.00 percent','rejects incomplete total');
select extensions.throws_ok(format('select public.app_save_allocation_targets(''[{"tag_id":%s,"target_percentage":50},{"tag_id":%s,"target_percentage":50}]''::jsonb,''[]''::jsonb)',current_setting('test.allocation_tag1'),current_setting('test.allocation_tag1')),'P0001','Invalid or duplicate allocation target','rejects duplicate tags');
select extensions.throws_ok(format('select public.app_save_allocation_targets(''[{"tag_id":%s,"target_percentage":100.001}]''::jsonb,''[]''::jsonb)',current_setting('test.allocation_tag1')),'P0001','Invalid allocation target','rejects extra decimals');
select extensions.throws_ok(format('select public.app_save_allocation_targets(''[{"tag_id":%s,"target_percentage":100}]''::jsonb,''[]''::jsonb)',current_setting('test.allocation_tag2')),'P0001','Allocation targets changed; reload before saving','rejects stale overwrite');
select extensions.throws_ok(format('select * from public.app_delete_tag(%s)',current_setting('test.allocation_tag1')),'P0001','Move positive allocation target before deleting the tag','positive target cannot be deleted');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009312',true);
select set_config('test.allocation_foreign_tag',(select tag_id::text from public.app_save_tag(null,'Other allocation tag',1,'user',null)),true);
select extensions.throws_ok(format('select public.app_save_allocation_targets(''[{"tag_id":%s,"target_percentage":100}]''::jsonb,''[]''::jsonb)',current_setting('test.allocation_tag1')),'P0001','Allocation tag does not belong to the owner','rejects another owner tag');
select extensions.is((select count(*) from public.allocation_targets),0::bigint,'RLS hides the owner targets');
select extensions.throws_ok($$select public.app_get_strategy_state('00000000-0000-0000-0000-000000009311')$$,'P0001','Allocation targets are not shared','read requires a feature grant');

select * from extensions.finish();
rollback;
