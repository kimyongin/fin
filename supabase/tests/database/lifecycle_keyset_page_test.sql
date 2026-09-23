begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(12);

insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-000000001401', 'authenticated', 'authenticated', 'lifecycle-page@example.com', '', now(), now(), now());

set local role postgres;
insert into public.accounts(id, user_id, name) values (9941, '00000000-0000-0000-0000-000000001401', 'Lifecycle');
insert into public.instruments(id, user_id, ticker, display_name, currency, instrument_type)
values (9941, '00000000-0000-0000-0000-000000001401', 'PAGE', 'Page asset', 'KRW', 'market');
insert into public.holdings(id, user_id, account_id, ticker, quantity, avg_price)
values (9941, '00000000-0000-0000-0000-000000001401', 9941, 'PAGE', 10, 100);

insert into public.portfolio_tasks(id, user_id, kind, title, subject, timezone, control_state, research_state, created_at, updated_at)
select ('14000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid,
       '00000000-0000-0000-0000-000000001401', 'research', 'Active ' || value,
       '{"kind":"portfolio"}'::jsonb, 'Asia/Seoul', 'active', case when value % 2 = 0 then 'waiting' else 'open' end,
       now() - interval '2 days', now() - interval '1 day'
from generate_series(1, 55) value;

insert into public.portfolio_tasks(id, user_id, kind, title, subject, timezone, control_state, research_state, created_at, updated_at)
select ('24000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid,
       '00000000-0000-0000-0000-000000001401', 'research', 'Closed ' || value,
       '{"kind":"portfolio"}'::jsonb, 'Asia/Seoul', 'active', 'resolved', now() - interval '1 day', now()
from generate_series(1, 30) value;

insert into public.portfolio_tasks(id, user_id, kind, title, subject, timezone, control_state, research_state, updated_at)
values
  ('34000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001401', 'research', 'Paused item', '{"kind":"portfolio"}', 'Asia/Seoul', 'paused', 'open', now()),
  ('34000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001401', 'execution', 'Planned execution', '{"kind":"position"}', 'Asia/Seoul', 'active', null, now() - interval '1 day'),
  ('34000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001401', 'execution', 'Partial execution', '{"kind":"position"}', 'Asia/Seoul', 'active', null, now() - interval '1 day');

insert into public.execution_plans(task_id, user_id, account_id, instrument_id, side, target_quantity)
values
  ('34000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001401', 9941, 9941, 'buy', 10),
  ('34000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000001401', 9941, 9941, 'buy', 10);

insert into public.trade_previews(id, user_id, account_id, instrument_id, holding_id, holding_state_version, side, quantity, unit_price, executed_on, before_quantity, before_cost_pool, after_quantity, after_cost_pool, expires_at, consumed_at)
values ('44000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000001401', 9941, 9941, 9941, 1, 'buy', 3, 100, current_date, 10, 1000, 13, 1300, now() + interval '1 hour', now());
insert into public.trade_entries(id, user_id, account_id, instrument_id, holding_id, preview_id, side, quantity, unit_price, executed_on, before_quantity, before_cost_pool, after_quantity, after_cost_pool, authored_via)
values ('44000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000001401', 9941, 9941, 9941, '44000000-0000-0000-0000-000000000001', 'buy', 3, 100, current_date, 10, 1000, 13, 1300, 'app');
insert into public.task_fill_links(user_id, task_id, trade_entry_id)
values ('00000000-0000-0000-0000-000000001401', '34000000-0000-0000-0000-000000000003', '44000000-0000-0000-0000-000000000002');

insert into public.investment_decisions(id, user_id, status, subject, question, options, authored_via, created_at, updated_at)
select ('54000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid,
       '00000000-0000-0000-0000-000000001401', 'proposed', '{"kind":"portfolio"}'::jsonb,
       'Current decision ' || value, '["keep"]'::jsonb, 'app', now() - interval '2 days', now() - interval '1 day'
from generate_series(1, 55) value;
insert into public.investment_decisions(id, user_id, status, subject, question, options, authored_via, created_at, updated_at)
select ('64000000-0000-0000-0000-' || lpad(value::text, 12, '0'))::uuid,
       '00000000-0000-0000-0000-000000001401', 'dismissed', '{"kind":"portfolio"}'::jsonb,
       'Closed decision ' || value, '["keep"]'::jsonb, 'app', now() - interval '1 day', now()
from generate_series(1, 30) value;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000001401', true);
set local role authenticated;

create temporary table task_page_results(page_no integer primary key, payload jsonb);
insert into task_page_results values (1, public.app_list_portfolio_task_page(null, 'active', 50, null));
insert into task_page_results
select 2, public.app_list_portfolio_task_page(null, 'active', 50, payload->'next_cursor')
from task_page_results where page_no = 1;

create temporary table decision_page_results(page_no integer primary key, payload jsonb);
insert into decision_page_results values (1, public.app_list_investment_decision_page(null, 'current', 50, null));
insert into decision_page_results
select 2, public.app_list_investment_decision_page(null, 'current', 50, payload->'next_cursor')
from decision_page_results where page_no = 1;

select extensions.is(jsonb_array_length((select payload->'items' from task_page_results where page_no = 1)), 50, 'active task page is filled before closed tasks are considered');
select extensions.ok((select payload->'next_cursor' is not null from task_page_results where page_no = 1), 'active task page returns a stable cursor');
select extensions.is((select count(*)::integer from task_page_results, jsonb_array_elements(payload->'items') item where page_no = 1 and item->>'title' like 'Closed%'), 0, 'newer completed tasks never displace active work');

select extensions.is((select count(distinct item->>'id')::integer from task_page_results, jsonb_array_elements(payload->'items') item), 57, 'same-timestamp active tasks paginate without gaps or duplicates');

select extensions.is((select item->'execution_plan'->>'progress' from jsonb_array_elements(public.app_list_portfolio_task_page(null, 'active', 50, null)->'items') item where item->>'title' = 'Planned execution'), 'planned', 'planned execution remains active');
select extensions.is((select item->'execution_plan'->>'progress' from jsonb_array_elements(public.app_list_portfolio_task_page(null, 'active', 50, null)->'items') item where item->>'title' = 'Partial execution'), 'partial', 'partial execution remains active');
select extensions.is(jsonb_array_length(public.app_list_portfolio_task_page(null, 'paused', 20, null)->'items'), 1, 'paused work has a separate filter');
select extensions.is(jsonb_array_length(public.app_list_portfolio_task_page(null, 'closed', 50, null)->'items'), 30, 'closed research work has a separate filter');

select extensions.is(jsonb_array_length((select payload->'items' from decision_page_results where page_no = 1)), 50, 'current decision page excludes newer closed decisions');
select extensions.is((select count(distinct item->>'id')::integer from decision_page_results, jsonb_array_elements(payload->'items') item), 55, 'same-timestamp decisions paginate without gaps or duplicates');
select extensions.is(jsonb_array_length(public.app_list_investment_decision_page(null, 'closed', 50, null)->'items'), 30, 'closed decisions have a separate filter');
select extensions.throws_ok($$select public.app_list_portfolio_task_page(null, 'active', 20, '{"id":"bad"}'::jsonb)$$, 'Invalid task cursor', 'malformed task cursor fails closed');

select * from extensions.finish();
rollback;
