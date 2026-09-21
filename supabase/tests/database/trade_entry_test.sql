begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(25);

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

create temp table trade_test_data (buy_preview uuid, sell_preview uuid, stale_preview uuid, competing_preview uuid, buy_key uuid) on commit drop;
grant select, insert, update on trade_test_data to authenticated;
insert into trade_test_data values (null,null,null,null,'70000000-0000-0000-0000-000000000001');

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

update trade_test_data set
 stale_preview = (public.app_preview_trade_entry(9701,9701,'buy',1,100,current_date)->>'preview_id')::uuid,
 competing_preview = (public.app_preview_trade_entry(9701,9701,'buy',2,100,current_date)->>'preview_id')::uuid;
select extensions.is(
 public.app_log_completed_trade((select stale_preview from trade_test_data),'70000000-0000-0000-0000-000000000005','app') #>> '{holding,quantity}',
 '17.0000000000000000', 'the first of two previews updates the holding');
select extensions.throws_ok(
 $$select public.app_log_completed_trade((select competing_preview from trade_test_data),'70000000-0000-0000-0000-000000000006','app')$$,
 'P0001','Trade preview is stale; create a new preview','a competing preview cannot overwrite the first confirmation');
select extensions.is(
 (select count(*) from public.trade_entries where preview_id=(select competing_preview from trade_test_data)),
 0::bigint, 'the rejected competing preview creates no ledger row');

select extensions.is(
 jsonb_array_length(public.app_list_transaction_page(9701,9701,1,null)->'items'),
 1, 'transaction page filters before applying its limit');
select extensions.ok(
 public.app_list_transaction_page(9701,9701,1,null)->'next_cursor' is not null,
 'transaction page returns a cursor when more filtered rows exist');
select extensions.isnt(
 public.app_list_transaction_page(9701,9701,1,null)#>>'{items,0,id}',
 public.app_list_transaction_page(9701,9701,1,public.app_list_transaction_page(9701,9701,1,null)->'next_cursor')#>>'{items,0,id}',
 'the next transaction page does not repeat the previous row');
select extensions.is(
 jsonb_array_length(public.app_list_transaction_page(9701,999999,10,null)->'items'),
 0, 'an account filter with no matching trades returns an empty page');

set local role postgres;
insert into public.trade_previews(
 id,user_id,account_id,instrument_id,holding_id,holding_state_version,side,quantity,unit_price,
 executed_on,before_quantity,before_cost_pool,after_quantity,after_cost_pool,expires_at,created_at
)
select gen_random_uuid(),'00000000-0000-0000-0000-000000000701',9701,9701,holding.id,holding.state_version,
 'buy',1,999,current_date,holding.ledger_quantity,holding.ledger_cost_pool,
 holding.ledger_quantity+1,holding.ledger_cost_pool+999,now()+interval '1 hour',now()+g*interval '1 microsecond'
from public.holdings holding cross join generate_series(1,55) g
where holding.account_id=9701 and holding.ticker='TRADE';
insert into public.trade_entries(
 user_id,account_id,instrument_id,holding_id,preview_id,side,quantity,unit_price,executed_on,
 before_quantity,before_cost_pool,after_quantity,after_cost_pool,authored_via,created_at
)
select preview.user_id,preview.account_id,preview.instrument_id,preview.holding_id,preview.id,preview.side,
 preview.quantity,preview.unit_price,preview.executed_on,preview.before_quantity,preview.before_cost_pool,
 preview.after_quantity,preview.after_cost_pool,'app',preview.created_at
from public.trade_previews preview
where preview.user_id='00000000-0000-0000-0000-000000000701' and preview.unit_price=999;
set local role authenticated;
select extensions.is(
 jsonb_array_length(public.app_list_transaction_page(9701,9701,50,null)->'items'),
 50, 'a filtered transaction page reaches its requested limit when more than fifty rows exist');
select extensions.is(
 jsonb_array_length(public.app_list_transaction_page(9701,9701,50,public.app_list_transaction_page(9701,9701,50,null)->'next_cursor')->'items'),
 8, 'the next filtered page returns every remaining row without truncation');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000702',true);
select extensions.throws_ok(
 $$select public.app_preview_trade_entry(9701,9701,'buy',1,100,current_date)$$,
 'P0001','Account was not found or is not accessible','another user cannot preview the owner stream');
select extensions.is(jsonb_array_length(public.app_list_transactions(50,null)),0,'another user cannot list owner trades');

select * from extensions.finish();
rollback;
