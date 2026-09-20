create table public.execution_plans (
    task_id uuid primary key,
    user_id uuid not null,
    account_id bigint not null,
    instrument_id bigint not null,
    side text not null check (side in ('buy', 'sell')),
    target_quantity numeric(38,16) not null check (target_quantity > 0),
    created_at timestamptz not null default now(),
    foreign key (user_id, task_id) references public.portfolio_tasks(user_id, id) on delete cascade,
    foreign key (account_id) references public.accounts(id) on delete restrict,
    foreign key (instrument_id) references public.instruments(id) on delete restrict
);

create table public.task_fill_links (
    user_id uuid not null,
    task_id uuid not null,
    trade_entry_id uuid not null,
    linked_at timestamptz not null default now(),
    primary key (user_id, task_id, trade_entry_id),
    unique (user_id, trade_entry_id),
    foreign key (user_id, task_id) references public.portfolio_tasks(user_id, id) on delete cascade,
    foreign key (user_id, trade_entry_id) references public.trade_entries(user_id, id) on delete restrict
);

alter table public.execution_plans enable row level security;
alter table public.task_fill_links enable row level security;
create policy execution_plans_select_own on public.execution_plans for select to authenticated using (user_id = auth.uid());
create policy task_fill_links_select_own on public.task_fill_links for select to authenticated using (user_id = auth.uid());

