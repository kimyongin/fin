-- Isolated pre-migration row to verify that paused intent ends without
-- manufacturing a completion or removing earlier performed work.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values('00000000-0000-0000-0000-000000001974','authenticated','authenticated','paused-task-fixture@example.com','',now(),now(),now());
insert into public.portfolio_tasks(id,user_id,kind,version,title,subject,timezone,control_state,research_state)
values('19740000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000001974','general',2,
  '이전 보류 할 일','{"kind":"portfolio"}'::jsonb,'Asia/Seoul','paused',null);
insert into public.activity_events(user_id,source,action_type,target_table,target_id,task_id,after_data,status,occurred_at,occurrence_on)
values('00000000-0000-0000-0000-000000001974','user','complete_general_task','portfolio_tasks',
  '19740000-0000-4000-8000-000000000001','19740000-0000-4000-8000-000000000001',
  '{"title":"이전 보류 할 일","result":"이전에 실제 완료"}'::jsonb,'succeeded',
  timestamptz '2026-09-20 09:00:00+09',date '2026-09-20');
