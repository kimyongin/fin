create or replace function public.app_list_daily_briefings_for_owner(input_owner_user_id uuid,input_limit integer default 20,input_before timestamptz default null)
returns jsonb language sql stable security definer set search_path=public as $$
  select case when input_owner_user_id=auth.uid() then public.app_list_daily_briefings(input_limit,input_before)
    when public.can_view_feature(input_owner_user_id,'briefings') then coalesce((select jsonb_agg(to_jsonb(item) order by item.analyzed_at desc,item.id desc) from (
      select id,review_date,timezone,analyzed_at,status,coverage_status,headline,supersedes_id,created_at from public.daily_briefings
      where user_id=input_owner_user_id and (input_before is null or analyzed_at<input_before)
      order by analyzed_at desc,id desc limit greatest(1,least(coalesce(input_limit,20),100))) item),'[]'::jsonb)
    else '[]'::jsonb end;
$$;

create or replace function public.app_get_daily_briefing_for_owner(input_owner_user_id uuid,input_briefing_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select case when input_owner_user_id=auth.uid() then public.app_get_daily_briefing(input_briefing_id)
    when public.can_view_feature(input_owner_user_id,'briefings') then (
      select jsonb_build_object('id',b.id,'review_date',b.review_date,'timezone',b.timezone,'analyzed_at',b.analyzed_at,'status',b.status,'coverage_status',b.coverage_status,
        'headline',b.headline,'changes',b.changes,'uncertainties',b.uncertainties,'supersedes_id',b.supersedes_id,'created_at',b.created_at,
        'context_snapshot',null,'evidence',case when public.can_view_feature(input_owner_user_id,'research_evidence') then coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'source_name',e.source_name,'source_url',e.source_url,'published_at',e.published_at,'accessed_at',e.accessed_at,'summary',e.summary,'facts',e.facts)) from public.daily_briefing_evidence e where e.user_id=input_owner_user_id and e.briefing_id=b.id),'[]'::jsonb) else '[]'::jsonb end,
        'scopes','[]'::jsonb)
      from public.daily_briefings b where b.user_id=input_owner_user_id and b.id=input_briefing_id)
    else null end;
$$;

create or replace function public.app_list_investment_decisions_for_owner(input_owner_user_id uuid,input_limit integer default 20,input_before timestamptz default null)
returns jsonb language sql stable security definer set search_path=public as $$
 select case when input_owner_user_id=auth.uid() then public.app_list_investment_decisions(input_limit,input_before)
  when public.can_view_feature(input_owner_user_id,'decisions') then coalesce((select jsonb_agg(to_jsonb(item) order by item.updated_at desc,item.id desc) from (
   select id,version,status,subject,question,options,selected_option,reason,uncertainty,review_condition,created_at,updated_at
   from public.investment_decisions where user_id=input_owner_user_id and (input_before is null or updated_at<input_before)
   order by updated_at desc,id desc limit greatest(1,least(coalesce(input_limit,20),50))) item),'[]'::jsonb)
  else '[]'::jsonb end;
$$;

create or replace function public.app_get_investment_decision_for_owner(input_owner_user_id uuid,input_decision_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select case when input_owner_user_id=auth.uid() then public.app_get_investment_decision(input_decision_id)
  when public.can_view_feature(input_owner_user_id,'decisions') then (
   select to_jsonb(d)-'user_id'-'policy_snapshot'-'source_briefing_id' || jsonb_build_object('tasks',case when public.can_view_feature(input_owner_user_id,'tasks') then coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'kind',t.kind,'control_state',t.control_state,'research_state',t.research_state,'due_date',t.due_date)) from public.investment_decision_tasks l join public.portfolio_tasks t on t.id=l.task_id and t.user_id=l.user_id where l.user_id=input_owner_user_id and l.decision_id=d.id),'[]'::jsonb) else '[]'::jsonb end,'history','[]'::jsonb)
   from public.investment_decisions d where d.user_id=input_owner_user_id and d.id=input_decision_id)
  else null end;
