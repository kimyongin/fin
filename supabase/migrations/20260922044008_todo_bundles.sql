create table public.todo_bundles (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    title text not null check (char_length(trim(title)) between 1 and 500),
    summary text check (summary is null or char_length(trim(summary)) between 1 and 4000),
    tags text[] not null default '{}',
    version integer not null default 1 check (version > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, id)
);

create table public.todo_items (
    id uuid primary key default gen_random_uuid(),
    bundle_id uuid not null,
    user_id uuid not null,
    sort_order integer not null check (sort_order >= 0),
    kind text not null check (kind in ('general', 'task')),
    title text,
    status text check (status in ('open', 'done', 'cancelled', 'paused')),
    result text check (result is null or char_length(trim(result)) between 1 and 4000),
    performed_at timestamptz,
    task_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, bundle_id, id),
    unique (task_id),
    foreign key (user_id, bundle_id) references public.todo_bundles(user_id, id) on delete cascade,
    foreign key (user_id, task_id) references public.portfolio_tasks(user_id, id) on delete restrict,
    constraint todo_items_shape check (
        (kind = 'general' and task_id is null and status is not null and char_length(trim(title)) between 1 and 500)
        or (kind = 'task' and task_id is not null and status is null and title is null and result is null and performed_at is null)
    )
);

create table public.todo_bundle_rule_links (
    bundle_id uuid not null,
    user_id uuid not null,
    rule_id uuid not null,
    rule_snapshot jsonb not null check (jsonb_typeof(rule_snapshot) = 'object'),
    primary key (bundle_id, rule_id),
    foreign key (user_id, bundle_id) references public.todo_bundles(user_id, id) on delete cascade,
    foreign key (rule_id) references public.operating_rules(id) on delete restrict
);

create table public.todo_bundle_decision_links (
    bundle_id uuid not null,
    user_id uuid not null,
    decision_id uuid not null,
    primary key (bundle_id, decision_id),
    foreign key (user_id, bundle_id) references public.todo_bundles(user_id, id) on delete cascade,
    foreign key (user_id, decision_id) references public.investment_decisions(user_id, id) on delete restrict
);

create table public.todo_bundle_verification_links (
    bundle_id uuid not null,
    user_id uuid not null,
    verification_id uuid not null,
    primary key (bundle_id, verification_id),
    foreign key (user_id, bundle_id) references public.todo_bundles(user_id, id) on delete cascade,
    foreign key (verification_id) references public.holding_verifications(id) on delete restrict
);

create table public.todo_bundle_mutation_receipts (
    user_id uuid not null references auth.users(id) on delete cascade,
    idempotency_key uuid not null,
    request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
    response_payload jsonb not null check (jsonb_typeof(response_payload) = 'object'),
    created_at timestamptz not null default now(),
    primary key (user_id, idempotency_key)
);

create index todo_bundles_user_updated_idx on public.todo_bundles(user_id, updated_at desc, id desc);
create index todo_items_bundle_order_idx on public.todo_items(user_id, bundle_id, sort_order, id);

alter table public.todo_bundles enable row level security;
alter table public.todo_items enable row level security;
alter table public.todo_bundle_rule_links enable row level security;
alter table public.todo_bundle_decision_links enable row level security;
alter table public.todo_bundle_verification_links enable row level security;
alter table public.todo_bundle_mutation_receipts enable row level security;

create policy todo_bundles_select_own on public.todo_bundles for select to authenticated using (user_id = auth.uid());
create policy todo_items_select_own on public.todo_items for select to authenticated using (user_id = auth.uid());
create policy todo_bundle_rule_links_select_own on public.todo_bundle_rule_links for select to authenticated using (user_id = auth.uid());
create policy todo_bundle_decision_links_select_own on public.todo_bundle_decision_links for select to authenticated using (user_id = auth.uid());
create policy todo_bundle_verification_links_select_own on public.todo_bundle_verification_links for select to authenticated using (user_id = auth.uid());
create policy todo_bundle_mutation_receipts_select_own on public.todo_bundle_mutation_receipts for select to authenticated using (user_id = auth.uid());

