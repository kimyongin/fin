begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(23);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000000801','authenticated','authenticated','correction-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000000802','authenticated','authenticated','correction-other@example.com','',now(),now(),now());
set local role postgres;
insert into public.accounts(id,user_id,name) values(9801,'00000000-0000-0000-0000-000000000801','Correction Account');
insert into public.instruments(id,user_id,ticker,display_name,instrument_type,currency) values
(9801,'00000000-0000-0000-0000-000000000801','INTM','Market','market','KRW'),
(9802,'00000000-0000-0000-0000-000000000801','INTV','Valuation','valuation','KRW'),
(9803,'00000000-0000-0000-0000-000000000801','KRW','Cash','cash','KRW');
insert into public.holdings(id,user_id,account_id,ticker,quantity,avg_price,purchase_amount,valuation_amount) values
(9801,'00000000-0000-0000-0000-000000000801',9801,'INTM',20,65000,null,null),
(9802,'00000000-0000-0000-0000-000000000801',9801,'INTV',null,null,1000,1200),
(9803,'00000000-0000-0000-0000-000000000801',9801,'KRW',null,null,null,500);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000801',true); set local role authenticated;
select extensions.is(public.app_preview_holding_reconciliation(9801,'{"quantity":"25","avg_price":"68000"}','실제값으로 맞춤',current_date)#>>'{after,quantity}','25','market correction estimates an absolute quantity');
select extensions.ok(to_regclass('public.holding_reconciliation_previews') is null,'estimate has no preview storage');
select extensions.is(public.app_apply_holding_correction(9801,'{"quantity":"25","avg_price":"68000"}','실제값으로 맞춤',current_date,1,'80000000-0000-0000-0000-000000000001','app')->>'holding_state_version','2','correction advances the holding version');
select extensions.is((select ledger_quantity from public.holdings where id=9801),25::numeric,'correction replaces current quantity');
select extensions.is(round((select ledger_cost_pool/ledger_quantity from public.holdings where id=9801)),68000::numeric,'correction replaces current average cost');
select extensions.ok(not (public.app_apply_holding_correction(9801,'{"quantity":"25","avg_price":"68000"}','실제값으로 맞춤',current_date,1,'80000000-0000-0000-0000-000000000001','app') ? 'verification_id'),'correction response has no verification status');
set local role postgres;
update public.holding_correction_mutation_receipts set
  request_payload=request_payload||'{"confirmed_fields":[]}'::jsonb,
  response_payload=response_payload||jsonb_build_object('verification_id',gen_random_uuid())
where idempotency_key='80000000-0000-0000-0000-000000000001';
set local role authenticated;
select extensions.ok(not (public.app_apply_holding_correction(9801,'{"quantity":"25","avg_price":"68000"}','실제값으로 맞춤',current_date,1,'80000000-0000-0000-0000-000000000001','app') ? 'verification_id'),'older correction retry returns its success without a retired field');
select extensions.is((select count(*) from public.activity_events where user_id=auth.uid() and action_type='reconcile_holding'),1::bigint,'retry does not duplicate correction activity');
select extensions.ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='holdings' and column_name='last_verification'),'verification checkpoint column is retired');
select extensions.throws_ok($$select public.app_apply_holding_correction(9801,'{"quantity":"26","avg_price":"68000"}','오래된 보정',current_date,1,'80000000-0000-0000-0000-000000000007','app')$$,'P0001','Holding version conflict','stale estimate cannot overwrite the current holding');
select extensions.throws_ok($$select public.app_apply_holding_correction(9801,'{"quantity":"26","avg_price":"68000"}','다른 입력',current_date,1,'80000000-0000-0000-0000-000000000001','app')$$,'P0001','Idempotency key was already used with a different request','same key cannot change the correction payload');
select extensions.is(public.app_preview_holding_reconciliation(9801,'{"quantity":"0","avg_price":"0"}','전량 매도 후 실제값',current_date)#>>'{after,quantity}','0','market correction accepts zero balance');
select extensions.throws_ok($$select public.app_preview_holding_reconciliation(9801,'{"quantity":"-1","avg_price":"1"}','음수 거부',current_date)$$,'P0001','Reconciliation values must be nonnegative decimal strings with at most 16 decimal places','negative values are rejected');
select extensions.throws_ok($$select public.app_preview_holding_reconciliation(9801,'{"quantity":"1"}','누락 거부',current_date)$$,'P0001','Market reconciliation requires quantity and avg_price','missing market average price is rejected');
select extensions.throws_ok($$select public.app_preview_holding_reconciliation(9801,'{"quantity":"1","avg_price":"1","extra":"1"}','추가 필드 거부',current_date)$$,'P0001','Reconciliation contains an unsupported field','unknown fields are rejected');
select extensions.throws_ok($$select public.app_preview_holding_reconciliation(9801,'{"quantity":1,"avg_price":"1"}','형식 거부',current_date)$$,'P0001','Reconciliation values must be nonnegative decimal strings with at most 16 decimal places','JSON numbers are rejected');
select extensions.throws_ok($$select public.app_preview_holding_reconciliation(9801,'{"quantity":"1.12345678901234567","avg_price":"1"}','정밀도 거부',current_date)$$,'P0001','Reconciliation values must be nonnegative decimal strings with at most 16 decimal places','excess precision is rejected');
select extensions.is(public.app_apply_holding_correction(9802,'{"purchase_amount":"1100","valuation_amount":"1300"}','평가액 보정',current_date,1,'80000000-0000-0000-0000-000000000004','app')#>>'{after,valuation_amount}','1300','valuation correction uses amount fields');
select extensions.is(public.app_apply_holding_correction(9803,'{"valuation_amount":"700"}','현금 잔액 보정',current_date,1,'80000000-0000-0000-0000-000000000005','app')#>>'{after,valuation_amount}','700','cash correction uses balance amount');
select extensions.ok(to_regprocedure('public.app_verify_holding(bigint,bigint,text[],date,text,uuid,text)') is null,'standalone verification API is retired');
select extensions.ok(to_regprocedure('public.app_get_portfolio_integrity()') is null,'verification summary API is retired');
select extensions.ok(to_regprocedure('public.app_get_holding_integrity(bigint)') is null,'holding verification detail API is retired');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000802',true);
select extensions.throws_ok($$select public.app_preview_holding_reconciliation(9801,'{"quantity":"1","avg_price":"1"}','타인 보정',current_date)$$,'P0001','Holding was not found or is not accessible','another user cannot reconcile owner holding');
select * from extensions.finish(); rollback;
