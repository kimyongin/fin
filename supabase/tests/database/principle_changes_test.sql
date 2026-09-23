begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(12);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000001941','authenticated','authenticated','principle-changes-owner@example.com','',now(),now(),now()),
       ('00000000-0000-0000-0000-000000001942','authenticated','authenticated','principle-changes-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001941',true);
set local role authenticated;

select extensions.is(public.app_list_principle_changes()->'items','[]'::jsonb,'starts with no changes');
select public.app_save_principle('94000000-0000-0000-0000-000000000001',null,'처음');
select public.app_save_principle('94000000-0000-0000-0000-000000000002',null,'다른 원칙');
select public.app_save_principle('94000000-0000-0000-0000-000000000001',
  (select id from public.principles where principle_id='94000000-0000-0000-0000-000000000001' order by id desc limit 1),
  '수정 후','변경 이유');
select public.app_save_principle('94000000-0000-0000-0000-000000000001',
  (select id from public.principles where principle_id='94000000-0000-0000-0000-000000000001' order by id desc limit 1),
  '종료 후','중단',true);

select extensions.is(jsonb_array_length(public.app_list_principle_changes()->'items'),4,'all changes are listed');
select extensions.is(public.app_list_principle_changes() #>> '{items,0,change_type}','ended','latest row is an end');
select extensions.is(public.app_list_principle_changes() #>> '{items,0,body}','수정 후','end retains the preceding body');
select extensions.is(public.app_list_principle_changes(1) #>> '{items,0,change_note}','중단','end note is returned outside the page');
select extensions.is(jsonb_array_length(public.app_list_principle_changes(1,
  public.app_list_principle_changes(1)->'next_cursor')->'items'),1,'cursor advances without duplicate');
select extensions.is(public.app_list_principle_changes() #>> '{items,1,change_type}','updated','second revision is classified as an update');
select extensions.is(public.app_list_principle_changes() #>> '{items,1,change_note}','변경 이유','updates return their own note');
reset role;
update public.principles set effective_at='2026-09-23T12:00:00Z'
where user_id='00000000-0000-0000-0000-000000001941';
set local role authenticated;
select extensions.is(public.app_list_principle_changes(1) #>> '{items,0,id}',
  (select max(id)::text from public.principles where user_id='00000000-0000-0000-0000-000000001941'),
  'equal timestamps sort by descending row id');
select extensions.is(public.app_list_principle_changes(1,
  public.app_list_principle_changes(1)->'next_cursor') #>> '{items,0,id}',
  (select id::text from public.principles where user_id='00000000-0000-0000-0000-000000001941' order by id desc offset 1 limit 1),
  'equal-timestamp cursor advances by row id without duplicating the first row');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001942',true);
select extensions.is(public.app_list_principle_changes()->'items','[]'::jsonb,'other owner sees no changes');
select extensions.throws_ok($$select public.app_list_principle_changes(20,'{"bad":1}'::jsonb)$$,
  'P0001','Invalid principle change cursor','invalid cursor is rejected');

select * from extensions.finish();
rollback;
