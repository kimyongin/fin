begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(26);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000000701','authenticated','authenticated','trade-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000000702','authenticated','authenticated','trade-other@example.com','',now(),now(),now());
set local role postgres;
insert into public.accounts(id,user_id,name) values(9701,'00000000-0000-0000-0000-000000000701','Trade Account');
insert into public.instruments(id,user_id,ticker,display_name,instrument_type,currency) values
(9701,'00000000-0000-0000-0000-000000000701','TRADE','Trade Asset','market','KRW'),
(9702,'00000000-0000-0000-0000-000000000701','CASHX','Cash Asset','cash','KRW'),
(9703,'00000000-0000-0000-0000-000000000701','NEWTRADE','New Trade Asset','market','KRW');
insert into public.holdings(user_id,account_id,ticker,quantity,avg_price)
values('00000000-0000-0000-0000-000000000701',9701,'TRADE',10,100);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000701',true);
set local role authenticated;

select extensions.is(public.app_preview_trade_entry(9701,9701,'buy',10,200,current_date)#>>'{after,quantity}',
  '20.0000000000000000','unsaved estimate adds purchased quantity');
select extensions.is(public.app_preview_trade_entry(9701,9701,'buy',10,200,current_date)#>>'{after,avg_price}',
  '150.0000000000000000','estimate uses execution-price weighted average');
select extensions.hasnt_table('public','trade_previews','estimates have no persisted preview table');
select extensions.is(public.app_preview_trade_entry(9701,9701,'buy',10,200,current_date)->>'holding_state_version',
  '1','estimate exposes the current holding version');

select extensions.is(public.app_record_completed_trade(9701,9701,'buy',10,200,current_date,
  (select id from public.holdings where ticker='TRADE'),1,
  '70000000-0000-0000-0000-000000000001','app')#>>'{holding,avg_price}',
  '150.0000000000000000','server recomputes and records a weighted average');
select extensions.is((select ledger_quantity from public.holdings where ticker='TRADE'),20::numeric,
  'recorded buy updates current holding');
select extensions.is(jsonb_array_length(public.app_list_transactions(50,null)),1,
  'recorded buy remains available in transaction history');
select extensions.is(public.app_record_completed_trade(9701,9701,'buy',10,200,current_date,
  (select id from public.holdings where ticker='TRADE'),1,
  '70000000-0000-0000-0000-000000000001','app')#>>'{holding,quantity}',
  '20.0000000000000000','lost response retry returns the original success');
select extensions.is((select count(*) from public.activity_events where user_id=auth.uid() and action_type='log_completed_trade'),1::bigint,
  'retry does not duplicate a trade activity');
select extensions.is((select count(*) from public.activity_events where user_id=auth.uid() and action_type='log_completed_trade'),1::bigint,
  'retry does not duplicate the automatic activity');

select extensions.is(public.app_record_completed_trade(9701,9701,'sell',5,250,current_date,
  (select id from public.holdings where ticker='TRADE'),2,
  '70000000-0000-0000-0000-000000000002','agent')#>>'{holding,avg_price}',
  '150.0000000000000000','partial sale preserves average cost');
select extensions.is((select ledger_quantity from public.holdings where ticker='TRADE'),15::numeric,
  'partial sale reduces current quantity');
select extensions.throws_ok($$select public.app_preview_trade_entry(9701,9701,'sell',16,250,current_date)$$,
  'P0001','Trade would sell more than the current holding','unsaved estimate blocks oversell');
select extensions.throws_ok($$select public.app_record_completed_trade(9701,9701,'sell',16,250,current_date,
  (select id from public.holdings where ticker='TRADE'),3,'70000000-0000-0000-0000-000000000003','app')$$,
  'P0001','Trade would sell more than the current holding','locked write also blocks oversell');
select extensions.throws_ok($$select public.app_record_completed_trade(9701,9701,'buy',1,10,current_date,
  (select id from public.holdings where ticker='TRADE'),2,'70000000-0000-0000-0000-000000000004','app')$$,
  'P0001','Trade estimate is stale; calculate it again','concurrent holding edit invalidates estimate');
select extensions.throws_ok($$select public.app_record_completed_trade(9701,9701,'buy',11,200,current_date,
  (select id from public.holdings where ticker='TRADE'),1,'70000000-0000-0000-0000-000000000001','app')$$,
  'P0001','Idempotency key was already used with a different request','same key cannot represent a different trade');
select extensions.throws_ok($$select public.app_preview_trade_entry(9701,9702,'buy',1,100,current_date)$$,
  'P0001','Only market instruments support trade entries','cash assets are not market trades');

select extensions.is(public.app_preview_trade_entry(9701,9703,'buy',2,40,current_date)->>'holding_state_version',
  '0','first purchase estimates against an absent holding');
select extensions.is(public.app_record_completed_trade(9701,9703,'buy',2,40,current_date,null,0,
  '70000000-0000-0000-0000-000000000005','app')#>>'{holding,avg_price}',
  '40.0000000000000000','first purchase creates the current holding');
select extensions.hasnt_function('public','app_log_completed_trade',array['uuid','uuid','text'],
  'old preview-id confirmer is retired');
select extensions.ok((select body like '매수 2주%' from public.activity_events where action_type='log_completed_trade' and instrument_id=9703),
  'automatic trade stores a readable execution-time body');
select extensions.is(jsonb_array_length(public.app_list_transaction_page(9703,9701,10,null)->'items'),1,
  'transaction page applies account and instrument filters');
select extensions.hasnt_table('public','trade_entries','parallel trade ledger is retired');
select extensions.is((select target_table from public.activity_events where action_type='log_completed_trade' and instrument_id=9703),
  'holdings','new trade activity refers to the current holding');
select extensions.ok(public.app_list_transaction_page(null,9701,1,null)->'next_cursor' is not null,
  'activity-backed transaction page offers a stable cursor');
select extensions.isnt(
  public.app_list_transaction_page(null,9701,1,null)#>>'{items,0,id}',
  public.app_list_transaction_page(null,9701,1,public.app_list_transaction_page(null,9701,1,null)->'next_cursor')#>>'{items,0,id}',
  'second cursor page does not repeat the first trade');

select * from extensions.finish();
rollback;
