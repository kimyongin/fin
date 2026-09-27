begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(19);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000966','authenticated','authenticated','ticker-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000000967','authenticated','authenticated','ticker-other@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000000968','authenticated','authenticated','ticker-friend@example.com','',now(),now(),now());
insert into public.instruments(user_id,ticker,display_name,currency,instrument_type)
values ('00000000-0000-0000-0000-000000000966','ZZZ166','Owned market','USD','market'),
('00000000-0000-0000-0000-000000000966','CASH166','Owned cash','KRW','cash'),
('00000000-0000-0000-0000-000000000967','ZZZ166','Other market','USD','market');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000966',true);
create temporary table ticker_created as
  select public.app_create_activity_market_ticker_with_tags(
    '00000000-0000-0000-0000-000000000966',
    '{"title":"Market research","body":"Evidence","instrument_ticker":" zzz166 ","authored_via":"app"}'::jsonb,
    array[]::uuid[]) result;
select extensions.is((select result->>'instrument_ticker' from ticker_created),'ZZZ166','ticker normalized on create');
select extensions.is((select result->'instrument_summary'->>'display_name' from ticker_created),'Owned market','owned name used as optional display');
select extensions.is((select public.app_create_activity_market_ticker_with_tags(
  '00000000-0000-0000-0000-000000000966',
  '{"title":"Market research","body":"Evidence","instrument_ticker":" zzz166 ","authored_via":"app"}'::jsonb,
  array[]::uuid[])->>'id' from ticker_created limit 1),(select result->>'id' from ticker_created),'creation retry returns the same record');
select extensions.is(jsonb_array_length(public.app_search_activity_references('instrument','CASH166',0,20)->'items'),0,'cash asset excluded from market candidates');
select extensions.is(jsonb_array_length(public.app_search_activities_ticker(input_instrument_ticker=>'zzz166')->'items'),1,'plain ticker filter includes record');
select extensions.is(jsonb_array_length(public.app_search_activities_ranked_ticker(input_query=>'ZZZ166',input_instrument_ticker=>'ZZZ166')->'items'),1,'ranked query includes linked ticker');
select extensions.is(public.app_save_general_task(null,null,'00000000-0000-0000-0000-000000000971',
  '{"title":"Research another market","subject":{"kind":"instrument","instrument_ticker":"msft"},"timezone":"Asia/Seoul","authored_via":"agent"}'::jsonb)->'subject'->>'instrument_ticker',
  'MSFT','task writer accepts and normalizes a market ticker');
insert into public.portfolio_tasks(id,user_id,kind,title,subject,due_date,timezone,control_state,recurrence_kind)
values ('00000000-0000-0000-0000-000000000966','00000000-0000-0000-0000-000000000966','general','Ticker task',
  '{"kind":"instrument","instrument_ticker":"zzz166"}',null,'Asia/Seoul','active','none');
select extensions.is((select subject->>'instrument_ticker' from public.portfolio_tasks
  where id='00000000-0000-0000-0000-000000000966'),'ZZZ166','task ticker normalized without registration link');
select extensions.is(jsonb_array_length(public.app_search_activities_ticker(input_instrument_ticker=>'ZZZ166')->'items'),2,'ticker filter finds task and activity');
insert into public.activity_events(user_id,source,action_type,target_table,status,occurred_at,task_id,after_data)
values ('00000000-0000-0000-0000-000000000966','user','complete_general_task','portfolio_tasks','succeeded',now(),
  '00000000-0000-0000-0000-000000000966','{}'::jsonb);
select extensions.is((select instrument_ticker from public.activity_events
  where user_id='00000000-0000-0000-0000-000000000966' and action_type='complete_general_task'),
  'ZZZ166','task completion activity inherits market ticker');
insert into public.activity_events(user_id,source,action_type,target_table,status,occurred_at,instrument_id,after_data)
select '00000000-0000-0000-0000-000000000966','user','reconcile_holding','holdings','succeeded',now(),i.id,'{}'::jsonb
from public.instruments i where i.user_id='00000000-0000-0000-0000-000000000966' and i.ticker='ZZZ166';
select extensions.is((select instrument_ticker from public.activity_events
  where user_id='00000000-0000-0000-0000-000000000966' and action_type='reconcile_holding'),
  'ZZZ166','financial record derives ticker from its owned market target');
delete from public.instruments where user_id='00000000-0000-0000-0000-000000000966' and ticker='ZZZ166';
select extensions.is((select public.app_get_activity_market_ticker((result->>'id')::bigint,null)->>'instrument_ticker' from ticker_created),'ZZZ166','ticker survives asset deletion');
select extensions.is((select public.app_get_activity_market_ticker((result->>'id')::bigint,null)->'instrument_summary'->>'display_name' from ticker_created),'ZZZ166','deleted asset shows ticker without fabricated name');
do $$ begin
  perform public.app_save_sharing_profile('ticker-owner','secret',false);
  perform public.app_save_sharing_profile('ticker-owner','',true);
end $$;
insert into public.friendships(viewer_user_id,owner_user_id)
values ('00000000-0000-0000-0000-000000000968','00000000-0000-0000-0000-000000000966');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000968',true);
select extensions.is((select public.app_get_activity_market_ticker((result->>'id')::bigint,
  '00000000-0000-0000-0000-000000000966')->>'instrument_ticker' from ticker_created),
  'ZZZ166','authorized friend reads the saved ticker');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000967',true);
select extensions.is((select public.app_get_activity_market_ticker((result->>'id')::bigint,
  '00000000-0000-0000-0000-000000000966')->>'instrument_ticker' from ticker_created),
  null::text,'stranger cannot read the saved ticker');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000966',true);
select extensions.is((select public.app_save_activity_market_ticker_detail((result->>'id')::bigint,(result->>'version')::integer,
  '00000000-0000-0000-0000-000000000969','{"instrument_ticker":"ZZZ166"}'::jsonb,array[]::uuid[],'app')->>'version' from ticker_created),
  (select result->>'version' from ticker_created),'saving unchanged ticker does not increment version');
select extensions.is((select public.app_save_activity_market_ticker_detail((result->>'id')::bigint,(result->>'version')::integer,
  '00000000-0000-0000-0000-000000000968','{"instrument_ticker":"MSFT"}'::jsonb,array[]::uuid[],'app')->>'instrument_ticker' from ticker_created),'MSFT','ticker can be edited');
select extensions.is((select public.app_save_activity_market_ticker_detail((tc.result->>'id')::bigint,
  (select version from public.activity_events where id=(tc.result->>'id')::bigint),
  '00000000-0000-0000-0000-000000000970','{"instrument_ticker":null}'::jsonb,array[]::uuid[],'app')->>'instrument_ticker' from ticker_created tc),
  null::text,'ticker can be cleared explicitly');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000967',true);
select extensions.is(jsonb_array_length(public.app_search_activities_ticker(input_instrument_ticker=>'ZZZ166')->'items'),0,'same ticker never reveals another owner activity');
select * from extensions.finish();
rollback;
