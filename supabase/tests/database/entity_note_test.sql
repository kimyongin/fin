begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(20);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001601','authenticated','authenticated','note-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000001602','authenticated','authenticated','note-other@example.com','',now(),now(),now());
set local role postgres;
insert into public.accounts(id,user_id,name,note) values(9961,'00000000-0000-0000-0000-000000001601','Note Account','기존 계좌');
insert into public.instruments(id,user_id,ticker,display_name,instrument_type,currency,note) values(9961,'00000000-0000-0000-0000-000000001601','NOTE','Note Asset','market','KRW','기존 종목');
insert into public.holdings(id,user_id,account_id,ticker,quantity,avg_price,note) values(9961,'00000000-0000-0000-0000-000000001601',9961,'NOTE',10,1000,'기존 보유');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001601',true); set local role authenticated;

select extensions.is(public.app_update_entity_note('account',9961,'기존 계좌','  새 계좌 메모  ','16111111-1111-4111-8111-111111111111','app')->>'note','새 계좌 메모','account note is normalized and updated');
select extensions.is(public.app_update_entity_note('instrument',9961,'기존 종목','새 종목 메모','16111111-1111-4111-8111-111111111112','agent')->>'note','새 종목 메모','instrument note is updated');
select extensions.is(public.app_update_entity_note('holding',9961,'기존 보유','새 보유 메모','16111111-1111-4111-8111-111111111113','app')->>'note','새 보유 메모','holding note is updated');
select extensions.is((select state_version from public.holdings where id=9961),1::bigint,'holding note update does not advance the financial state version');
select extensions.is(public.app_update_entity_note('holding',9961,'기존 보유','새 보유 메모','16111111-1111-4111-8111-111111111113','app')->>'note','새 보유 메모','identical retry returns the stored success');
select extensions.is((select count(*) from public.entity_note_mutation_receipts),3::bigint,'retry does not duplicate a receipt');
select extensions.is((select count(*) from public.activity_events where action_type='update_entity_note'),3::bigint,'retry does not duplicate activity');
select extensions.is(public.app_update_entity_note('account',9961,'새 계좌 메모','새 계좌 메모','16111111-1111-4111-8111-111111111118','app')->>'note','새 계좌 메모','unchanged note request succeeds');
select extensions.is((select count(*) from public.activity_events where action_type='update_entity_note'),3::bigint,'unchanged note does not create an action event');
select extensions.throws_ok($$select public.app_update_entity_note('holding',9961,'기존 보유','충돌','16111111-1111-4111-8111-111111111114','app')$$,'P0001','Entity note conflict','stale expected note is rejected');
select extensions.throws_ok($$select public.app_update_entity_note('holding',9961,'새 보유 메모','다른 요청','16111111-1111-4111-8111-111111111113','app')$$,'P0001','Idempotency key was already used with a different request','an idempotency key cannot be reused for another note');
select extensions.throws_ok($$select public.app_update_entity_note('holding',9961,'새 보유 메모',repeat('x',4001),'16111111-1111-4111-8111-111111111115','app')$$,'P0001','Entity note is too long','oversized notes are rejected');
select extensions.throws_ok($$select public.app_update_entity_note('portfolio',9961,null,'memo','16111111-1111-4111-8111-111111111116','app')$$,'P0001','Invalid note entity type','unknown entity types are rejected');
select extensions.is(public.app_get_portfolio_state(null)#>>'{accounts,0,note}','새 계좌 메모','portfolio state returns the updated account note');
select extensions.is((select note from public.app_find_holdings('NOTE') limit 1),'새 보유 메모','holding search returns the updated holding note');
select extensions.is(public.app_update_entity_note('holding',9961,'새 보유 메모',' ','16111111-1111-4111-8111-111111111117','app')->>'note',null,'blank input clears a note');
select extensions.lives_ok($$select public.app_verify_holding(9961,1,array['quantity'],current_date,'증권사 화면 확인','16111111-1111-4111-8111-111111111119','app')$$,'holding verification succeeds');
select extensions.is((select count(*) from public.activity_events where action_type='verify_holding'),1::bigint,'holding verification records an automatic event');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001602',true);
select extensions.throws_ok($$select public.app_update_entity_note('account',9961,'새 계좌 메모','침범','16222222-2222-4222-8222-222222222221','agent')$$,'P0001','Entity was not found or is not accessible','another user cannot update the note');
select extensions.is((select count(*) from public.entity_note_mutation_receipts),0::bigint,'RLS hides another user receipts');

select * from extensions.finish();
rollback;
