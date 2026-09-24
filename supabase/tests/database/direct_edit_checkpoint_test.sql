begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(7);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values('00000000-0000-0000-0000-000000000901','authenticated','authenticated','edit-owner@example.com','',now(),now(),now());
set local role postgres;
insert into accounts(id,user_id,name) values(9901,'00000000-0000-0000-0000-000000000901','Edit account');
insert into instruments(id,user_id,ticker,display_name,currency,instrument_type) values
(9901,'00000000-0000-0000-0000-000000000901','EDIT','Market','KRW','market'),
(9902,'00000000-0000-0000-0000-000000000901','VALUE','Valuation','KRW','valuation');
insert into holdings(user_id,account_id,ticker,quantity,avg_price) values('00000000-0000-0000-0000-000000000901',9901,'EDIT',2,100);
insert into holdings(user_id,account_id,ticker,purchase_amount,valuation_amount) values('00000000-0000-0000-0000-000000000901',9901,'VALUE',1000,1200);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000901',true); set local role authenticated;

create temp table versions(market_before bigint, valuation_before bigint) on commit drop;
grant select,insert,update on versions to authenticated;
insert into versions select max(state_version) filter(where ticker='EDIT'),max(state_version) filter(where ticker='VALUE') from holdings;
select * from public.app_save_holding((select id from holdings where ticker='EDIT'),9901,'EDIT',2,100,'user','unchanged');
select extensions.is((select state_version from holdings where ticker='EDIT'),(select market_before from versions),'unchanged save does not create a checkpoint');
select * from public.app_save_holding((select id from holdings where ticker='EDIT'),9901,'EDIT',2,100,'user','unchanged again');
select extensions.is((select state_version from holdings where ticker='EDIT'),(select market_before from versions),'unchanged market save does not create a checkpoint');
select * from public.app_save_holding((select id from holdings where ticker='EDIT'),9901,'EDIT',3,110,'user','balance edit');
select extensions.is((select state_version from holdings where ticker='EDIT'),(select market_before+1 from versions),'market balance edit advances state version');
select extensions.is((select ledger_quantity from holdings where ticker='EDIT'),3::numeric,'market edit refreshes ledger quantity');
select * from public.app_bulk_save_portfolio_rows(jsonb_build_array(jsonb_build_object('account_name','Edit account','ticker','VALUE','display_name','Valuation','currency','KRW','instrument_type','valuation','purchase_amount',1000,'valuation_amount',1200)));
select extensions.is((select state_version from holdings where ticker='VALUE'),(select valuation_before from versions),'unchanged valuation does not create a checkpoint');
select * from public.app_bulk_save_portfolio_rows(jsonb_build_array(jsonb_build_object('account_name','Edit account','ticker','VALUE','display_name','Valuation','currency','KRW','instrument_type','valuation','purchase_amount',1000,'valuation_amount',1300)));
select extensions.is((select state_version from holdings where ticker='VALUE'),(select valuation_before+1 from versions),'valuation edit advances state version');
select extensions.ok((select ledger_checkpoint_at is not null from holdings where ticker='VALUE'),'valuation edit records checkpoint time');
select * from extensions.finish(); rollback;
