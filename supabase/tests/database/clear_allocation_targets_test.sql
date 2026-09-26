begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(9);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000009541','authenticated','authenticated','allocation-clear-owner@example.com','',now(),now(),now()),
       ('00000000-0000-0000-0000-000000009542','authenticated','authenticated','allocation-clear-other@example.com','',now(),now(),now());
set local role postgres;
insert into public.tags(id,user_id,name,sort_order) values
  (9541,'00000000-0000-0000-0000-000000009541','Stocks',1),
  (9542,'00000000-0000-0000-0000-000000009541','Cash',2);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009541',true);
set local role authenticated;
select extensions.is(public.app_save_allocation_targets('[{"tag_id":9541,"target_percentage":60},{"tag_id":9542,"target_percentage":40}]'::jsonb,'[]'::jsonb)->>'configured','true','targets configured');
select extensions.throws_ok($$select public.app_clear_allocation_targets('[]'::jsonb)$$,
  'P0001','Allocation targets changed; reload before clearing','stale clear is rejected');
select extensions.is(public.app_clear_allocation_targets('[{"tag_id":9541,"target_percentage":60},{"tag_id":9542,"target_percentage":40}]'::jsonb)->>'configured','false','clear leaves unconfigured state');
select extensions.is((select count(*)::integer from public.allocation_targets where user_id=auth.uid()),0,'target rows removed');
select extensions.is((select count(*)::integer from public.tags where user_id=auth.uid()),2,'asset tags remain');
select extensions.is((select count(*)::integer from public.activity_events where user_id=auth.uid() and action_type='reset_allocation_targets'),1,'one reset activity');
select extensions.is(public.app_clear_allocation_targets('[]'::jsonb)->>'configured','false','repeat clear is no-op');
select extensions.is((select count(*)::integer from public.activity_events where user_id=auth.uid() and action_type='reset_allocation_targets'),1,'no-op adds no activity');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009542',true);
select extensions.throws_ok($$select public.app_clear_allocation_targets(null)$$,
  'P0001','Invalid expected targets','invalid input rejected for another owner');
select * from extensions.finish();
rollback;
