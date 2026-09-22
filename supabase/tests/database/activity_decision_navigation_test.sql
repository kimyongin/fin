begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select extensions.plan(5);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000001951','authenticated','authenticated','decision-navigation@example.com','',now(),now(),now());
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000001951',true);
set local role authenticated;

create temporary table recorded_decision as select public.app_record_investment_decision(
  '25111111-1111-4111-8111-111111111111',
  jsonb_build_object('status','proposed','subject',jsonb_build_object('kind','portfolio','label','전체'),'question','현금 비중을 유지할까?',
    'options',jsonb_build_array('유지','축소'),'timezone','Asia/Seoul','authored_via','app','follow_up_tasks','[]'::jsonb)
) payload;

select extensions.is((select title from activity_events where action_type='record_investment_decision'),'현금 비중을 유지할까?','new decision activity uses the decision question as its visible title');
select extensions.is((select target_id from activity_events where action_type='record_investment_decision'),(select payload->>'id' from recorded_decision),'decision activity preserves the direct target id');

select public.app_transition_investment_decision(
  (select (payload->>'id')::uuid from recorded_decision),1,'25222222-2222-4222-8222-222222222222',
  jsonb_build_object('action','adopt','selected_option','유지','reason','변동성을 낮춘다','authored_via','app')
);
select extensions.is((select title from activity_events where action_type='transition_investment_decision'),'현금 비중을 유지할까?','decision transition activity keeps the same visible question');
select extensions.is((select count(*) from investment_decisions),1::bigint,'navigation presentation does not duplicate the decision source');
select extensions.is((select count(*) from investment_decision_state_history),2::bigint,'existing decision history remains authoritative');

select * from extensions.finish();
rollback;
