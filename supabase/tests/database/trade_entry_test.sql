begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(16);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
 ('00000000-0000-0000-0000-000000000701','authenticated','authenticated','trade-owner@example.com','',now(),now(),now()),
 ('00000000-0000-0000-0000-000000000702','authenticated','authenticated','trade-other@example.com','',now(),now(),now());
set local role postgres;
insert into public.accounts (id,user_id,name) values (9701,'00000000-0000-0000-0000-000000000701','Trade Account');
insert into public.instruments (id,user_id,ticker,display_name,instrument_type,currency) values
 (9701,'00000000-0000-0000-0000-000000000701','TRADE','Trade Asset','market','KRW'),
 (9702,'00000000-0000-0000-0000-000000000701','CASHX','Cash Asset','cash','KRW');
insert into public.holdings (user_id,account_id,ticker,quantity,avg_price)
values ('00000000-0000-0000-0000-000000000701',9701,'TRADE',10,100);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000701',true);
set local role authenticated;

create temp table trade_test_data (buy_preview uuid, sell_preview uuid, stale_preview uuid, buy_key uuid) on commit drop;
grant select, insert, update on trade_test_data to authenticated;
insert into trade_test_data values (null,null,null,'70000000-0000-0000-0000-000000000001');

update trade_test_data set buy_preview = (public.app_preview_trade_entry(9701,9701,'buy',10,200,current_date)->>'preview_id')::uuid;
select extensions.is(
 (select after_quantity from public.trade_previews where id=(select buy_preview from trade_test_data)),
 20::numeric, 'buy preview adds quantity');
select extensions.is(
 (select after_cost_pool from public.trade_previews where id=(select buy_preview from trade_test_data)),
 3000::numeric, 'buy preview adds execution cost to the cost pool');
select extensions.is(
 public.app_log_completed_trade((select buy_preview from trade_test_data),(select buy_key from trade_test_data),'app') #>> '{holding,avg_price}',
 '150.0000000000000000', 'buy confirmation uses the execution-price weighted average');
select extensions.is((select ledger_quantity from public.holdings where account_id=9701 and ticker='TRADE'),20::numeric,'buy updates the holding projection');
select extensions.is(jsonb_array_length(public.app_list_transactions(50,null)),1,'confirmed trade is listed');
select extensions.is(
 public.app_log_completed_trade((select buy_preview from trade_test_data),(select buy_key from trade_test_data),'app') #>> '{holding,quantity}',
 '20.0000000000000000', 'identical confirmation retry returns the original result');
select extensions.is((select count(*) from public.trade_entries where user_id=auth.uid()),1::bigint,'retry does not duplicate a trade');

update trade_test_data set sell_preview = (public.app_preview_trade_entry(9701,9701,'sell',5,250,current_date)->>'preview_id')::uuid;
select extensions.is(
 public.app_log_completed_trade((select sell_preview from trade_test_data),'70000000-0000-0000-0000-000000000002','agent') #>> '{holding,avg_price}',
 '150.0000000000000000', 'partial sell preserves average cost');
select extensions.is((select ledger_quantity from public.holdings where account_id=9701 and ticker='TRADE'),15::numeric,'partial sell subtracts quantity');

select extensions.throws_ok(
 $$select public.app_preview_trade_entry(9701,9701,'sell',16,250,current_date)$$,
 'P0001','Trade would sell more than the current holding','oversell is rejected');
select extensions.throws_ok(
 $$select public.app_preview_trade_entry(9701,9702,'buy',1,1,current_date)$$,
 'P0001','Only market instruments support trade entries','non-market trade entry is rejected');

update trade_test_data set stale_preview = (public.app_preview_trade_entry(9701,9701,'buy',1,100,current_date)->>'preview_id')::uuid;
select * from public.app_save_holding(
  (select id from public.holdings where account_id=9701 and ticker='TRADE'),
  9701,'TRADE',16,140,null,'user','direct edit during trade preview'
);
select extensions.throws_ok(
 $$select public.app_log_completed_trade((select stale_preview from trade_test_data),'70000000-0000-0000-0000-000000000003','app')$$,
 'P0001','Trade preview is stale; create a new preview','direct holding edits stale an older preview');
select extensions.is((select state_version from public.holdings where account_id=9701 and ticker='TRADE'),4::bigint,'direct edit increments holding state version');

update trade_test_data set stale_preview = (public.app_preview_trade_entry(9701,9701,'buy',1,100,current_date)->>'preview_id')::uuid;
set local role postgres;
update public.trade_previews set expires_at=clock_timestamp()-interval '1 second' where id=(select stale_preview from trade_test_data);
set local role authenticated;
select extensions.throws_ok(
 $$select public.app_log_completed_trade((select stale_preview from trade_test_data),'70000000-0000-0000-0000-000000000004','app')$$,
 'P0001','Trade preview expired','expired preview is rejected');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000702',true);
select extensions.throws_ok(
 $$select public.app_preview_trade_entry(9701,9701,'buy',1,100,current_date)$$,
 'P0001','Account was not found or is not accessible','another user cannot preview the owner stream');
select extensions.is(jsonb_array_length(public.app_list_transactions(50,null)),0,'another user cannot list owner trades');

select * from extensions.finish();
rollback;
