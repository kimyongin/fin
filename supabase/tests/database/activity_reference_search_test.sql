begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(6);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000981','authenticated','authenticated','reference-search-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000000982','authenticated','authenticated','reference-search-other@example.com','',now(),now(),now());
set local role postgres;
insert into public.instruments(id,user_id,ticker,display_name,currency,instrument_type)
values (9981,'00000000-0000-0000-0000-000000000981','SEARCH','Search instrument','KRW','market'),
(9982,'00000000-0000-0000-0000-000000000982','OTHER','Search instrument other','KRW','market');
insert into public.portfolio_tasks(id,user_id,kind,title,subject,due_date,timezone,control_state,recurrence_kind)
values ('00000000-0000-0000-0000-000000009981','00000000-0000-0000-0000-000000000981','general','Search old task','{"kind":"portfolio"}',null,'Asia/Seoul','cancelled','none'),
('00000000-0000-0000-0000-000000009982','00000000-0000-0000-0000-000000000982','general','Search other task','{"kind":"portfolio"}',null,'Asia/Seoul','active','none');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000981',true);
set local role authenticated;
select extensions.is((public.app_search_activity_references('instrument','Search',0,20)->'items'->0->>'ticker'),'SEARCH','owned instrument is searchable without a holding');
select extensions.is(jsonb_array_length(public.app_search_activity_references('instrument','Search',0,20)->'items'),1,'other owner instrument is absent');
select extensions.is((public.app_search_activity_references('task','old',0,20)->'items'->0->>'title'),'Search old task','ended task remains searchable');
select extensions.is(jsonb_array_length(public.app_search_activity_references('task','Search',0,20)->'items'),1,'other owner task is absent');
select extensions.is(jsonb_array_length(public.app_search_activity_references('task','',0,20)->'items'),0,'empty query does not enumerate tasks');
select extensions.throws_ok($$select public.app_search_activity_references('holding','Search',0,20)$$,'P0001','Invalid reference search','unsupported kind rejected');
select * from extensions.finish();
rollback;
