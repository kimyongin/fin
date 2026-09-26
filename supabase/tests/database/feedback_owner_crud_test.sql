begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(13);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000009551','authenticated','authenticated','feedback-crud-owner@example.com','',now(),now(),now()),
       ('00000000-0000-0000-0000-000000009552','authenticated','authenticated','feedback-crud-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009551',true);
set local role authenticated;
select extensions.is((public.app_submit_product_feedback('old private body','{}'::jsonb,'app','00000000-0000-0000-0000-000000009553'::uuid)->>'body'),'old private body','owner submits');
select extensions.is((select count(*)::integer from public.product_feedback where reporter_user_id=auth.uid()),1,'one submission');
select extensions.is((public.app_get_my_product_feedback((select id from public.product_feedback where reporter_user_id=auth.uid()))->>'body'),'old private body','owner detail');
select extensions.throws_ok($$select public.app_update_my_product_feedback((select id from public.product_feedback where reporter_user_id=auth.uid()),2,'new text')$$,'P0001','feedback version conflict','stale correction blocked');
select extensions.is((public.app_update_my_product_feedback((select id from public.product_feedback where reporter_user_id=auth.uid()),1,'new text')->>'version'),'2','owner correction advances version');
select extensions.is((select request_payload ? 'body' from public.product_feedback_mutation_receipts where reporter_user_id=auth.uid()),false,'prior receipt body redacted');
select extensions.throws_ok($$select public.app_submit_product_feedback('old private body','{}'::jsonb,'app','00000000-0000-0000-0000-000000009553'::uuid)$$,'P0001','idempotency key already used with a different request','old retry cannot revert correction');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009552',true);
select extensions.throws_ok($$select public.app_get_my_product_feedback((select id from public.product_feedback limit 1))$$,'P0001','feedback not found','other owner cannot read');
select extensions.throws_ok($$select public.app_delete_my_product_feedback((select id from public.product_feedback limit 1),2)$$,'P0001','feedback not found','other owner cannot delete');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009551',true);
select extensions.is((public.app_delete_my_product_feedback((select id from public.product_feedback where reporter_user_id=auth.uid()),2)->>'deleted'),'true','owner deletes');
select extensions.is((select count(*)::integer from public.product_feedback where reporter_user_id=auth.uid()),0,'submission removed');
select extensions.is((select count(*)::integer from public.product_feedback_mutation_receipts where reporter_user_id=auth.uid() and (request_payload::text like '%old private body%' or response_payload::text like '%old private body%')),0,'deleted body absent from receipts');
select extensions.throws_ok($$select public.app_submit_product_feedback('old private body','{}'::jsonb,'app','00000000-0000-0000-0000-000000009553'::uuid)$$,'P0001','idempotency key already used with a different request','deleted submission cannot resurrect');
select * from extensions.finish();
rollback;
