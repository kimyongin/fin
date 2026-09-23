begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(5);

select extensions.ok(to_regclass('public.todo_bundles') is null, 'legacy bundle storage is removed');
select extensions.ok(to_regclass('public.todo_items') is null, 'legacy item storage is removed');
select extensions.ok(to_regclass('public.todo_item_action_migrations') is null, 'temporary mapping storage is removed');
select extensions.ok(to_regprocedure('public.app_save_todo_bundle(uuid,integer,uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text)') is null,
    'legacy bundle write RPC is removed');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000000721','authenticated','authenticated','retired-todo-owner@example.com','',now(),now(),now());
insert into public.portfolio_tasks(id,user_id,kind,title,subject,timezone,control_state,research_state) values
('72000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000721','research','실적 발표 확인','{"kind":"portfolio"}','Asia/Seoul','active','open');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000721',true);
set local role authenticated;
select extensions.is(jsonb_array_length(public.app_get_daily_context('Asia/Seoul',null) -> 'open_tasks'),0,
    'retired research-task state is not projected into current pending work');

select * from extensions.finish();
rollback;
