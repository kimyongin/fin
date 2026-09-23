-- One editable record body; execution receipts and task/holding state remain
-- independent of edits to the human-readable activity.
create or replace function public.app_get_activity_without_tags(
  input_activity_id bigint,input_owner_user_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
  owns boolean:=selected_owner=auth.uid();
  tasks_allowed boolean;
  assets_allowed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if selected_owner is null then raise exception 'Owner is required'; end if;
  if not owns and not public.can_view_feature(selected_owner,'activity') then return null; end if;
  tasks_allowed:=owns or public.can_view_feature(selected_owner,'tasks');
  assets_allowed:=owns or public.can_view_feature(selected_owner,'assets');
  return (select jsonb_build_object(
    'id',event.id,'version',case when owns then event.version end,
    'title',event.title,'body',event.body,'occurred_at',event.occurred_at,
    'occurrence_on',event.occurrence_on,'created_at',event.created_at,'updated_at',event.updated_at,
    'source',event.source,
    'instrument_id',case when assets_allowed then event.instrument_id end,
    'account_id',case when assets_allowed then event.account_id end,
    'holding_id',case when assets_allowed then event.holding_id end,
    'holding_summary',case when not assets_allowed or event.holding_id is null then null else
      (select jsonb_build_object('id',holding.id,'ticker',holding.ticker,
        'account_name',account.name,'display_name',coalesce(instrument.display_name,holding.ticker))
       from public.holdings holding
       join public.accounts account on account.id=holding.account_id and account.user_id=holding.user_id
       left join public.instruments instrument on instrument.user_id=holding.user_id and instrument.ticker=holding.ticker
       where holding.id=event.holding_id and holding.user_id=event.user_id) end,
    'task_id',case when tasks_allowed then event.task_id end,
    'origin_task',case when not tasks_allowed or event.task_id is null then null else
      (select jsonb_build_object('id',task.id,'title',task.title,'kind',task.kind,
        'trigger_text',task.trigger_text,'due_date',task.due_date,
        'recurrence_kind',task.recurrence_kind,'recurrence_start_on',task.recurrence_start_on)
       from public.portfolio_tasks task where task.id=event.task_id and task.user_id=event.user_id) end,
    'editable_fields',case when owns then jsonb_build_array('title','body','occurred_at','instrument_id','account_id','holding_id','task_id') else '[]'::jsonb end,
    'action_type',case when owns then event.action_type end,
    'before_data',case when owns then event.before_data end,
    'after_data',case when owns then event.after_data end
  ) from public.activity_events event
  where event.id=input_activity_id and event.user_id=selected_owner and event.status='succeeded');
end;
$$;

create or replace function public.app_create_activity(input_idempotency_key uuid,input_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  receipt public.activity_mutation_receipts%rowtype;
  title_text text;
  body_text text;
  authored_via text;
  timezone_name text;
  event_at timestamptz;
  selected_task uuid;
  selected_holding bigint;
  selected_instrument bigint;
  selected_account bigint;
  holding_row public.holdings%rowtype;
  event_id bigint;
  request_payload jsonb;
  response_payload jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if jsonb_typeof(input_payload)<>'object' then raise exception 'Activity payload must be an object'; end if;
  if exists(select 1 from jsonb_object_keys(input_payload) as field(name)
    where field.name not in ('title','body','occurred_at','timezone','task_id','holding_id',
      'instrument_id','account_id','authored_via','tag_ids')) then
    raise exception 'Unsupported activity field; update your tool contract';
  end if;
  title_text:=nullif(trim(coalesce(input_payload->>'title','')),'');
  body_text:=nullif(trim(coalesce(input_payload->>'body','')),'');
  authored_via:=coalesce(input_payload->>'authored_via','agent');
  timezone_name:=coalesce(input_payload->>'timezone','Asia/Seoul');
  event_at:=coalesce(nullif(input_payload->>'occurred_at','')::timestamptz,clock_timestamp());
  selected_task:=nullif(input_payload->>'task_id','')::uuid;
  selected_holding:=nullif(input_payload->>'holding_id','')::bigint;
  selected_instrument:=nullif(input_payload->>'instrument_id','')::bigint;
  selected_account:=nullif(input_payload->>'account_id','')::bigint;
  if title_text is null or char_length(title_text)>500 then raise exception 'Activity title is required and must be at most 500 characters'; end if;
  if body_text is not null and char_length(body_text)>25000 then raise exception 'Activity body is too long'; end if;
  if authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
  if not exists(select 1 from pg_timezone_names where name=timezone_name) then raise exception 'Invalid timezone'; end if;
  if event_at>clock_timestamp()+interval '5 minutes' then raise exception 'Activity cannot be in the future'; end if;
  if selected_task is not null and not exists(select 1 from public.portfolio_tasks task where task.id=selected_task and task.user_id=owner_id) then
    raise exception 'Task reference not found';
  end if;
  if selected_holding is not null then
    select * into holding_row from public.holdings h where h.id=selected_holding and h.user_id=owner_id;
    if not found then raise exception 'Holding reference not found'; end if;
    if selected_account is not null and selected_account<>holding_row.account_id then raise exception 'Holding account mismatch'; end if;
    selected_account:=holding_row.account_id;
    if selected_instrument is not null and not exists(select 1 from public.instruments i
      where i.id=selected_instrument and i.user_id=owner_id and i.ticker=holding_row.ticker) then
      raise exception 'Holding instrument mismatch';
    end if;
    if selected_instrument is null then
      select i.id into selected_instrument from public.instruments i
      where i.user_id=owner_id and i.ticker=holding_row.ticker;
    end if;
  end if;
  if selected_instrument is not null and not exists(select 1 from public.instruments i where i.id=selected_instrument and i.user_id=owner_id) then
    raise exception 'Instrument reference not found';
  end if;
  if selected_account is not null and not exists(select 1 from public.accounts a where a.id=selected_account and a.user_id=owner_id) then
    raise exception 'Account reference not found';
  end if;
  request_payload:=jsonb_build_object('payload',input_payload);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':create_activity:'||input_idempotency_key::text,0));
  select * into receipt from public.activity_mutation_receipts
  where user_id=owner_id and operation='create_activity' and idempotency_key=input_idempotency_key;
  if found then
    if receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;
  insert into public.activity_events(user_id,source,action_type,target_table,after_data,status,
    occurred_at,occurrence_on,title,body,task_id,holding_id,instrument_id,account_id,updated_at)
  values(owner_id,case when authored_via='app' then 'user' else 'agent' end,
    'record_manual_activity','manual_activities',jsonb_build_object('title',title_text,'body',body_text),
    'succeeded',event_at,(event_at at time zone timezone_name)::date,title_text,body_text,
    selected_task,selected_holding,selected_instrument,selected_account,clock_timestamp())
  returning id into event_id;
  response_payload:=public.app_get_activity(event_id,null);
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
  values(owner_id,'create_activity',input_idempotency_key,request_payload,response_payload);
  return response_payload;
