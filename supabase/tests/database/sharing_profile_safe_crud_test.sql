begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(19);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,is_anonymous) values
('00000000-0000-0000-0000-000000003601','authenticated','authenticated','safe-owner@example.com','',now(),now(),now(),false),
('00000000-0000-0000-0000-000000003602','authenticated','authenticated','safe-friend@example.com','',now(),now(),now(),false);

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000003601',true);
set local role authenticated;
select extensions.ok(not has_function_privilege('authenticated','public.set_viewer_profile(text,text,boolean,text)','EXECUTE'),'raw row writer is revoked');
select extensions.ok(not has_column_privilege('authenticated','public.profiles','viewer_password_hash','SELECT'),'hash column cannot be read');
select extensions.ok(not has_table_privilege('authenticated','public.profiles','UPDATE'),'profile table cannot be updated directly');
select extensions.is(public.app_get_sharing_profile()->>'sharing_enabled','false','initial sharing is off');
select extensions.is(public.app_save_sharing_profile('safe-owner','secret',true)->>'public_name','safe-owner','save credentials and enable sharing');
select extensions.ok(not public.app_get_sharing_profile() ? 'viewer_password_hash','safe DTO excludes password hash');
select extensions.ok(not public.app_get_sharing_profile() ? 'viewer_password','safe DTO excludes password');
select extensions.is(public.app_set_profile_avatar('cherry'),'cherry','owner changes icon');
select extensions.is(public.app_get_sharing_profile()->>'avatar_key','cherry','safe read returns new icon');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000003602',true);
select extensions.is((select count(*) from public.add_friend('safe-owner','secret')),1::bigint,'friend connects with password');
select extensions.is((select count(*) from public.list_friends()),1::bigint,'friend lists connection');
select extensions.ok(public.can_view_owner('00000000-0000-0000-0000-000000003601'),'friend can read owner');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000003601',true);
select extensions.is(jsonb_array_length(public.app_list_portfolio_viewers()->'items'),1,'owner sees incoming friend');
select extensions.is(public.app_reset_sharing_profile()->>'sharing_enabled','false','reset disables sharing');
select extensions.is(public.app_get_sharing_profile()->>'public_name',null::text,'reset clears public name');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000003602',true);
select extensions.ok(not public.can_view_owner('00000000-0000-0000-0000-000000003601'),'old friend access is revoked');
select extensions.is((select count(*) from public.friendships where owner_user_id='00000000-0000-0000-0000-000000003601'),0::bigint,'reset removes incoming friendship');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000003602","is_anonymous":true}',true);
select extensions.throws_ok($$select public.app_set_profile_avatar('fox')$$,'P0001','Authentication required','anonymous session cannot edit avatar');
select extensions.throws_ok($$select public.add_friend('safe-owner','secret')$$,'P0001','Authentication required','anonymous session cannot create a friend relation');
select * from extensions.finish();
rollback;
