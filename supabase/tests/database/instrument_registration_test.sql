begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(8);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values
  ('00000000-0000-0000-0000-000000009141','authenticated','authenticated','register-owner@example.com','',now(),now(),now()),
  ('00000000-0000-0000-0000-000000009142','authenticated','authenticated','register-other@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009141',true);
set local role authenticated;
select * from public.app_create_instrument(' zerohold ', 'Zero Holding', 'USD', 'market', null, 'first note');
select extensions.is((select count(*) from public.instruments where user_id=auth.uid() and ticker='ZEROHOLD'),1::bigint,'registration normalizes and saves one instrument');
select extensions.is((select count(*) from public.holdings where user_id=auth.uid() and ticker='ZEROHOLD'),0::bigint,'registration creates no holding');
select extensions.is((select count(*) from public.holding_prices_daily where user_id=auth.uid() and ticker='ZEROHOLD'),0::bigint,'registration creates no price');
select extensions.ok(exists(select 1 from public.app_get_price_sync_targets() where ticker='ZEROHOLD'),'unheld market instrument is a price target');
select extensions.throws_ok(
  $$select * from public.app_create_instrument('zerohold','Overwrite','USD','market',null,'bad note')$$,
  'P0001','Instrument already registered','duplicate registration is rejected');
select extensions.is((select note from public.instruments where user_id=auth.uid() and ticker='ZEROHOLD'),'first note','duplicate leaves existing note unchanged');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009142',true);
select extensions.ok(not exists(select 1 from public.app_get_price_sync_targets() where ticker='ZEROHOLD'),'another user cannot see price target');
select * from public.app_create_instrument('zerohold','Other Holding','USD','market',null,null);
select extensions.is((select count(*) from public.instruments where user_id=auth.uid() and ticker='ZEROHOLD'),1::bigint,'different user may register the same ticker');
select * from extensions.finish();
rollback;