create or replace function public.app_todo_item_json(input_item public.todo_items)
returns jsonb language sql stable security definer set search_path = public as $$
    select case when input_item.kind = 'general' then jsonb_build_object(
        'id', input_item.id, 'kind', 'general', 'sort_order', input_item.sort_order,
        'title', input_item.title, 'status', input_item.status, 'result', input_item.result,
        'performed_at', input_item.performed_at, 'created_at', input_item.created_at, 'updated_at', input_item.updated_at
    ) else jsonb_build_object(
        'id', input_item.id, 'kind', 'task', 'sort_order', input_item.sort_order,
        'task_id', input_item.task_id, 'task', public.app_get_portfolio_task(input_item.task_id),
        'created_at', input_item.created_at, 'updated_at', input_item.updated_at
    ) end;
$$;

create or replace function public.app_todo_bundle_status(input_bundle_id uuid)
returns text language sql stable security definer set search_path = public as $$
    with states as (
        select case
            when item.kind = 'general' then item.status
            when task.control_state = 'cancelled' then 'cancelled'
            when task.control_state = 'paused' then 'paused'
            when task.kind = 'research' and task.research_state in ('resolved', 'closed') then 'done'
            when task.kind = 'execution' and coalesce(public.app_execution_plan_summary(task.id) ->> 'progress', '') = 'completed' then 'done'
            else 'open'
        end state
        from public.todo_items item
        left join public.portfolio_tasks task on task.id = item.task_id and task.user_id = item.user_id
        where item.bundle_id = input_bundle_id and item.user_id = auth.uid()
    )
    select case
        when count(*) = 0 then 'empty'
        when count(*) filter (where state = 'open') > 0 then 'in_progress'
        when count(*) filter (where state = 'paused') > 0
             and count(*) filter (where state not in ('paused', 'done', 'cancelled')) = 0 then 'paused'
        when count(*) filter (where state = 'cancelled') = count(*) then 'cancelled'
        else 'completed'
    end from states;
$$;

