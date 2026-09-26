begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(14);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000009511','authenticated','authenticated','principle-crud-owner@example.com','',now(),now(),now()),
       ('00000000-0000-0000-0000-000000009512','authenticated','authenticated','principle-crud-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009511',true);
set local role authenticated;

select extensions.throws_ok($$select public.app_get_principle_row(9999999)$$,
  'P0001','Principle revision not found','missing row does not disclose another owner');
select extensions.is(public.app_save_principle_checked('95100000-0000-0000-0000-000000000001',null,null,null,'첫 기준','작성') ->> 'body',
  '첫 기준','create a first principle');
select extensions.is(public.app_save_principle_checked('95100000-0000-0000-0000-000000000001',
  (public.app_list_principles() #>> '{items,0,id}')::bigint,'첫 기준','작성','둘째 기준','변경') ->> 'body',
  '둘째 기준','append an approved current change');
select extensions.is(jsonb_array_length(public.app_list_principle_changes()->'items'),2,
  'history has both rows');
select extensions.is(public.app_get_principle_row((public.app_list_principle_changes() #>> '{items,1,id}')::bigint)->>'body',
  '첫 기준','fetch a historical row by ID');
select extensions.is(public.app_correct_principle_row(
  (public.app_list_principle_changes() #>> '{items,1,id}')::bigint,'첫 기준','작성','첫 기준 정정','오타 수정')->>'body',
  '첫 기준 정정','correct a historical row in place');
select extensions.is(jsonb_array_length(public.app_list_principle_changes()->'items'),2,
  'correction adds no new history row');
select extensions.throws_ok($$select public.app_correct_principle_row(
  (public.app_list_principle_changes() #>> '{items,1,id}')::bigint,'첫 기준','작성','오래된 내용','오래된 메모')$$,
  'P0001','Principle revision changed; reload before saving','stale correction is rejected');
select extensions.is(public.app_correct_principle_row(
  (public.app_list_principle_changes() #>> '{items,0,id}')::bigint,'둘째 기준','변경','둘째 기준 정정','변경')->>'body',
  '둘째 기준 정정','correct current row in place');
select extensions.throws_ok($$select public.app_save_principle_checked('95100000-0000-0000-0000-000000000001',
  (public.app_list_principles() #>> '{items,0,id}')::bigint,'둘째 기준','변경','오래된 초안',null)$$,
  'P0001','Principle changed; reload before saving','stale current body cannot append');
select extensions.throws_ok($$select public.app_save_principle('95100000-0000-0000-0000-000000000001',
  (public.app_list_principles() #>> '{items,0,id}')::bigint,'오래된 클라이언트 편집',null)$$,
  'P0001','Principle changed; reload before saving','old client cannot overwrite corrected current row');
select extensions.is(public.app_delete_principle_row(
  (public.app_list_principles() #>> '{items,0,id}')::bigint,'둘째 기준 정정','변경',
  (public.app_list_principles() #>> '{items,0,id}')::bigint) #>> '{current,body}',
  '첫 기준 정정','deleting current reactivates preceding revision');
select extensions.is(public.app_delete_principle_row(
  (public.app_list_principles() #>> '{items,0,id}')::bigint,'첫 기준 정정','오타 수정',
  (public.app_list_principles() #>> '{items,0,id}')::bigint)->'current',
  'null'::jsonb,'deleting last row leaves no current document');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009512',true);
select extensions.is(public.app_list_principle_changes()->'items','[]'::jsonb,
  'another owner sees no history');
select * from extensions.finish();
rollback;
