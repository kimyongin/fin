begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(10);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values ('00000000-0000-0000-0000-000000009321','authenticated','authenticated','single-principle-owner@example.com','',now(),now(),now()),
       ('00000000-0000-0000-0000-000000009322','authenticated','authenticated','single-principle-other@example.com','',now(),now(),now());
set local role postgres;
insert into public.principles(principle_id,user_id,body,effective_at,change_note)
values ('93211111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000009321','기존 문서 A','2026-09-01T00:00:00Z','A'),
       ('93222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000009321','기존 문서 B','2026-09-02T00:00:00Z','B'),
       ('93233333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000009321','기존 문서 C','2026-09-03T00:00:00Z','C'),
       ('93244444-4444-4444-8444-444444444444','00000000-0000-0000-0000-000000009321','기존 문서 D','2026-09-03T00:00:00Z','D');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009321',true);
set local role authenticated;
select extensions.is(jsonb_array_length(public.app_list_principles()->'items'),1,'four historical documents expose one current');
select extensions.is(public.app_list_principles() #>> '{items,0,body}','기존 문서 D','equal timestamps select the highest row id');
select extensions.is(jsonb_array_length(public.app_list_principle_changes()->'items'),4,'all four original bodies remain in history');
select extensions.throws_ok($$select public.app_save_principle('93211111-1111-4111-8111-111111111111',null,'별도 문서')$$,
  'P0001','Current principle ID changed; reload before saving','a second current document is rejected');
select extensions.is(public.app_save_principle('93244444-4444-4444-8444-444444444444',
  (public.app_list_principles() #>> '{items,0,id}')::bigint,'한 문서로 정리','통합') ->> 'body',
  '한 문서로 정리','current document can be revised after migration');
select extensions.is(jsonb_array_length(public.app_list_principles()->'items'),1,'revision still exposes one current document');
reset role;
insert into public.principles(principle_id,user_id,body,effective_at,ended,change_note)
values ('93244444-4444-4444-8444-444444444444','00000000-0000-0000-0000-000000009321',
  '한 문서로 정리',clock_timestamp(),true,'기존 종료 기록');
set local role authenticated;
select extensions.is(public.app_list_principles()->'items','[]'::jsonb,'latest ended row does not revive an older document');
select extensions.is(jsonb_array_length(public.app_list_principle_changes()->'items'),6,'ended row and all previous bodies remain inspectable');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000009322',true);
select extensions.is(public.app_list_principles()->'items','[]'::jsonb,'other owner cannot read current document');
select extensions.is(public.app_list_principle_changes()->'items','[]'::jsonb,'other owner cannot read history');
select * from extensions.finish();
rollback;