create or replace function public.app_get_todo_bundle(input_bundle_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
    select jsonb_build_object(
        'id', bundle.id, 'title', bundle.title, 'summary', bundle.summary, 'tags', to_jsonb(bundle.tags),
        'version', bundle.version, 'status', public.app_todo_bundle_status(bundle.id),
        'created_at', bundle.created_at, 'updated_at', bundle.updated_at,
        'items', coalesce((select jsonb_agg(public.app_todo_item_json(item) order by item.sort_order, item.id)
            from public.todo_items item where item.user_id = auth.uid() and item.bundle_id = bundle.id), '[]'::jsonb),
        'rules', coalesce((select jsonb_agg(link.rule_snapshot order by link.rule_id)
            from public.todo_bundle_rule_links link where link.user_id = auth.uid() and link.bundle_id = bundle.id), '[]'::jsonb),
        'decision_ids', coalesce((select jsonb_agg(link.decision_id order by link.decision_id)
            from public.todo_bundle_decision_links link where link.user_id = auth.uid() and link.bundle_id = bundle.id), '[]'::jsonb),
        'verification_ids', coalesce((select jsonb_agg(link.verification_id order by link.verification_id)
            from public.todo_bundle_verification_links link where link.user_id = auth.uid() and link.bundle_id = bundle.id), '[]'::jsonb)
    )
    from public.todo_bundles bundle
    where bundle.id = input_bundle_id and bundle.user_id = auth.uid();
$$;

create or replace function public.app_list_todo_bundles(
    input_filter text default 'active', input_limit integer default 20, input_cursor jsonb default null
)
returns jsonb language sql stable security definer set search_path = public as $$
    with candidates as (
        select bundle.*, public.app_todo_bundle_status(bundle.id) as derived_status
        from public.todo_bundles bundle
        where bundle.user_id = auth.uid()
          and (input_cursor is null or (bundle.updated_at, bundle.id) < ((input_cursor ->> 'updated_at')::timestamptz, (input_cursor ->> 'id')::uuid))
    ), filtered as (
        select * from candidates
        where input_filter = 'all'
           or (input_filter = 'active' and derived_status in ('in_progress', 'paused'))
           or (input_filter = 'completed' and derived_status = 'completed')
           or (input_filter = 'cancelled' and derived_status = 'cancelled')
        order by updated_at desc, id desc limit least(greatest(coalesce(input_limit, 20), 1), 100) + 1
    ), page as (select * from filtered limit least(greatest(coalesce(input_limit, 20), 1), 100))
    select jsonb_build_object(
        'items', coalesce((select jsonb_agg(jsonb_build_object(
            'id', id, 'title', title, 'summary', summary, 'tags', to_jsonb(tags), 'version', version,
            'status', derived_status, 'item_count', (select count(*) from public.todo_items item where item.bundle_id = page.id),
            'created_at', created_at, 'updated_at', updated_at
        ) order by updated_at desc, id desc) from page), '[]'::jsonb),
        'next_cursor', case when (select count(*) from filtered) > least(greatest(coalesce(input_limit, 20), 1), 100)
            then (select jsonb_build_object('updated_at', updated_at, 'id', id) from page order by updated_at, id limit 1)
            else null end
    );
$$;

create or replace function public.app_save_todo_bundle(
    input_bundle_id uuid,
    input_expected_version integer,
    input_idempotency_key uuid,
    input_title text,
    input_summary text,
    input_tags jsonb,
    input_items jsonb,
    input_remove_item_ids jsonb default '[]'::jsonb,
    input_rule_ids jsonb default null,
    input_decision_ids jsonb default null,
    input_verification_ids jsonb default null,
    input_authored_via text default 'app'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    current_user_id uuid := auth.uid();
    current_bundle public.todo_bundles%rowtype;
    stored_receipt public.todo_bundle_mutation_receipts%rowtype;
    next_id uuid := coalesce(input_bundle_id, gen_random_uuid());
    next_version integer;
    normalized_tags text[];
    request_payload jsonb;
    response_payload jsonb;
    item_input jsonb;
    item_id uuid;
    item_kind text;
    linked_task_id uuid;
    relation_id uuid;
begin
    if current_user_id is null then raise exception 'Authentication required'; end if;
    if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
    if char_length(trim(coalesce(input_title, ''))) not between 1 and 500 then raise exception 'ToDo bundle title is required and must be at most 500 characters'; end if;
    if input_summary is not null and char_length(trim(input_summary)) not between 1 and 4000 then raise exception 'ToDo bundle summary must be at most 4000 characters'; end if;
    if input_authored_via not in ('app', 'agent') then raise exception 'Invalid authored_via'; end if;
    if coalesce(jsonb_typeof(input_tags), 'null') <> 'array' or jsonb_array_length(input_tags) > 20 then raise exception 'ToDo tags must be an array with at most 20 items'; end if;
    if coalesce(jsonb_typeof(input_items), 'null') <> 'array' or jsonb_array_length(input_items) > 50 then raise exception 'ToDo items must be an array with at most 50 items'; end if;
    if coalesce(jsonb_typeof(input_remove_item_ids), 'null') <> 'array' then raise exception 'Removed ToDo item IDs must be an array'; end if;
    if input_rule_ids is not null and jsonb_typeof(input_rule_ids) <> 'array' then raise exception 'Rule IDs must be an array'; end if;
    if input_decision_ids is not null and jsonb_typeof(input_decision_ids) <> 'array' then raise exception 'Decision IDs must be an array'; end if;
    if input_verification_ids is not null and jsonb_typeof(input_verification_ids) <> 'array' then raise exception 'Verification IDs must be an array'; end if;

    select coalesce(array_agg(tag order by first_position), '{}') into normalized_tags
    from (
        select trim(value) tag, min(ordinality) first_position
        from jsonb_array_elements_text(input_tags) with ordinality values(value, ordinality)
        where trim(value) <> '' and char_length(trim(value)) <= 50
        group by trim(value)
    ) tags;
    if cardinality(normalized_tags) <> (select count(distinct trim(value)) from jsonb_array_elements_text(input_tags) value where trim(value) <> '') then
        raise exception 'Each ToDo tag must be at most 50 characters';
    end if;

    request_payload := jsonb_build_object(
        'bundle_id', input_bundle_id, 'expected_version', input_expected_version, 'title', trim(input_title),
        'summary', nullif(trim(input_summary), ''), 'tags', to_jsonb(normalized_tags), 'items', input_items,
        'remove_item_ids', input_remove_item_ids, 'rule_ids', input_rule_ids,
        'decision_ids', input_decision_ids, 'verification_ids', input_verification_ids, 'authored_via', input_authored_via
    );
    perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':todo_bundle:' || input_idempotency_key::text, 0));
    select * into stored_receipt from public.todo_bundle_mutation_receipts receipt
    where receipt.user_id = current_user_id and receipt.idempotency_key = input_idempotency_key;
    if found then
        if stored_receipt.request_payload <> request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
        return stored_receipt.response_payload;
    end if;

    if input_bundle_id is not null then
        select * into current_bundle from public.todo_bundles bundle
        where bundle.id = input_bundle_id and bundle.user_id = current_user_id for update;
        if found then
            if input_expected_version is null or input_expected_version <> current_bundle.version then raise exception 'ToDo bundle version conflict'; end if;
            next_version := current_bundle.version + 1;
        elsif input_expected_version is not null then raise exception 'ToDo bundle not found';
        else next_version := 1;
        end if;
    else
        if input_expected_version is not null then raise exception 'ToDo bundle version conflict'; end if;
        next_version := 1;
    end if;

    insert into public.todo_bundles(id, user_id, title, summary, tags, version, updated_at)
    values(next_id, current_user_id, trim(input_title), nullif(trim(input_summary), ''), normalized_tags, next_version, clock_timestamp())
    on conflict(id) do update set title=excluded.title, summary=excluded.summary, tags=excluded.tags,
        version=excluded.version, updated_at=excluded.updated_at;

    for relation_id in select value::uuid from jsonb_array_elements_text(input_remove_item_ids) value loop
        delete from public.todo_items where id = relation_id and bundle_id = next_id and user_id = current_user_id;
        if not found then raise exception 'Removed ToDo item not found'; end if;
    end loop;

    for item_input in select value from jsonb_array_elements(input_items) loop
        if jsonb_typeof(item_input) <> 'object' then raise exception 'Each ToDo item must be an object'; end if;
        item_id := coalesce(nullif(item_input ->> 'id', '')::uuid, gen_random_uuid());
        item_kind := item_input ->> 'kind';
        if item_kind not in ('general', 'task') then raise exception 'Invalid ToDo item kind'; end if;
        if item_kind = 'general' then
            if trim(coalesce(item_input ->> 'title', '')) = ''
               or coalesce(item_input ->> 'status', '') not in ('open', 'done', 'cancelled', 'paused') then
                raise exception 'General ToDo item needs a title and valid status';
            end if;
            insert into public.todo_items(id,bundle_id,user_id,sort_order,kind,title,status,result,performed_at,updated_at)
            values(item_id,next_id,current_user_id,coalesce((item_input->>'sort_order')::integer,0),'general',trim(item_input->>'title'),
                item_input->>'status',nullif(trim(item_input->>'result'),''),(item_input->>'performed_at')::timestamptz,clock_timestamp())
            on conflict(id) do update set sort_order=excluded.sort_order,title=excluded.title,status=excluded.status,
                result=excluded.result,performed_at=excluded.performed_at,updated_at=excluded.updated_at
            where todo_items.bundle_id=next_id and todo_items.user_id=current_user_id and todo_items.kind='general';
            if not found then raise exception 'ToDo item not found in this bundle'; end if;
        else
            linked_task_id := (item_input ->> 'task_id')::uuid;
            if not exists(select 1 from public.portfolio_tasks task where task.id=linked_task_id and task.user_id=current_user_id) then
                raise exception 'Linked task not found';
            end if;
            insert into public.todo_items(id,bundle_id,user_id,sort_order,kind,task_id,updated_at)
            values(item_id,next_id,current_user_id,coalesce((item_input->>'sort_order')::integer,0),'task',linked_task_id,clock_timestamp())
            on conflict(id) do update set sort_order=excluded.sort_order,task_id=excluded.task_id,updated_at=excluded.updated_at
            where todo_items.bundle_id=next_id and todo_items.user_id=current_user_id and todo_items.kind='task';
            if not found then raise exception 'ToDo item not found in this bundle'; end if;
        end if;
    end loop;

    if not exists(select 1 from public.todo_items where bundle_id=next_id and user_id=current_user_id) then raise exception 'ToDo bundle must contain at least one item'; end if;

    if input_rule_ids is not null then
        delete from public.todo_bundle_rule_links where bundle_id=next_id and user_id=current_user_id;
        for relation_id in select value::uuid from jsonb_array_elements_text(input_rule_ids) value loop
            insert into public.todo_bundle_rule_links(bundle_id,user_id,rule_id,rule_snapshot)
            select next_id,current_user_id,rule.id,public.app_operating_rule_json(rule)
            from public.operating_rules rule where rule.id=relation_id and rule.user_id=current_user_id;
            if not found then raise exception 'Linked operating rule not found'; end if;
        end loop;
    end if;
    if input_decision_ids is not null then
        delete from public.todo_bundle_decision_links where bundle_id=next_id and user_id=current_user_id;
        for relation_id in select value::uuid from jsonb_array_elements_text(input_decision_ids) value loop
            insert into public.todo_bundle_decision_links(bundle_id,user_id,decision_id)
            select next_id,current_user_id,decision.id from public.investment_decisions decision
            where decision.id=relation_id and decision.user_id=current_user_id;
            if not found then raise exception 'Linked decision not found'; end if;
        end loop;
    end if;
    if input_verification_ids is not null then
        delete from public.todo_bundle_verification_links where bundle_id=next_id and user_id=current_user_id;
        for relation_id in select value::uuid from jsonb_array_elements_text(input_verification_ids) value loop
            insert into public.todo_bundle_verification_links(bundle_id,user_id,verification_id)
            select next_id,current_user_id,verification.id from public.holding_verifications verification
            where verification.id=relation_id and verification.user_id=current_user_id;
            if not found then raise exception 'Linked verification not found'; end if;
        end loop;
    end if;

    insert into public.activity_events(user_id,source,action_type,target_table,target_id,after_data,status)
    values(current_user_id,case when input_authored_via='app' then 'user' else 'agent' end,
        'save_todo_bundle','todo_bundles',next_id::text,jsonb_build_object('version',next_version,'item_count',(select count(*) from public.todo_items where bundle_id=next_id)),'succeeded');
    response_payload := public.app_get_todo_bundle(next_id);
    insert into public.todo_bundle_mutation_receipts(user_id,idempotency_key,request_payload,response_payload)
    values(current_user_id,input_idempotency_key,request_payload,response_payload);
    return response_payload;
end;
$$;

grant select on public.todo_bundles, public.todo_items, public.todo_bundle_rule_links,
    public.todo_bundle_decision_links, public.todo_bundle_verification_links,
    public.todo_bundle_mutation_receipts to authenticated;
revoke all on function public.app_todo_item_json(public.todo_items) from public, anon, authenticated;
revoke all on function public.app_todo_bundle_status(uuid) from public, anon, authenticated;
grant execute on function public.app_get_todo_bundle(uuid) to authenticated;
grant execute on function public.app_list_todo_bundles(text, integer, jsonb) to authenticated;
grant execute on function public.app_save_todo_bundle(uuid, integer, uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text) to authenticated;
