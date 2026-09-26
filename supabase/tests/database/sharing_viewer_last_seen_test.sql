begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(17);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,is_anonymous) values
('00000000-0000-0000-0000-000000002501','authenticated','authenticated','seen-owner@example.com','',now(),now(),now(),false),
('00000000-0000-0000-0000-000000002502','authenticated','authenticated','seen-friend@example.com','',now(),now(),now(),false),
('00000000-0000-0000-0000-000000002503','authenticated','authenticated','seen-other@example.com','',now(),now(),now(),false),
('00000000-0000-0000-0000-000000002504','authenticated','authenticated','seen-guest@example.com','',now(),now(),now(),true);
insert into public.friendships(viewer_user_id,owner_user_id) values
('00000000-0000-0000-0000-000000002502','00000000-0000-0000-0000-000000002501'),
('00000000-0000-0000-0000-000000002504','00000000-0000-0000-0000-000000002501');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002501',true);
set local role authenticated;
select extensions.is((public.set_viewer_profile('seen-owner','secret',true,'portfolio_all')).sharing_enabled,true,'owner enables sharing');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002502',true);
select extensions.is((public.set_viewer_profile('seen-friend','',false,'portfolio_all')).public_name,'seen-friend','friend has public name');
select extensions.is((select last_viewed_at from public.friendships where viewer_user_id='00000000-0000-0000-0000-000000002502'),null::timestamptz,'new relation has no visit');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002501',true);
select extensions.is(jsonb_array_length(public.app_list_portfolio_viewers()->'items'),1,'owner list excludes anonymous friend');
select extensions.is(public.app_list_portfolio_viewers() #>> '{items,0,public_name}','seen-friend','owner sees only public name');
select extensions.ok(not (public.app_list_portfolio_viewers() #> '{items,0}') ? 'email','private identity is not returned');
select extensions.throws_ok($$select public.app_mark_shared_portfolio_view('00000000-0000-0000-0000-000000002501')$$,'P0001','Friend relationship required','owner cannot mark own view');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002503',true);
select extensions.is(jsonb_array_length(public.app_list_portfolio_viewers()->'items'),0,'other owner cannot list another owner viewers');
select extensions.throws_ok($$select public.app_mark_shared_portfolio_view('00000000-0000-0000-0000-000000002501')$$,'P0001','Shared friend not found','unrelated viewer cannot mark');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002502',true);
select extensions.ok(public.app_mark_shared_portfolio_view('00000000-0000-0000-0000-000000002501') is not null,'friend marks successful view');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002501',true);
select extensions.ok(public.app_list_portfolio_viewers() #>> '{items,0,last_viewed_at}' is not null,'owner sees last view');
select extensions.is((public.set_viewer_profile('seen-owner','',false,'portfolio_all')).sharing_enabled,false,'owner disables sharing');
select extensions.is(jsonb_array_length(public.app_list_portfolio_viewers()->'items'),1,'relationship stays listed while sharing off');
select extensions.ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='friendships' and cmd='UPDATE'),'RLS grants no direct friendship update');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002502',true);
select extensions.throws_ok($$select public.app_mark_shared_portfolio_view('00000000-0000-0000-0000-000000002501')$$,'P0001','Shared friend not found','sharing off blocks new view time');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000002504","is_anonymous":true}',true);
select extensions.throws_ok($$select public.app_mark_shared_portfolio_view('00000000-0000-0000-0000-000000002501')$$,'P0001','Authentication required','anonymous linked row still cannot mark');
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000002502',true);
select extensions.ok(public.remove_friend('00000000-0000-0000-0000-000000002501'),'friend removes relationship');
select * from extensions.finish();
rollback;
