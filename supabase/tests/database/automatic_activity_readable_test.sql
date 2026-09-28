begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(15);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values('00000000-0000-0000-0000-000000001688','authenticated','authenticated','activity-168@example.com','',now(),now(),now());
insert into public.accounts(id,user_id,name) values(99688,'00000000-0000-0000-0000-000000001688','테스트 계좌');
insert into public.instruments(id,user_id,ticker,display_name,instrument_type,currency,note)
values(99688,'00000000-0000-0000-0000-000000001688','TEST168','테스트 종목','market','KRW',null);

insert into public.activity_events(user_id,source,action_type,target_table,target_id,before_data,after_data,status)
values
('00000000-0000-0000-0000-000000001688','user','create_account','accounts','99688',null,
  '{"name":"테스트 계좌","broker":"데모 증권"}'::jsonb,'succeeded'),
('00000000-0000-0000-0000-000000001688','user','update_account','accounts','99688',
  '{"name":"옛 계좌","broker":"A"}'::jsonb,'{"name":"테스트 계좌","broker":"B"}'::jsonb,'succeeded'),
('00000000-0000-0000-0000-000000001688','user','create_instrument','instruments','99688',null,
  '{"display_name":"테스트 종목","ticker":"TEST168","instrument_type":"market","currency":"KRW"}'::jsonb,'succeeded'),
('00000000-0000-0000-0000-000000001688','user','delete_instrument','instruments','99688',
  '{"display_name":"삭제 종목","ticker":"GONE168","instrument_type":"market"}'::jsonb,null,'succeeded'),
('00000000-0000-0000-0000-000000001688','user','create_tag','tags','99688',null,
  '{"name":"성장주"}'::jsonb,'succeeded'),
('00000000-0000-0000-0000-000000001688','user','delete_holding','holdings','99688',
  '{"display_name":"테스트 종목","ticker":"TEST168","account_name":"테스트 계좌","quantity":3,"avg_price":1000}'::jsonb,
  null,'succeeded'),
('00000000-0000-0000-0000-000000001688','user','update_strategy','allocation_targets',null,null,
  '[]'::jsonb,'succeeded'),
('00000000-0000-0000-0000-000000001688','user','cancel_general_task','portfolio_tasks',null,null,
  '{"title":"주간 점검","reason":"중단 결정"}'::jsonb,'succeeded');

select extensions.is((select title from public.activity_events where action_type='create_account' and user_id='00000000-0000-0000-0000-000000001688'),
  '테스트 계좌 · 계좌 등록','account creation has a readable title');
select extensions.ok((select body like '%이름: 옛 계좌 → 테스트 계좌%' from public.activity_events where action_type='update_account' and user_id='00000000-0000-0000-0000-000000001688'),
  'account edit lists the changed name');
select extensions.is((select instrument_ticker from public.activity_events where action_type='create_instrument' and user_id='00000000-0000-0000-0000-000000001688'),
  'TEST168','market creation saves ticker');
select extensions.is((select instrument_ticker from public.activity_events where action_type='delete_instrument' and user_id='00000000-0000-0000-0000-000000001688'),
  'GONE168','market deletion retains the old ticker');
select extensions.ok((select body like '%GONE168%' from public.activity_events where action_type='delete_instrument' and user_id='00000000-0000-0000-0000-000000001688'),
  'market deletion keeps its old identifier in prose');
select extensions.is((select title from public.activity_events where action_type='create_tag' and user_id='00000000-0000-0000-0000-000000001688'),
  '성장주 · 태그 추가','tag creation names the tag');
select extensions.ok((select body like '%수량: 3주 → 없음%' from public.activity_events where action_type='delete_holding' and user_id='00000000-0000-0000-0000-000000001688'),
  'deleted holding retains its prior quantity');
select extensions.is((select instrument_ticker from public.activity_events where action_type='delete_holding' and user_id='00000000-0000-0000-0000-000000001688'),
  'TEST168','market holding deletion keeps its ticker');
