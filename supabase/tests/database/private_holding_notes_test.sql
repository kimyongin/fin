begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(15);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000008901','authenticated','authenticated','private-note-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000008902','authenticated','authenticated','private-note-friend@example.com','',now(),now(),now());
set local role postgres;
insert into public.profiles(user_id,public_name,public_name_normalized,sharing_enabled)
values('00000000-0000-0000-0000-000000008901','private-note-owner','private-note-owner',true);
insert into public.friendships(viewer_user_id,owner_user_id)
values('00000000-0000-0000-0000-000000008902','00000000-0000-0000-0000-000000008901');
insert into public.accounts(id,user_id,name) values(8901,'00000000-0000-0000-0000-000000008901','계좌');
insert into public.instruments(id,user_id,ticker,display_name,instrument_type,currency,note)
values(8901,'00000000-0000-0000-0000-000000008901','PRIV','Private Asset','market','KRW','공개 종목 메모');
insert into public.holdings(id,user_id,account_id,ticker,quantity,avg_price,note)
values(8901,'00000000-0000-0000-0000-000000008901',8901,'PRIV',2,100,'공개 보유 메모');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000008901',true);
set local role authenticated;

select extensions.is(public.app_save_private_holding_note(8901,null,null,' 비공개 투자 이유 ')->>'note',
    '비공개 투자 이유','save an instrument-wide private reason');
select extensions.is(public.app_save_private_holding_note(8901,8901,null,'계좌별 이유')->>'note',
    '계좌별 이유','save an account-specific reason');
select extensions.is(jsonb_array_length(public.app_list_private_holding_notes()->'items'),2,
    'owner reads both private scopes');
select extensions.is((select state_version from public.holdings where id=8901),1::bigint,
    'note edit does not advance financial version');
select extensions.is(public.app_save_private_holding_note(8901,8901,null,'계좌별 이유')->>'note',
    '계좌별 이유','identical retry does not conflict');
select extensions.throws_ok(
    $$select public.app_save_private_holding_note(8901,8901,'오래된 값','새 값')$$,
    'P0001','Holding note changed; reload before saving','stale note is rejected');
select extensions.ok(not (public.app_get_portfolio_state(null)::text like '%비공개 투자 이유%'),
    'even the general portfolio DTO does not carry a private reason');
select extensions.is(public.app_get_portfolio_state(null)#>>'{holdings,0,note}',
    '공개 보유 메모','the existing public note is preserved');

set local role postgres;
update public.holdings set last_verification='{"note":"증권사 비공개 확인","holding_state_version":1}'::jsonb where id=8901;
insert into public.activity_events(user_id,source,action_type,target_table,before_data,after_data,status)
values('00000000-0000-0000-0000-000000008901','user','test_note_redaction','holdings',
    '{"private_note":"secret"}'::jsonb,'{"holding":{"private_note":"secret","last_verification":{"note":"secret"},"quantity":2}}'::jsonb,'succeeded');
set local role authenticated;
select extensions.ok(not exists(select 1 from public.activity_events
    where user_id=auth.uid() and (before_data::text like '%secret%' or after_data::text like '%secret%')),
    'automatic activity payloads remove private fields recursively');
select extensions.ok(not (public.app_get_portfolio_state(null)::text like '%증권사 비공개 확인%'),
    'owner general portfolio DTO also excludes the private brokerage comparison');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000008902',true);
select extensions.is(public.app_list_private_holding_notes()->'items','[]'::jsonb,
    'friend cannot list owner private notes');
select extensions.ok(not (public.app_get_portfolio_state('00000000-0000-0000-0000-000000008901')::text like '%비공개 투자 이유%'),
    'friend portfolio response excludes private reasons');
select extensions.ok(not (public.app_get_portfolio_state('00000000-0000-0000-0000-000000008901')::text like '%증권사 비공개 확인%'),
    'friend portfolio response excludes private verification details');
select extensions.is(public.app_get_portfolio_state('00000000-0000-0000-0000-000000008901')#>>'{holdings,0,note}',
    '공개 보유 메모','friend still sees previously shared public note');
select extensions.throws_ok(
    $$select public.app_save_private_holding_note(8901,null,null,'친구가 덮어씀')$$,
    'P0001','Instrument was not found','friend cannot edit owner note');

select * from extensions.finish();
rollback;