create or replace function public.app_execution_plan_summary(input_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select case when plan.task_id is null then null else jsonb_build_object(
        'account_id', plan.account_id,
        'instrument_id', plan.instrument_id,
        'side', plan.side,
        'target_quantity', plan.target_quantity,
        'filled_quantity', coalesce(fills.filled_quantity, 0),
        'remaining_quantity', greatest(plan.target_quantity - coalesce(fills.filled_quantity, 0), 0),
        'overfilled_quantity', greatest(coalesce(fills.filled_quantity, 0) - plan.target_quantity, 0),
        'progress', case
            when coalesce(fills.filled_quantity, 0) = 0 then 'planned'
            when coalesce(fills.filled_quantity, 0) < plan.target_quantity then 'partial'
            else 'completed'
        end,
        'trade_entry_ids', coalesce(fills.trade_entry_ids, '[]'::jsonb)
    ) end
    from public.execution_plans plan
    left join lateral (
        select sum(entry.quantity) as filled_quantity,
               jsonb_agg(entry.id order by entry.executed_on, entry.sequence_no) as trade_entry_ids
        from public.task_fill_links link
        join public.trade_entries entry on entry.user_id = link.user_id and entry.id = link.trade_entry_id
        where link.user_id = auth.uid() and link.task_id = plan.task_id and entry.reversed_at is null
    ) fills on true
    where plan.task_id = input_task_id and plan.user_id = auth.uid();
$$;

alter function public.app_get_portfolio_task(uuid) rename to app_get_portfolio_task_base;
create function public.app_get_portfolio_task(input_task_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
    select case when base is null then null
        else base || jsonb_build_object('execution_plan', public.app_execution_plan_summary(input_task_id)) end
    from (select public.app_get_portfolio_task_base(input_task_id) base) value;
$$;

alter function public.app_list_portfolio_tasks(text, integer, timestamptz) rename to app_list_portfolio_tasks_base;
create function public.app_list_portfolio_tasks(input_state text default null, input_limit integer default 20, input_before timestamptz default null)
returns jsonb language sql stable security definer set search_path = public as $$
    select coalesce(jsonb_agg(item.value || jsonb_build_object(
        'execution_plan', public.app_execution_plan_summary((item.value ->> 'id')::uuid)
    ) order by item.ordinality), '[]'::jsonb)
    from jsonb_array_elements(public.app_list_portfolio_tasks_base(input_state, input_limit, input_before))
         with ordinality item(value, ordinality);
$$;

create or replace function public.app_save_execution_task(
    input_expected_version integer,
    input_idempotency_key uuid,
    input_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid(); stored_receipt public.decision_task_mutation_receipts%rowtype;
    task_id uuid; history_id uuid; selected_task public.portfolio_tasks%rowtype;
    account_id bigint; instrument_id bigint; normalized_side text; target_quantity numeric(38,16);
    response_payload jsonb; authored_channel text; request_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if coalesce(jsonb_typeof(input_payload), 'null') <> 'object' then raise exception 'Execution task payload must be an object'; end if;
    request_payload := jsonb_build_object('expected_version', input_expected_version, 'payload', input_payload);
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':save_execution_task:' || input_idempotency_key::text, 0));
    select * into stored_receipt from public.decision_task_mutation_receipts receipt
    where receipt.user_id=current_user_id and receipt.operation='save_execution_task' and receipt.idempotency_key=input_idempotency_key;
    if found then
        if stored_receipt.request_payload <> request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
        return stored_receipt.response_payload;
    end if;

    account_id := (input_payload ->> 'account_id')::bigint;
    instrument_id := (input_payload ->> 'instrument_id')::bigint;
    normalized_side := lower(trim(coalesce(input_payload ->> 'side','')));
    target_quantity := (input_payload ->> 'target_quantity')::numeric;
    authored_channel := trim(coalesce(input_payload ->> 'authored_via','agent'));
    if normalized_side not in ('buy','sell') then raise exception 'Execution side must be buy or sell'; end if;
    if target_quantity is null or target_quantity <= 0 or scale(target_quantity)>16 then raise exception 'Target quantity must be positive with at most 16 decimal places'; end if;
    if authored_channel not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
    if char_length(trim(coalesce(input_payload ->> 'title',''))) not between 1 and 500 then raise exception 'Execution task title is required'; end if;
    if not exists(select 1 from public.accounts where id=account_id and user_id=current_user_id) then raise exception 'Account was not found or is not accessible'; end if;
    if not exists(select 1 from public.instruments where id=instrument_id and user_id=current_user_id and instrument_type='market') then raise exception 'Market instrument was not found or is not accessible'; end if;

    if nullif(input_payload ->> 'task_id','') is null then
        if input_expected_version is not null then raise exception 'New execution task must not have an expected version'; end if;
        task_id := gen_random_uuid();
        insert into public.portfolio_tasks(id,user_id,kind,title,subject,due_date,timezone,trigger_text,control_state,research_state)
        values(task_id,current_user_id,'execution',trim(input_payload->>'title'),jsonb_build_object('kind','position','account_id',account_id,'instrument_id',instrument_id),
               nullif(input_payload->>'due_date','')::date,trim(coalesce(input_payload->>'timezone','Asia/Seoul')),nullif(trim(input_payload->>'trigger_text'),''),'active',null);
        insert into public.execution_plans(task_id,user_id,account_id,instrument_id,side,target_quantity)
        values(task_id,current_user_id,account_id,instrument_id,normalized_side,target_quantity);
        insert into public.portfolio_task_history(user_id,task_id,version,control_state,research_state,content_snapshot,change_reason,authored_via)
        values(current_user_id,task_id,1,'active',null,input_payload - 'authored_via','Execution plan created',authored_channel) returning id into history_id;
        update public.portfolio_tasks set current_history_id=history_id where id=task_id;
    else
        task_id := (input_payload ->> 'task_id')::uuid;
        select * into selected_task from public.portfolio_tasks where id=task_id and user_id=current_user_id for update;
        if not found or selected_task.kind <> 'execution' then raise exception 'Execution task was not found'; end if;
        if input_expected_version is null or selected_task.version <> input_expected_version then raise exception 'Task version conflict'; end if;
        if exists(select 1 from public.task_fill_links where user_id=current_user_id and task_id=task_id) and
           exists(select 1 from public.task_fill_links link join public.trade_entries entry on entry.id=link.trade_entry_id and entry.user_id=link.user_id
                  where link.user_id=current_user_id and link.task_id=task_id and (entry.account_id<>account_id or entry.instrument_id<>instrument_id or entry.side<>normalized_side))
        then raise exception 'Updated plan conflicts with linked trades'; end if;
        update public.portfolio_tasks set version=version+1,title=trim(input_payload->>'title'),
            subject=jsonb_build_object('kind','position','account_id',account_id,'instrument_id',instrument_id),
            due_date=nullif(input_payload->>'due_date','')::date,trigger_text=nullif(trim(input_payload->>'trigger_text'),''),updated_at=clock_timestamp()
        where id=task_id;
        update public.execution_plans plan set account_id=app_save_execution_task.account_id,
            instrument_id=app_save_execution_task.instrument_id,side=normalized_side,target_quantity=app_save_execution_task.target_quantity
        where plan.task_id=app_save_execution_task.task_id and plan.user_id=current_user_id;
        insert into public.portfolio_task_history(user_id,task_id,version,control_state,research_state,content_snapshot,change_reason,authored_via)
        values(current_user_id,task_id,selected_task.version+1,selected_task.control_state,null,input_payload-'authored_via',coalesce(nullif(trim(input_payload->>'change_reason'),''),'Execution plan updated'),authored_channel) returning id into history_id;
        update public.portfolio_tasks set current_history_id=history_id where id=task_id;
    end if;
    insert into public.activity_events(user_id,source,action_type,target_table,target_id,after_data,status)
    values(current_user_id,case when authored_channel='app' then 'user' else 'agent' end,'save_execution_task','portfolio_tasks',task_id::text,public.app_execution_plan_summary(task_id),'succeeded');
    response_payload := public.app_get_portfolio_task(task_id);
    insert into public.decision_task_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(current_user_id,'save_execution_task',input_idempotency_key,request_payload,response_payload);
    return response_payload;
end;
$$;

create or replace function public.app_link_trade_to_task(
    input_trade_entry_id uuid,
    input_task_id uuid,
    input_expected_task_version integer,
    input_idempotency_key uuid,
    input_authored_via text default 'agent'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare current_user_id uuid:=auth.uid(); selected_task public.portfolio_tasks%rowtype; selected_trade public.trade_entries%rowtype;
    selected_plan public.execution_plans%rowtype; stored_receipt public.decision_task_mutation_receipts%rowtype; request_payload jsonb; response_payload jsonb;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    request_payload:=jsonb_build_object('trade_entry_id',input_trade_entry_id,'task_id',input_task_id,'expected_task_version',input_expected_task_version,'authored_via',input_authored_via);
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':link_trade_to_task:'||input_idempotency_key::text,0));
    select * into stored_receipt from public.decision_task_mutation_receipts where user_id=current_user_id and operation='link_trade_to_task' and idempotency_key=input_idempotency_key;
    if found then if stored_receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if; return stored_receipt.response_payload; end if;
    select * into selected_task from public.portfolio_tasks where id=input_task_id and user_id=current_user_id for update;
    if not found or selected_task.kind<>'execution' then raise exception 'Execution task was not found'; end if;
    if selected_task.version<>input_expected_task_version then raise exception 'Task version conflict'; end if;
    select * into selected_plan from public.execution_plans where task_id=input_task_id and user_id=current_user_id;
    select * into selected_trade from public.trade_entries where id=input_trade_entry_id and user_id=current_user_id;
    if not found then raise exception 'Trade entry was not found'; end if;
    if selected_trade.reversed_at is not null then raise exception 'A reversed trade cannot be linked'; end if;
    if selected_trade.account_id<>selected_plan.account_id or selected_trade.instrument_id<>selected_plan.instrument_id or selected_trade.side<>selected_plan.side then raise exception 'Trade does not match the execution plan'; end if;
    insert into public.task_fill_links(user_id,task_id,trade_entry_id) values(current_user_id,input_task_id,input_trade_entry_id);
    response_payload:=public.app_get_portfolio_task(input_task_id);
    insert into public.decision_task_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(current_user_id,'link_trade_to_task',input_idempotency_key,request_payload,response_payload);
    return response_payload;
