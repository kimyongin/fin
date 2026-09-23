begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(11);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values
('00000000-0000-0000-0000-000000000961','authenticated','authenticated','detail-owner@example.com','',now(),now(),now()),
('00000000-0000-0000-0000-000000000962','authenticated','authenticated','detail-other@example.com','',now(),now(),now());
set local role postgres;
insert into public.accounts(id,user_id,name) values
(9961,'00000000-0000-0000-0000-000000000961','First'),
(9962,'00000000-0000-0000-0000-000000000961','Second');
insert into public.tags(id,user_id,name) values(9961,'00000000-0000-0000-0000-000000000961','Growth');
insert into public.instruments(id,user_id,ticker,display_name,currency,instrument_type,note)
values(9961,'00000000-0000-0000-0000-000000000961','DETAIL','Original','KRW','market','original note');
insert into public.holdings(user_id,account_id,ticker,quantity,avg_price,note)
values('00000000-0000-0000-0000-000000000961',9961,'DETAIL',2,100,'holding note');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000961',true);
set local role authenticated;

create temp table detail_fixture(expected jsonb, instrument jsonb, holdings jsonb, response jsonb, before_events bigint, after_save_events bigint) on commit drop;
grant select,insert,update on detail_fixture to authenticated;
insert into detail_fixture(expected,instrument,holdings,before_events)
select jsonb_build_object('display_name','Original','currency','KRW','instrument_type','market',
    'note','original note','private_note',null,'tag_id',null),
  jsonb_build_object('display_name','Updated','currency','KRW','instrument_type','market',
    'note','new note','private_note','private reason','tag_id',9961),
  jsonb_build_array(
    jsonb_build_object('id',h.id,'account_id',9961,'expected_account_id',9961,
      'expected_state_version',h.state_version,'expected_note','holding note','expected_private_note',null,
      'quantity',3,'avg_price',120,'note','updated holding','private_note','private holding'),
    jsonb_build_object('id',null,'account_id',9962,'quantity',1,'avg_price',90,'note','second account','private_note','second reason')
  ),
  (select count(*) from public.activity_events where user_id='00000000-0000-0000-0000-000000000961')
from public.holdings h where h.ticker='DETAIL';

update detail_fixture set response=public.app_save_asset_detail(9961,expected,instrument,holdings,'00000000-0000-0000-0000-000000009661');
update detail_fixture set after_save_events=(select count(*) from public.activity_events where user_id='00000000-0000-0000-0000-000000000961');
select extensions.is((select response->'instrument'->>'display_name' from detail_fixture),'Updated','response includes saved instrument');
select extensions.is((select count(*) from public.holdings where ticker='DETAIL'),2::bigint,'new account holding is inserted once');
select extensions.is((select quantity::numeric from public.holdings where ticker='DETAIL' and account_id=9961),3::numeric,'existing balance is saved');
select extensions.is((select private_note from public.holdings where ticker='DETAIL' and account_id=9962),'second reason','private note is saved with new holding');
select extensions.is((select tag_id from public.instrument_tags where ticker='DETAIL'),9961::bigint,'tag is saved in same transaction');
select extensions.is((select response from detail_fixture),(select public.app_save_asset_detail(9961,expected,instrument,holdings,'00000000-0000-0000-0000-000000009661') from detail_fixture),'response-loss retry returns same receipt');
select extensions.is((select count(*) from public.holdings where ticker='DETAIL'),2::bigint,'retry does not duplicate holding');
select extensions.is((select count(*) from public.activity_events where user_id='00000000-0000-0000-0000-000000000961'),
  (select after_save_events from detail_fixture),'retry does not duplicate activity');

select extensions.throws_ok(
  (select format('select public.app_save_asset_detail(9961,%L::jsonb,%L::jsonb,%L::jsonb,%L::uuid)',
    response->'instrument',
    jsonb_build_object('display_name','Should roll back','currency','KRW','instrument_type','market',
      'note','new note','private_note','private reason','tag_id',9961),
    jsonb_build_array(jsonb_build_object('account_id',999999,'quantity',1,'avg_price',1)),
    '00000000-0000-0000-0000-000000009662') from detail_fixture),
  'P0001',null,'invalid account rejects the entire detail save');
select extensions.is((select display_name from public.instruments where id=9961),'Updated','failure rolls back preceding instrument change');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000962',true);
select extensions.throws_ok(
  (select format('select public.app_save_asset_detail(9961,%L::jsonb,%L::jsonb,%L::jsonb,%L::uuid)',
    expected,instrument,holdings,'00000000-0000-0000-0000-000000009663') from detail_fixture),
  'P0001','Instrument not found','another owner cannot edit instrument or its holdings');

select * from extensions.finish();
rollback;
