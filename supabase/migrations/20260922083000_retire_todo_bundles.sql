create table public.todo_item_action_migrations (
  todo_item_id uuid primary key references public.todo_items(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  original_task_id uuid,
  general_task_id uuid,
  activity_event_id bigint,
  legacy_status text,
  metadata jsonb not null check(jsonb_typeof(metadata)='object'),
  migrated_at timestamptz not null default clock_timestamp(),
  check(num_nonnulls(original_task_id,general_task_id,activity_event_id)<=1),
  foreign key(user_id,original_task_id) references public.portfolio_tasks(user_id,id) on delete restrict,
  foreign key(user_id,general_task_id) references public.portfolio_tasks(user_id,id) on delete restrict,
  foreign key(activity_event_id) references public.activity_events(id) on delete restrict
);
alter table public.todo_item_action_migrations enable row level security;
create policy todo_item_action_migrations_owner_select on public.todo_item_action_migrations for select to authenticated using(user_id=auth.uid());
revoke all on public.todo_item_action_migrations from public,anon,authenticated;
grant select on public.todo_item_action_migrations to authenticated;

insert into public.todo_item_action_migrations(todo_item_id,user_id,original_task_id,general_task_id,legacy_status,metadata)
select item.id,item.user_id,
  case when item.kind='task' then item.task_id else null end,
  case when item.kind='general' and item.status<>'done' then gen_random_uuid() else null end,
  item.status,
  jsonb_build_object(
    'bundle_id',bundle.id,'bundle_title',bundle.title,'bundle_summary',bundle.summary,'tags',to_jsonb(bundle.tags),
    'sort_order',item.sort_order,'result',item.result,'performed_at',item.performed_at,
    'rules',coalesce((select jsonb_agg(link.rule_snapshot order by link.rule_id) from public.todo_bundle_rule_links link where link.bundle_id=bundle.id),'[]'::jsonb),
    'decision_ids',coalesce((select jsonb_agg(link.decision_id order by link.decision_id) from public.todo_bundle_decision_links link where link.bundle_id=bundle.id),'[]'::jsonb),
    'verification_ids',coalesce((select jsonb_agg(link.verification_id order by link.verification_id) from public.todo_bundle_verification_links link where link.bundle_id=bundle.id),'[]'::jsonb)
  )
from public.todo_items item join public.todo_bundles bundle on bundle.user_id=item.user_id and bundle.id=item.bundle_id;

insert into public.portfolio_tasks(id,user_id,kind,version,title,subject,due_date,timezone,trigger_text,control_state,research_state,recurrence_kind,recurrence_start_on,created_at,updated_at)
select mapping.general_task_id,item.user_id,'general',1,item.title,
  jsonb_build_object('kind','portfolio','legacy_todo',jsonb_build_object('bundle_id',item.bundle_id,'item_id',item.id,'tags',mapping.metadata->'tags')),
  null,'Asia/Seoul',bundle.summary,
  case item.status when 'paused' then 'paused' when 'cancelled' then 'cancelled' else 'active' end,
  null,'none',null,item.created_at,item.updated_at
from public.todo_item_action_migrations mapping
join public.todo_items item on item.id=mapping.todo_item_id and item.user_id=mapping.user_id
join public.todo_bundles bundle on bundle.id=item.bundle_id and bundle.user_id=item.user_id
where mapping.general_task_id is not null;

insert into public.portfolio_task_history(user_id,task_id,version,control_state,research_state,content_snapshot,answer,change_reason,authored_via,created_at)
select task.user_id,task.id,1,task.control_state,null,
  jsonb_build_object('title',task.title,'subject',task.subject,'due_date',task.due_date,'trigger_text',task.trigger_text,'timezone',task.timezone,'recurrence_kind','none','recurrence_start_on',null),
  item.result,'기존 ToDo 묶음에서 통합 행동 모델로 이관','app',item.updated_at
from public.todo_item_action_migrations mapping
join public.portfolio_tasks task on task.id=mapping.general_task_id and task.user_id=mapping.user_id
join public.todo_items item on item.id=mapping.todo_item_id and item.user_id=mapping.user_id;

update public.portfolio_tasks task set current_history_id=history.id
from public.portfolio_task_history history
where history.user_id=task.user_id and history.task_id=task.id and history.version=1
  and exists(select 1 from public.todo_item_action_migrations mapping where mapping.general_task_id=task.id and mapping.user_id=task.user_id);

insert into public.activity_events(user_id,source,action_type,target_table,target_id,before_data,after_data,status,occurred_at,occurrence_on)
select item.user_id,'user','record_manual_activity','todo_items',item.id::text,null,
  jsonb_build_object('title',item.title,'result',item.result,'reported',true,'migrated',true,'legacy_todo',mapping.metadata),
  'succeeded',coalesce(item.performed_at,item.updated_at),(coalesce(item.performed_at,item.updated_at) at time zone 'Asia/Seoul')::date
from public.todo_items item join public.todo_item_action_migrations mapping on mapping.todo_item_id=item.id and mapping.user_id=item.user_id
where item.kind='general' and item.status='done';

update public.todo_item_action_migrations mapping set activity_event_id=event.id
from public.activity_events event
where mapping.todo_item_id::text=event.target_id and event.target_table='todo_items' and event.action_type='record_manual_activity'
  and mapping.user_id=event.user_id and mapping.activity_event_id is null;

alter table public.todo_item_action_migrations drop constraint todo_item_action_migrations_check;
alter table public.todo_item_action_migrations add constraint todo_item_action_migrations_exactly_one_target
  check(num_nonnulls(original_task_id,general_task_id,activity_event_id)=1);

comment on table public.todo_bundles is 'Legacy read-compatible grouping model. New writes are no longer advertised after the action timeline transition.';
comment on function public.app_save_todo_bundle(uuid,integer,uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text) is 'Deprecated compatibility write. New clients use general tasks, automatic events, and activity reports.';

create or replace function public.app_create_daily_context(
    input_timezone text default 'Asia/Seoul', input_subject_tickers text[] default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare created_context jsonb; created_context_id uuid; enriched_snapshot jsonb;
begin
  created_context:=public.app_create_daily_context_without_lifecycle(input_timezone,input_subject_tickers);
  created_context_id:=(created_context->>'context_id')::uuid;
  update public.daily_review_contexts context set snapshot=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
    context.snapshot,
    '{open_tasks}',jsonb_build_object('status','available','items',public.app_list_action_timeline(null,'pending',null,null,100,null,input_timezone)->'pending')),
    '{todo_bundles}',jsonb_build_object('status','retired','items','[]'::jsonb)),
    '{decisions}',jsonb_build_object('status','available','items',public.app_list_investment_decisions(20,null))),
    '{investment_policy}',coalesce(public.app_get_investment_policy()->'profile','null'::jsonb)),
    '{holding_theses}',public.app_list_holding_theses())
  where context.id=created_context_id and context.user_id=auth.uid() returning context.snapshot into enriched_snapshot;
  return created_context||jsonb_build_object('snapshot',enriched_snapshot);
end; $$;

create or replace function public.app_list_todo_migration_map()
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object('todo_item_id',mapping.todo_item_id,'original_task_id',mapping.original_task_id,
    'general_task_id',mapping.general_task_id,'activity_event_id',mapping.activity_event_id,'legacy_status',mapping.legacy_status,
    'metadata',mapping.metadata,'migrated_at',mapping.migrated_at) order by mapping.migrated_at,mapping.todo_item_id),'[]'::jsonb)
  from public.todo_item_action_migrations mapping where mapping.user_id=auth.uid();
$$;
revoke all on function public.app_list_todo_migration_map() from public,anon;
grant execute on function public.app_list_todo_migration_map() to authenticated;