end;
$$;

create or replace function public.app_transition_execution_task(
    input_task_id uuid, input_expected_version integer, input_action text,
    input_reason text, input_idempotency_key uuid, input_authored_via text default 'agent'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_user_id uuid:=auth.uid(); selected_task public.portfolio_tasks%rowtype;
    stored_receipt public.decision_task_mutation_receipts%rowtype; request_payload jsonb; response_payload jsonb;
    next_control_state text; history_id uuid;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    request_payload:=jsonb_build_object('task_id',input_task_id,'expected_version',input_expected_version,'action',input_action,'reason',input_reason,'authored_via',input_authored_via);
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':transition_execution_task:'||input_idempotency_key::text,0));
    select * into stored_receipt from public.decision_task_mutation_receipts where user_id=current_user_id and operation='transition_execution_task' and idempotency_key=input_idempotency_key;
    if found then if stored_receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if; return stored_receipt.response_payload; end if;
    select * into selected_task from public.portfolio_tasks where id=input_task_id and user_id=current_user_id for update;
    if not found or selected_task.kind<>'execution' then raise exception 'Execution task was not found'; end if;
    if selected_task.version<>input_expected_version then raise exception 'Task version conflict'; end if;
    if nullif(trim(coalesce(input_reason,'')),'') is null then raise exception 'Execution task transition needs a reason'; end if;
    next_control_state:=case lower(trim(input_action))
      when 'pause' then 'paused' when 'resume' then 'active' when 'cancel' then 'cancelled' else null end;
    if next_control_state is null then raise exception 'Invalid execution task transition'; end if;
    if next_control_state=selected_task.control_state then raise exception 'Execution task is already in that state'; end if;
    if selected_task.control_state='cancelled' then raise exception 'A cancelled execution task cannot be resumed'; end if;
    if next_control_state='active' and selected_task.control_state<>'paused' then raise exception 'Only a paused execution task can resume'; end if;
    update public.portfolio_tasks set version=version+1,control_state=next_control_state,updated_at=clock_timestamp() where id=input_task_id;
    insert into public.portfolio_task_history(user_id,task_id,version,control_state,research_state,content_snapshot,change_reason,authored_via)
    select current_user_id,selected_task.id,selected_task.version+1,next_control_state,null,
      jsonb_build_object('title',selected_task.title,'subject',selected_task.subject,'due_date',selected_task.due_date,'trigger_text',selected_task.trigger_text,'execution_plan',public.app_execution_plan_summary(selected_task.id)),
      trim(input_reason),input_authored_via returning id into history_id;
    update public.portfolio_tasks set current_history_id=history_id where id=input_task_id;
    response_payload:=public.app_get_portfolio_task(input_task_id);
    insert into public.decision_task_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
    values(current_user_id,'transition_execution_task',input_idempotency_key,request_payload,response_payload);
    return response_payload;
end;
$$;

revoke execute on function public.app_get_portfolio_task_base(uuid) from public, authenticated;
revoke execute on function public.app_list_portfolio_tasks_base(text,integer,timestamptz) from public, authenticated;
grant select on public.execution_plans, public.task_fill_links to authenticated;
grant execute on function public.app_execution_plan_summary(uuid), public.app_get_portfolio_task(uuid), public.app_list_portfolio_tasks(text,integer,timestamptz), public.app_save_execution_task(integer,uuid,jsonb), public.app_link_trade_to_task(uuid,uuid,integer,uuid,text), public.app_transition_execution_task(uuid,integer,text,text,uuid,text) to authenticated;