select extensions.is((select title from public.activity_events where action_type='update_strategy' and user_id='00000000-0000-0000-0000-000000001688'),
  '목표 배분 변경','allocation has a title');
select extensions.is((select title from public.activity_events where action_type='cancel_general_task' and user_id='00000000-0000-0000-0000-000000001688'),
  '주간 점검','recurring cancellation names the task');

insert into public.activity_events(user_id,source,action_type,target_table,target_id,instrument_id,title,body,after_data,status)
values('00000000-0000-0000-0000-000000001688','user','save_asset_detail','instruments','99688',99688,
  '테스트 종목 변경','종목 정보 변경',
  '{"changes":[{"subject":"instrument","before":{"display_name":"테스트 종목","currency":"KRW","instrument_type":"market","note":null,"tag_id":null},"after":{"display_name":"테스트 종목","currency":"KRW","instrument_type":"market","note":"새 투자 메모","tag_id":null}}]}'::jsonb,'succeeded');
select extensions.is((select body from public.activity_events where action_type='save_asset_detail' and user_id='00000000-0000-0000-0000-000000001688'),
  '새 투자 메모','asset detail stores the note rather than a generic phrase');
select extensions.is((select title from public.activity_events where action_type='save_asset_detail' and user_id='00000000-0000-0000-0000-000000001688'),
  '테스트 종목 · 자산 정보 수정','asset detail title matches the changed subject');

insert into public.activity_events(user_id,source,action_type,target_table,before_data,after_data,status)
values('00000000-0000-0000-0000-000000001688','user','bulk_edit_portfolio','portfolio',
  '{"portfolio_snapshot":{"accounts":[{"id":99688,"name":"테스트 계좌"}],"instruments":[{"ticker":"TEST168","display_name":"테스트 종목"}],"holdings":[{"account_id":99688,"ticker":"TEST168","quantity":1,"avg_price":1000}]}}'::jsonb,
  '{"row_count":1,"created_account_count":0,"created_instrument_count":0,"portfolio_snapshot":{"accounts":[{"id":99688,"name":"테스트 계좌"}],"instruments":[{"ticker":"TEST168","display_name":"테스트 종목"}],"holdings":[{"account_id":99688,"ticker":"TEST168","quantity":2,"avg_price":1000}]}}'::jsonb,
  'succeeded');
select extensions.ok((select body like '%테스트 계좌 · 테스트 종목 (TEST168): 수량 1→2%'
  from public.activity_events where action_type='bulk_edit_portfolio' and user_id='00000000-0000-0000-0000-000000001688'),
  'bulk edit describes only changed values without raw JSON');

insert into public.activity_events(user_id,source,action_type,target_table,target_id,before_data,after_data,status)
values('00000000-0000-0000-0000-000000001688','user','update_account','accounts','99688',
  '{"name":"테스트 계좌","broker":"A","updated_at":"old"}'::jsonb,
  '{"name":"테스트 계좌","broker":"A","updated_at":"new"}'::jsonb,'succeeded'),
('00000000-0000-0000-0000-000000001688','user','update_instrument','instruments','99688',
  '{"ticker":"TEST168","display_name":"테스트 종목","currency":"KRW","instrument_type":"market","updated_at":"old"}'::jsonb,
  '{"ticker":"TEST168","display_name":"테스트 종목","currency":"KRW","instrument_type":"market","updated_at":"new"}'::jsonb,'succeeded');
select extensions.is((select count(*) from public.activity_events where action_type='update_account' and user_id='00000000-0000-0000-0000-000000001688'),
  1::bigint,'unchanged account fields do not add a second record');
select extensions.is((select count(*) from public.activity_events where action_type='update_instrument' and user_id='00000000-0000-0000-0000-000000001688'),
  0::bigint,'unchanged instrument fields do not add a record');

select * from extensions.finish();
rollback;
