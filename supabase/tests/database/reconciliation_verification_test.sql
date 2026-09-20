begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(14);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000000801','authenticated','authenticated','integrity-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000000802','authenticated','authenticated','integrity-other@example.com','',now(),now(),now());
set local role postgres;
insert into public.accounts(id,user_id,name) values(9801,'00000000-0000-0000-0000-000000000801','Integrity Account');
insert into public.instruments(id,user_id,ticker,display_name,instrument_type,currency) values
(9801,'00000000-0000-0000-0000-000000000801','INTM','Market','market','KRW'),
(9802,'00000000-0000-0000-0000-000000000801','INTV','Valuation','valuation','KRW'),
(9803,'00000000-0000-0000-0000-000000000801','KRW','Cash','cash','KRW');
insert into public.holdings(id,user_id,account_id,ticker,quantity,avg_price,purchase_amount,valuation_amount) values
(9801,'00000000-0000-0000-0000-000000000801',9801,'INTM',20,65000,null,null),
(9802,'00000000-0000-0000-0000-000000000801',9801,'INTV',null,null,1000,1200),
(9803,'00000000-0000-0000-0000-000000000801',9801,'KRW',null,null,null,500);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000801',true); set local role authenticated;
create temp table integrity_data(preview uuid,key uuid) on commit drop; grant select,update,insert on integrity_data to authenticated; insert into integrity_data values(null,'80000000-0000-0000-0000-000000000001');
update integrity_data set preview=(public.app_preview_holding_reconciliation(9801,'{"quantity":"25","avg_price":"68000"}','증권사 실제값으로 맞춤',current_date,array['quantity','avg_price'])->>'preview_id')::uuid;
select extensions.is((select after_snapshot->>'quantity' from public.holding_reconciliation_previews where id=(select preview from integrity_data)),'25','market reconciliation previews an absolute quantity');
select extensions.is(public.app_reconcile_holding((select preview from integrity_data),(select key from integrity_data),'app')->>'holding_state_version','2','reconciliation advances the holding version');
select extensions.is((select ledger_quantity from public.holdings where id=9801),25::numeric,'reconciliation replaces current quantity');
select extensions.is(round((select ledger_cost_pool/ledger_quantity from public.holdings where id=9801)),68000::numeric,'reconciliation replaces current average cost');
select extensions.is((public.app_get_holding_integrity(9801)#>>'{last_verification,changed_since}')::boolean,false,'confirmed reconciliation records a current verification');
select extensions.is(public.app_reconcile_holding((select preview from integrity_data),(select key from integrity_data),'app')->>'holding_state_version','2','identical reconciliation retry is idempotent');
select extensions.is((select count(*) from public.holding_reconciliations where user_id=auth.uid()),1::bigint,'retry does not duplicate reconciliation');

select extensions.is(public.app_verify_holding(9801,2,array['quantity'],current_date,'수량만 확인','80000000-0000-0000-0000-000000000002','app')#>>'{verified_fields,0}','quantity','one field can be verified without claiming the average');
select * from public.app_save_holding(9801,9801,'INTM',26,68000,null,'user','change after verification');
select extensions.is((public.app_get_holding_integrity(9801)#>>'{last_verification,changed_since}')::boolean,true,'later holding change marks verification as changed since');
select extensions.throws_ok($$select public.app_verify_holding(9801,2,array['quantity'],current_date,null,'80000000-0000-0000-0000-000000000003','agent')$$,'P0001','Holding version conflict','stale verification is rejected');

update integrity_data set preview=(public.app_preview_holding_reconciliation(9802,'{"purchase_amount":"1100","valuation_amount":"1300"}','평가액 보정',current_date,'{}')->>'preview_id')::uuid,key='80000000-0000-0000-0000-000000000004';
select extensions.is(public.app_reconcile_holding((select preview from integrity_data),(select key from integrity_data),'app')#>>'{after,valuation_amount}','1300','valuation holding reconciliation uses amount fields');
update integrity_data set preview=(public.app_preview_holding_reconciliation(9803,'{"valuation_amount":"700"}','현금 잔액 보정',current_date,'{}')->>'preview_id')::uuid,key='80000000-0000-0000-0000-000000000005';
select extensions.is(public.app_reconcile_holding((select preview from integrity_data),(select key from integrity_data),'app')#>>'{after,valuation_amount}','700','cash reconciliation uses balance amount');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000802',true);
select extensions.throws_ok($$select public.app_preview_holding_reconciliation(9801,'{"quantity":"1","avg_price":"1"}','타인 보정',current_date,'{}')$$,'P0001','Holding was not found or is not accessible','another user cannot reconcile owner holding');
select extensions.ok(public.app_get_holding_integrity(9801) is null,'another user cannot read owner verification');
select * from extensions.finish(); rollback;
