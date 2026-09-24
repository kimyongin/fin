begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(5);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values('00000000-0000-0000-0000-000000008901','authenticated','authenticated','private-note-retirement@example.com','',now(),now(),now());
set local role postgres;
insert into public.accounts(id,user_id,name) values(8901,'00000000-0000-0000-0000-000000008901','계좌');
insert into public.instruments(id,user_id,ticker,display_name,instrument_type,currency,note)
values(8901,'00000000-0000-0000-0000-000000008901','PRIV','Asset','market','KRW','공통 메모');
insert into public.holdings(id,user_id,account_id,ticker,quantity,avg_price,note)
values(8901,'00000000-0000-0000-0000-000000008901',8901,'PRIV',2,100,'퇴역 보유 메모');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000008901',true);
set local role authenticated;

select extensions.is((select count(*) from pg_proc where oid::regprocedure::text='app_list_private_holding_notes()'),0::bigint,'private note read RPC removed');
select extensions.is((select count(*) from pg_proc where oid::regprocedure::text='app_save_private_holding_note(bigint,bigint,text,text)'),0::bigint,'private note write RPC removed');
select extensions.ok(not (public.app_get_daily_context()::text like '%퇴역 비공개%'),'daily context excludes retired private notes');
select extensions.ok(public.app_get_daily_context()::text like '%공통 메모%','daily context retains the common instrument note');
select extensions.throws_ok($$select public.app_update_entity_note('holding',8901,'퇴역 보유 메모','새 메모','89011111-1111-4111-8111-111111111111','app')$$,
  'P0001','Invalid note entity type','generic note RPC rejects holding notes');

select * from extensions.finish();
rollback;
