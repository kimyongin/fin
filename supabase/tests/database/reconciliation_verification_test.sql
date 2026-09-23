begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(30);
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
select extensions.is(public.app_preview_holding_reconciliation(9801,'{"quantity":"25","avg_price":"68000"}','증권사 실제값으로 맞춤',current_date,array['quantity','avg_price'])#>>'{after,quantity}','25','market correction estimates an absolute quantity');
select extensions.is((select count(*) from public.holding_reconciliation_previews),0::bigint,'estimate does not persist a preview row');
select extensions.is(public.app_apply_holding_correction(9801,'{"quantity":"25","avg_price":"68000"}','증권사 실제값으로 맞춤',current_date,array['quantity','avg_price'],1,'80000000-0000-0000-0000-000000000001','app')->>'holding_state_version','2','correction advances the holding version');
select extensions.is((select ledger_quantity from public.holdings where id=9801),25::numeric,'reconciliation replaces current quantity');
select extensions.is(round((select ledger_cost_pool/ledger_quantity from public.holdings where id=9801)),68000::numeric,'reconciliation replaces current average cost');
select extensions.is((public.app_get_holding_integrity(9801)#>>'{last_verification,changed_since}')::boolean,false,'confirmed reconciliation records a current verification');
select extensions.is(public.app_apply_holding_correction(9801,'{"quantity":"25","avg_price":"68000"}','증권사 실제값으로 맞춤',current_date,array['quantity','avg_price'],1,'80000000-0000-0000-0000-000000000001','app')->>'holding_state_version','2','identical correction retry is idempotent');
select extensions.is((select count(*) from public.activity_events where user_id=auth.uid() and action_type='reconcile_holding'),1::bigint,'retry does not duplicate correction activity');
select extensions.throws_ok($$select public.app_apply_holding_correction(9801,'{"quantity":"26","avg_price":"68000"}','오래된 보정',current_date,'{}',1,'80000000-0000-0000-0000-000000000007','app')$$,'P0001','Holding version conflict','stale estimate cannot overwrite the current holding');
select extensions.throws_ok($$select public.app_apply_holding_correction(9801,'{"quantity":"26","avg_price":"68000"}','다른 입력',current_date,'{}',1,'80000000-0000-0000-0000-000000000001','app')$$,'P0001','Idempotency key was already used with a different request','same key cannot change the correction payload');
select extensions.is(public.app_preview_holding_reconciliation(9801,'{"quantity":"0","avg_price":"0"}','전량 매도 후 실제값',current_date,'{}')#>>'{after,quantity}','0','market reconciliation accepts an explicit zero balance');
select extensions.throws_ok($$select public.app_preview_holding_reconciliation(9801,'{"quantity":"-1","avg_price":"1"}','음수 거부',current_date,'{}')$$,'P0001','Reconciliation values must be nonnegative decimal strings with at most 16 decimal places','negative reconciliation values are rejected');
select extensions.throws_ok($$select public.app_preview_holding_reconciliation(9801,'{"quantity":"1"}','누락 거부',current_date,'{}')$$,'P0001','Market reconciliation requires quantity and avg_price','missing market average price is rejected');
select extensions.throws_ok($$select public.app_preview_holding_reconciliation(9801,'{"quantity":"1","avg_price":"1","extra":"1"}','추가 필드 거부',current_date,'{}')$$,'P0001','Reconciliation contains an unsupported field','unknown reconciliation fields are rejected');
select extensions.throws_ok($$select public.app_preview_holding_reconciliation(9801,'{"quantity":1,"avg_price":"1"}','형식 거부',current_date,'{}')$$,'P0001','Reconciliation values must be nonnegative decimal strings with at most 16 decimal places','JSON numbers are not accepted as precision-safe corrections');
select extensions.throws_ok($$select public.app_preview_holding_reconciliation(9801,'{"quantity":"1.12345678901234567","avg_price":"1"}','정밀도 거부',current_date,'{}')$$,'P0001','Reconciliation values must be nonnegative decimal strings with at most 16 decimal places','correction decimals do not silently round');

select extensions.is(public.app_verify_holding(9801,2,array['quantity'],current_date,'수량만 확인','80000000-0000-0000-0000-000000000002','app')#>>'{verified_fields,0}','quantity','one field can be verified without claiming the average');
select extensions.is(public.app_verify_holding(9801,2,array['quantity'],current_date,'수량만 확인','80000000-0000-0000-0000-000000000002','app')->>'note','수량만 확인','verification save returns its note');
select extensions.is(public.app_verify_holding(9801,2,array['quantity'],current_date,'수량만 확인','80000000-0000-0000-0000-000000000002','app')->>'source','app','verification save returns its source');
select extensions.is(public.app_get_holding_integrity(9801)#>>'{last_verification,note}','수량만 확인','integrity read returns the latest note');
select extensions.is(public.app_get_holding_integrity(9801)#>>'{last_verification,source}','app','integrity read returns the latest source');
select * from public.app_save_holding(9801,9801,'INTM',26,68000,null,'user','change after verification');
select extensions.is((public.app_get_holding_integrity(9801)#>>'{last_verification,changed_since}')::boolean,true,'later holding change marks verification as changed since');
select extensions.is(public.app_verify_holding(9801,2,array['quantity'],current_date,'수량만 확인','80000000-0000-0000-0000-000000000002','app')->>'holding_state_version','2','lost verification response retry returns the original success after a later holding change');
select extensions.is((select count(*) from public.holding_verifications where user_id=auth.uid() and holding_id=9801),2::bigint,'lost response retry does not duplicate the verification');
select extensions.throws_ok($$select public.app_verify_holding(9801,2,array['quantity'],current_date,null,'80000000-0000-0000-0000-000000000003','agent')$$,'P0001','Holding version conflict','stale verification is rejected');

set local role postgres;
insert into public.holding_integrity_mutation_receipts(user_id,idempotency_key,operation,request_payload,response_payload)
values(auth.uid(),'80000000-0000-0000-0000-000000000006','verify',jsonb_build_object('holding_id',9801,'expected_version',2,'fields',array['quantity'],'verified_on',current_date,'note','과거 응답','source','app'),jsonb_build_object('holding_id',9801,'holding_state_version',2));
set local role authenticated;
select extensions.ok(not (public.app_verify_holding(9801,2,array['quantity'],current_date,'과거 응답','80000000-0000-0000-0000-000000000006','app') ? 'note'),'an old receipt without note remains a valid retry response');

select extensions.is(public.app_apply_holding_correction(9802,'{"purchase_amount":"1100","valuation_amount":"1300"}','평가액 보정',current_date,'{}',1,'80000000-0000-0000-0000-000000000004','app')#>>'{after,valuation_amount}','1300','valuation holding correction uses amount fields');
select extensions.is(public.app_apply_holding_correction(9803,'{"valuation_amount":"700"}','현금 잔액 보정',current_date,'{}',1,'80000000-0000-0000-0000-000000000005','app')#>>'{after,valuation_amount}','700','cash correction uses balance amount');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000802',true);
select extensions.throws_ok($$select public.app_preview_holding_reconciliation(9801,'{"quantity":"1","avg_price":"1"}','타인 보정',current_date,'{}')$$,'P0001','Holding was not found or is not accessible','another user cannot reconcile owner holding');
select extensions.ok(public.app_get_holding_integrity(9801) is null,'another user cannot read owner verification');
select * from extensions.finish(); rollback;
