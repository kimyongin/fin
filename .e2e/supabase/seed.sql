insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values (
  '00000000-0000-0000-0000-00000000e201',
  'authenticated',
  'authenticated',
  'e2e-owner@example.com',
  extensions.crypt('e2e-password', extensions.gen_salt('bf')),
  now(),
  now(),
  now()
)
on conflict (id) do nothing;

update auth.users
set instance_id = '00000000-0000-0000-0000-000000000000',
    confirmation_token = '',
    email_change = '',
    recovery_token = '',
    email_change_token_new = '',
    email_change_token_current = '',
    phone_change_token = '',
    reauthentication_token = '',
    phone = null,
    phone_change = '',
    is_super_admin = false,
    raw_app_meta_data = jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    raw_user_meta_data = jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true, 'phone_verified', false)
where email in ('e2e-owner@example.com', 'e2e-friend@example.com', 'e2e-outsider@example.com');

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select id::text, id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true, 'phone_verified', false), 'email', now(), now(), now()
from auth.users
where email in ('e2e-owner@example.com', 'e2e-friend@example.com', 'e2e-outsider@example.com')
on conflict (provider_id, provider) do update
set identity_data = excluded.identity_data,
    updated_at = excluded.updated_at;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000e202', 'authenticated', 'authenticated', 'e2e-friend@example.com', extensions.crypt('e2e-password', extensions.gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-00000000e203', 'authenticated', 'authenticated', 'e2e-outsider@example.com', extensions.crypt('e2e-password', extensions.gen_salt('bf')), now(), now(), now())
on conflict (id) do nothing;

update auth.users
set instance_id = '00000000-0000-0000-0000-000000000000',
    confirmation_token = '',
    recovery_token = '',
    email_change_token_new = '',
    email_change = '',
    email_change_token_current = '',
    phone_change_token = '',
    reauthentication_token = '',
    phone = null,
    phone_change = '',
    is_super_admin = false,
    raw_app_meta_data = jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    raw_user_meta_data = jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true, 'phone_verified', false)
where email in ('e2e-owner@example.com', 'e2e-friend@example.com', 'e2e-outsider@example.com');

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select id::text, id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true, 'phone_verified', false), 'email', now(), now(), now()
from auth.users
where email in ('e2e-owner@example.com', 'e2e-friend@example.com', 'e2e-outsider@example.com')
on conflict (provider_id, provider) do update
set identity_data = excluded.identity_data,
    updated_at = excluded.updated_at;

insert into public.profiles (user_id, public_name, public_name_normalized, viewer_password_hash, viewer_password_updated_at, sharing_enabled)
values (
  '00000000-0000-0000-0000-00000000e201',
  'e2e-owner',
  'e2e-owner',
  extensions.crypt('e2e-password', extensions.gen_salt('bf')),
  now(),
  true
)
on conflict (user_id) do update
set public_name = excluded.public_name,
    public_name_normalized = excluded.public_name_normalized,
    viewer_password_hash = excluded.viewer_password_hash,
    viewer_password_updated_at = excluded.viewer_password_updated_at,
    sharing_enabled = excluded.sharing_enabled;

insert into public.profiles (user_id, public_name, public_name_normalized, viewer_password_hash, viewer_password_updated_at, sharing_enabled)
values (
  '00000000-0000-0000-0000-00000000e202',
  'e2e-friend',
  'e2e-friend',
  extensions.crypt('e2e-password', extensions.gen_salt('bf')),
  now(),
  true
)
on conflict (user_id) do update
set public_name = excluded.public_name,
    public_name_normalized = excluded.public_name_normalized,
    viewer_password_hash = excluded.viewer_password_hash,
    viewer_password_updated_at = excluded.viewer_password_updated_at,
    sharing_enabled = excluded.sharing_enabled;

with saved_account as (
  insert into public.accounts (user_id, name, broker, note)
  values ('00000000-0000-0000-0000-00000000e201', 'E2E Account', 'E2E Broker', 'Playwright seed')
  returning id
), saved_instrument as (
  insert into public.instruments (user_id, ticker, display_name, currency, instrument_type, price_source)
  values ('00000000-0000-0000-0000-00000000e201', 'E2EAPL', 'E2E Apple', 'USD', 'market', 'manual')
)
insert into public.holdings (user_id, account_id, ticker, quantity, avg_price)
select '00000000-0000-0000-0000-00000000e201', saved_account.id, 'E2EAPL', 2, 100
from saved_account;

insert into public.holding_prices_daily (user_id, ticker, price_date, close_price, source)
values ('00000000-0000-0000-0000-00000000e201', 'E2EAPL', current_date, 150, 'manual');

insert into public.tags (user_id, name, sort_order)
values ('00000000-0000-0000-0000-00000000e201', 'E2E Tag', 1);

insert into public.instrument_tags (user_id, ticker, tag_id)
select '00000000-0000-0000-0000-00000000e201', 'E2EAPL', id
from public.tags
where user_id = '00000000-0000-0000-0000-00000000e201'
  and name = 'E2E Tag';