$$;

create or replace function public.app_list_portfolio_tasks_for_owner(input_owner_user_id uuid,input_state text default null,input_limit integer default 20,input_before timestamptz default null)
returns jsonb language sql stable security definer set search_path=public as $$
 select case when input_owner_user_id=auth.uid() then public.app_list_portfolio_tasks(input_state,input_limit,input_before)
  when public.can_view_feature(input_owner_user_id,'tasks') then coalesce((select jsonb_agg(to_jsonb(item) order by item.updated_at desc,item.id desc) from (
   select t.id,t.kind,t.version,t.title,t.subject,t.due_date,t.timezone,t.trigger_text,t.control_state,t.research_state,t.created_at,t.updated_at,
     case when t.kind='execution' then (select jsonb_build_object('account_id',p.account_id,'instrument_id',p.instrument_id,'side',p.side,'target_quantity',p.target_quantity,
       'filled_quantity',coalesce(sum(e.quantity) filter(where e.reversed_at is null),0),'progress',case when coalesce(sum(e.quantity) filter(where e.reversed_at is null),0)=0 then 'planned' when coalesce(sum(e.quantity) filter(where e.reversed_at is null),0)<p.target_quantity then 'partial' else 'completed' end)
       from public.execution_plans p left join public.task_fill_links l on l.user_id=p.user_id and l.task_id=p.task_id left join public.trade_entries e on e.user_id=l.user_id and e.id=l.trade_entry_id where p.user_id=input_owner_user_id and p.task_id=t.id group by p.account_id,p.instrument_id,p.side,p.target_quantity) else null end execution_plan
   from public.portfolio_tasks t where t.user_id=input_owner_user_id and (input_state is null or t.research_state=input_state) and (input_before is null or t.updated_at<input_before)
   order by t.updated_at desc,t.id desc limit greatest(1,least(coalesce(input_limit,20),50))) item),'[]'::jsonb)
  else '[]'::jsonb end;
$$;

create or replace function public.app_get_portfolio_task_for_owner(input_owner_user_id uuid,input_task_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select case when input_owner_user_id=auth.uid() then public.app_get_portfolio_task(input_task_id)
  when public.can_view_feature(input_owner_user_id,'tasks') then (select to_jsonb(item) from (select t.id,t.kind,t.version,t.title,t.subject,t.due_date,t.timezone,t.trigger_text,t.control_state,t.research_state,t.created_at,t.updated_at,
    case when t.kind='execution' then (select jsonb_build_object('account_id',p.account_id,'instrument_id',p.instrument_id,'side',p.side,'target_quantity',p.target_quantity,'filled_quantity',coalesce(sum(e.quantity) filter(where e.reversed_at is null),0),'progress',case when coalesce(sum(e.quantity) filter(where e.reversed_at is null),0)=0 then 'planned' when coalesce(sum(e.quantity) filter(where e.reversed_at is null),0)<p.target_quantity then 'partial' else 'completed' end) from public.execution_plans p left join public.task_fill_links l on l.user_id=p.user_id and l.task_id=p.task_id left join public.trade_entries e on e.user_id=l.user_id and e.id=l.trade_entry_id where p.user_id=input_owner_user_id and p.task_id=t.id group by p.account_id,p.instrument_id,p.side,p.target_quantity) else null end execution_plan,
    '[]'::jsonb history,'[]'::jsonb decision_ids from public.portfolio_tasks t where t.user_id=input_owner_user_id and t.id=input_task_id) item)
  else null end;
$$;

grant execute on function public.app_list_daily_briefings_for_owner(uuid,integer,timestamptz),public.app_get_daily_briefing_for_owner(uuid,uuid),public.app_list_investment_decisions_for_owner(uuid,integer,timestamptz),public.app_get_investment_decision_for_owner(uuid,uuid),public.app_list_portfolio_tasks_for_owner(uuid,text,integer,timestamptz),public.app_get_portfolio_task_for_owner(uuid,uuid) to authenticated;