end;
$$;

create or replace function public.app_update_activity(
  input_activity_id bigint,input_expected_version integer,input_idempotency_key uuid,
  input_patch jsonb,input_authored_via text default 'agent'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  event public.activity_events%rowtype;
  receipt public.activity_mutation_receipts%rowtype;
  request_payload jsonb;
  response_payload jsonb;
  next_title text;
  next_body text;
  next_occurred_at timestamptz;
  timezone_name text;
  next_task uuid;
  next_holding bigint;
  next_instrument bigint;
  next_account bigint;
  holding_row public.holdings%rowtype;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_expected_version is null or input_expected_version<1 then raise exception 'Expected version is required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if jsonb_typeof(input_patch)<>'object' or input_patch='{}'::jsonb then raise exception 'Activity patch must be a nonempty object'; end if;
  if input_authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
  if exists(select 1 from jsonb_object_keys(input_patch) as field(name)
    where field.name not in ('title','body','occurred_at','timezone','task_id','holding_id','instrument_id','account_id')) then
    raise exception 'Unsupported activity field; update your tool contract';
  end if;
  request_payload:=jsonb_build_object('activity_id',input_activity_id,'expected_version',input_expected_version,
    'patch',input_patch,'authored_via',input_authored_via);
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':update_activity:'||input_idempotency_key::text,0));
  select * into receipt from public.activity_mutation_receipts
  where user_id=owner_id and operation='update_activity' and idempotency_key=input_idempotency_key;
  if found then
    if receipt.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if;
    return receipt.response_payload;
  end if;
  select * into event from public.activity_events e
  where e.id=input_activity_id and e.user_id=owner_id and e.status='succeeded' for update;
  if not found then raise exception 'Activity was not found'; end if;
  if event.version<>input_expected_version then raise exception 'Activity version conflict'; end if;
  next_title:=case when input_patch?'title' then nullif(trim(coalesce(input_patch->>'title','')),'')
    else coalesce(event.title,nullif(event.after_data->>'title',''),'기록') end;
  next_body:=case when input_patch?'body' then nullif(trim(coalesce(input_patch->>'body','')),'') else event.body end;
  timezone_name:=coalesce(input_patch->>'timezone','Asia/Seoul');
  next_occurred_at:=case when input_patch?'occurred_at' then (input_patch->>'occurred_at')::timestamptz else event.occurred_at end;
  next_task:=case when input_patch?'task_id' then nullif(input_patch->>'task_id','')::uuid else event.task_id end;
  next_holding:=case when input_patch?'holding_id' then nullif(input_patch->>'holding_id','')::bigint else event.holding_id end;
  next_instrument:=case when input_patch?'instrument_id' then nullif(input_patch->>'instrument_id','')::bigint else event.instrument_id end;
  next_account:=case when input_patch?'account_id' then nullif(input_patch->>'account_id','')::bigint else event.account_id end;
  if next_title is null or char_length(next_title)>500 then raise exception 'Activity title is required and must be at most 500 characters'; end if;
  if next_body is not null and char_length(next_body)>25000 then raise exception 'Activity body is too long'; end if;
  if not exists(select 1 from pg_timezone_names where name=timezone_name) then raise exception 'Invalid timezone'; end if;
  if next_occurred_at is null or next_occurred_at>clock_timestamp()+interval '5 minutes' then raise exception 'Activity cannot be in the future'; end if;
  if next_task is not null and not exists(select 1 from public.portfolio_tasks task where task.id=next_task and task.user_id=owner_id) then
    raise exception 'Task reference not found';
  end if;
  if next_holding is not null then
    select * into holding_row from public.holdings h where h.id=next_holding and h.user_id=owner_id;
    if not found then raise exception 'Holding reference not found'; end if;
    if input_patch?'account_id' and next_account is not null and next_account<>holding_row.account_id then raise exception 'Holding account mismatch'; end if;
    next_account:=holding_row.account_id;
    if input_patch?'instrument_id' and next_instrument is not null and not exists(select 1 from public.instruments i
      where i.id=next_instrument and i.user_id=owner_id and i.ticker=holding_row.ticker) then
      raise exception 'Holding instrument mismatch';
    end if;
    select i.id into next_instrument from public.instruments i where i.user_id=owner_id and i.ticker=holding_row.ticker;
  end if;
  if next_instrument is not null and not exists(select 1 from public.instruments i where i.id=next_instrument and i.user_id=owner_id) then
    raise exception 'Instrument reference not found';
  end if;
  if next_account is not null and not exists(select 1 from public.accounts a where a.id=next_account and a.user_id=owner_id) then
    raise exception 'Account reference not found';
  end if;
  update public.activity_events set title=next_title,body=next_body,occurred_at=next_occurred_at,
    occurrence_on=case when input_patch?'occurred_at' then (next_occurred_at at time zone timezone_name)::date else event.occurrence_on end,
    task_id=next_task,holding_id=next_holding,instrument_id=next_instrument,account_id=next_account,
    after_data=case when event.action_type='record_manual_activity' then jsonb_build_object('title',next_title,'body',next_body) else event.after_data end,
    version=version+1,updated_at=clock_timestamp()
  where id=event.id and user_id=owner_id;
  response_payload:=public.app_get_activity(event.id,null);
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
  values(owner_id,'update_activity',input_idempotency_key,request_payload,response_payload);
  return response_payload;
end;
$$;
