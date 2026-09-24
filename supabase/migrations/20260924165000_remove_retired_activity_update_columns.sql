create or replace function public.app_update_activity(
  input_activity_id bigint,input_expected_version integer,input_idempotency_key uuid,
  input_patch jsonb,input_authored_via text default 'app'
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
  next_instrument bigint;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_expected_version is null or input_expected_version<1 then raise exception 'Expected version is required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if jsonb_typeof(input_patch)<>'object' or input_patch='{}'::jsonb then raise exception 'Activity patch must be a nonempty object'; end if;
  if input_authored_via not in ('app','agent') then raise exception 'Invalid authored_via'; end if;
  if exists(select 1 from jsonb_object_keys(input_patch) as field(name)
    where field.name not in ('title','body','occurred_at','timezone','task_id','instrument_id')) then
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
  next_instrument:=case when input_patch?'instrument_id' then nullif(input_patch->>'instrument_id','')::bigint else event.instrument_id end;
  if next_title is null or char_length(next_title)>500 then raise exception 'Activity title is required and must be at most 500 characters'; end if;
  if next_body is not null and char_length(next_body)>25000 then raise exception 'Activity body is too long'; end if;
  if not exists(select 1 from pg_timezone_names where name=timezone_name) then raise exception 'Invalid timezone'; end if;
  if next_occurred_at is null or next_occurred_at>clock_timestamp()+interval '5 minutes' then raise exception 'Activity cannot be in the future'; end if;
  if next_task is not null and not exists(select 1 from public.portfolio_tasks task where task.id=next_task and task.user_id=owner_id) then
    raise exception 'Task reference not found';
  end if;
  if next_instrument is not null and not exists(select 1 from public.instruments i where i.id=next_instrument and i.user_id=owner_id) then
    raise exception 'Instrument reference not found';
  end if;
  update public.activity_events set title=next_title,body=next_body,occurred_at=next_occurred_at,
    occurrence_on=case when input_patch?'occurred_at' then (next_occurred_at at time zone timezone_name)::date else event.occurrence_on end,
    task_id=next_task,instrument_id=next_instrument,
    after_data=case when event.action_type='record_manual_activity' then jsonb_build_object('title',next_title,'body',next_body) else event.after_data end,
    version=version+1,updated_at=clock_timestamp()
  where id=event.id and user_id=owner_id;
  response_payload:=public.app_get_activity(event.id,null);
  insert into public.activity_mutation_receipts(user_id,operation,idempotency_key,request_payload,response_payload)
  values(owner_id,'update_activity',input_idempotency_key,request_payload,response_payload);
  return response_payload;
end;
$$;
