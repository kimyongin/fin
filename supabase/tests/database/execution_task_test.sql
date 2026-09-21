begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(16);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000801','authenticated','authenticated','execution-owner@example.com','',now(),now(),now());
set local role postgres;
insert into public.accounts(id,user_id,name) values(9801,'00000000-0000-0000-0000-000000000801','Broker');
insert into public.instruments(id,user_id,ticker,display_name,currency,instrument_type)
values(9801,'00000000-0000-0000-0000-000000000801','PLAN','Plan asset','KRW','market');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000801',true);
set local role authenticated;

select extensions.is((public.app_save_execution_task(null,'11111111-1111-4111-8111-111111111111',jsonb_build_object(
  'title','10주 매수','account_id',9801,'instrument_id',9801,'side','buy','target_quantity','10','timezone','Asia/Seoul','authored_via','agent')) ->> 'kind'),'execution','creates an execution task');
select extensions.is((public.app_get_portfolio_task((select id from portfolio_tasks where title='10주 매수')) #>> '{execution_plan,progress}'),'planned','starts planned');

select extensions.lives_ok($$select public.app_log_completed_trade((public.app_preview_trade_entry(9801,9801,'buy',6,100,current_date)->>'preview_id')::uuid,'22222222-2222-4222-8222-222222222222','agent')$$,'records first fill');
select extensions.lives_ok($$select public.app_link_trade_to_task((select id from trade_entries order by sequence_no desc limit 1),(select id from portfolio_tasks where title='10주 매수'),1,'33333333-3333-4333-8333-333333333333','agent')$$,'links first fill');
select extensions.is((public.app_execution_plan_summary((select id from portfolio_tasks where title='10주 매수'))->>'progress'),'partial','six of ten is partial');
select extensions.is((public.app_execution_plan_summary((select id from portfolio_tasks where title='10주 매수'))->>'filled_quantity')::numeric,6::numeric,'reports six filled');

select extensions.lives_ok($$select public.app_log_completed_trade((public.app_preview_trade_entry(9801,9801,'buy',4,110,current_date)->>'preview_id')::uuid,'44444444-4444-4444-8444-444444444444','agent')$$,'records second fill');
select extensions.lives_ok($$select public.app_link_trade_to_task((select id from trade_entries order by sequence_no desc limit 1),(select id from portfolio_tasks where title='10주 매수'),1,'55555555-5555-4555-8555-555555555555','agent')$$,'links second fill');
select extensions.is((public.app_execution_plan_summary((select id from portfolio_tasks where title='10주 매수'))->>'progress'),'completed','ten of ten is complete');
select extensions.throws_ok($$select public.app_link_trade_to_task((select id from trade_entries order by sequence_no desc limit 1),(select id from portfolio_tasks where title='10주 매수'),1,'66666666-6666-4666-8666-666666666666','agent')$$,'23505',null,'one fill cannot be linked twice');
select extensions.is((select count(*) from trade_entries),2::bigint,'task operations never create trades');
select extensions.is((select ledger_quantity from holdings where ticker='PLAN'),10::numeric,'only fills change the holding');
select extensions.is((public.app_transition_execution_task((select id from portfolio_tasks where title='10주 매수'),1,'pause','사용자 요청으로 잠시 보류','77777777-7777-4777-8777-777777777777','agent')->>'control_state'),'paused','execution plan can be paused');
select extensions.is((select ledger_quantity from holdings where ticker='PLAN'),10::numeric,'pausing a plan does not change holdings');
select extensions.lives_ok($$select public.app_reverse_trade_entry((public.app_preview_trade_reversal((select id from trade_entries order by sequence_no desc limit 1),'잘못 기록한 두 번째 체결')->>'preview_id')::uuid,'88888888-8888-4888-8888-888888888888','agent')$$,'reverses a linked fill');
select extensions.is((public.app_execution_plan_summary((select id from portfolio_tasks where title='10주 매수'))->>'progress'),'partial','reversing a fill recalculates progress');
select * from extensions.finish();
rollback;
