begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(11);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000002451','authenticated','authenticated','whole-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000002452','authenticated','authenticated','whole-friend@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000002453','authenticated','authenticated','whole-other@example.com','',now(),now(),now());
insert into public.friendships(viewer_user_id,owner_user_id)
values('00000000-0000-0000-0000-000000002452','00000000-0000-0000-0000-000000002451');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002451',true);
set local role authenticated;
select extensions.is((public.app_save_sharing_profile('whole-owner','secret',false)->>'sharing_enabled')::boolean,false,'credentials leave sharing off');
select extensions.is(public.app_save_principle(null,null,'첫 원칙','처음') ->> 'body','첫 원칙','owner saves first revision');
select extensions.is(public.app_save_principle(
  (public.app_list_principles() #>> '{items,0,principle_id}')::uuid,
  (public.app_list_principles() #>> '{items,0,id}')::bigint,'수정 원칙','변경 이유') ->> 'body',
  '수정 원칙','owner saves second revision');
select extensions.is(public.app_list_principles(null,'Asia/Seoul',false,null) #>> '{items,0,body}',
  '수정 원칙','owner web read uses an omitted owner id');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002452',true);
select extensions.throws_ok($$select public.app_list_principles(null,'Asia/Seoul',false,'00000000-0000-0000-0000-000000002451')$$,
  'P0001','Principles are not shared','OFF blocks linked friend');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002451',true);
select extensions.is((public.app_save_sharing_profile('whole-owner','',true)->>'sharing_enabled')::boolean,true,'owner opts into whole sharing');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002452',true);
select extensions.is(public.app_list_principles(null,'Asia/Seoul',false,'00000000-0000-0000-0000-000000002451') #>> '{items,0,body}',
  '수정 원칙','friend reads current document');
select extensions.is(jsonb_array_length(public.app_list_principle_changes(20,null,'00000000-0000-0000-0000-000000002451')->'items'),2,
  'friend reads both historical bodies');
select extensions.is(public.app_list_principle_changes(20,null,'00000000-0000-0000-0000-000000002451') #>> '{items,0,change_note}',
  '변경 이유','friend reads change note');
select extensions.is((select count(*) from public.principles),0::bigint,'direct RLS rows remain owner-only');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002453',true);
select extensions.throws_ok($$select public.app_list_principle_changes(20,null,'00000000-0000-0000-0000-000000002451')$$,
  'P0001','Principles are not shared','unrelated user cannot read history');
select * from extensions.finish();
rollback;
