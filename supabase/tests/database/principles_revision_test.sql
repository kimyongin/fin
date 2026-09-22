begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select extensions.plan(14);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000861', 'authenticated', 'authenticated', 'principle-owner@example.com', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000862', 'authenticated', 'authenticated', 'principle-other@example.com', '', now(), now(), now());

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000861', true);
set local role authenticated;

select extensions.is(public.app_list_principles() -> 'items', '[]'::jsonb, 'new owner starts empty');
select extensions.is(
  public.app_save_principle('86000000-0000-0000-0000-000000000001', null, 'investment', '분산 투자') ->> 'body',
  '분산 투자', 'save a first principle');
select extensions.is(jsonb_array_length(public.app_list_principles() -> 'items'), 1, 'list the current row');
select extensions.is(
  public.app_save_principle('86000000-0000-0000-0000-000000000001', null, 'investment', '분산 투자') ->> 'body',
  '분산 투자', 'same-content retry is safe');
select extensions.is((select count(*) from public.principles where user_id=auth.uid()), 1::bigint, 'retry does not append');
select extensions.is(
  public.app_save_principle('86000000-0000-0000-0000-000000000001',
    (public.app_list_principles() #>> '{items,0,id}')::bigint, 'investment', '분산과 현금 유지') ->> 'body',
  '분산과 현금 유지', 'edit appends a new current row');
select extensions.is((select count(*) from public.principles where user_id=auth.uid()), 2::bigint, 'history stays in one table');
select extensions.is(public.app_list_principles(((clock_timestamp() at time zone 'Asia/Seoul')::date - 1), 'Asia/Seoul') -> 'items',
  '[]'::jsonb, 'the principle did not exist on the prior local day');
select extensions.is(public.app_list_principles((clock_timestamp() at time zone 'Asia/Seoul')::date, 'Asia/Seoul') #>> '{items,0,body}',
  '분산과 현금 유지', 'the local-day view selects the latest revision');
select extensions.is(
  public.app_save_principle('86000000-0000-0000-0000-000000000001',
    (public.app_list_principles() #>> '{items,0,id}')::bigint, 'investment', 'ignored on end', null, true) ->> 'ended',
  'true', 'end appends a terminal row');
select extensions.is(public.app_list_principles() -> 'items', '[]'::jsonb, 'ended principle is not current');
select extensions.is(jsonb_array_length(public.app_list_principles(null, 'Asia/Seoul', true) -> 'items'), 1,
  'ended principle remains inspectable');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000862', true);
select extensions.is(public.app_list_principles() -> 'items', '[]'::jsonb, 'other user cannot list owner principles');
select extensions.is((select count(*) from public.principles), 0::bigint, 'RLS hides rows');

select * from extensions.finish();
rollback;
