create table public.holding_thesis_tasks(
  user_id uuid not null,thesis_id uuid not null,task_id uuid not null,created_at timestamptz not null default now(),
  primary key(thesis_id,task_id),
  foreign key(user_id,thesis_id) references public.holding_theses(user_id,id) on delete cascade,
  foreign key(user_id,task_id) references public.portfolio_tasks(user_id,id) on delete cascade
);
create table public.holding_thesis_task_receipts(
  user_id uuid not null references auth.users(id) on delete cascade,idempotency_key uuid not null,
  request_payload jsonb not null,response_payload jsonb not null,created_at timestamptz not null default now(),primary key(user_id,idempotency_key)
);
alter table public.holding_thesis_tasks enable row level security; alter table public.holding_thesis_task_receipts enable row level security;
create policy holding_thesis_tasks_owner on public.holding_thesis_tasks for select to authenticated using(user_id=auth.uid());
create policy holding_thesis_task_receipts_owner on public.holding_thesis_task_receipts for select to authenticated using(user_id=auth.uid());

alter function public.app_get_holding_thesis(bigint,bigint) rename to app_get_holding_thesis_base;
create function public.app_get_holding_thesis(input_instrument_id bigint,input_account_id bigint default null)
returns jsonb language sql stable security definer set search_path=public as $$
 select base || jsonb_build_object('related_task_ids',coalesce((select jsonb_agg(link.task_id order by link.created_at) from public.holding_thesis_tasks link where link.user_id=auth.uid() and link.thesis_id=(base#>>'{applied,id}')::uuid),'[]'::jsonb))
 from (select public.app_get_holding_thesis_base(input_instrument_id,input_account_id) base) value;
$$;
alter function public.app_list_holding_theses() rename to app_list_holding_theses_base;
create function public.app_list_holding_theses() returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(item.value||jsonb_build_object('related_task_ids',coalesce((select jsonb_agg(link.task_id order by link.created_at) from public.holding_thesis_tasks link where link.user_id=auth.uid() and link.thesis_id=(item.value->>'id')::uuid),'[]'::jsonb)) order by item.ordinality),'[]'::jsonb)
 from jsonb_array_elements(public.app_list_holding_theses_base()) with ordinality item(value,ordinality);
$$;

create or replace function public.app_link_task_to_holding_thesis(input_thesis_id uuid,input_task_id uuid,input_expected_thesis_version integer,input_expected_task_version integer,input_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_user_id uuid:=auth.uid(); request_payload jsonb; stored public.holding_thesis_task_receipts%rowtype; response_payload jsonb; selected_thesis public.holding_theses%rowtype;
begin
 if current_user_id is null then raise exception 'Authentication required'; end if;
 request_payload:=jsonb_build_object('thesis_id',input_thesis_id,'task_id',input_task_id,'expected_thesis_version',input_expected_thesis_version,'expected_task_version',input_expected_task_version);
 perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':link_task_to_holding_thesis:'||input_idempotency_key::text,0));
 select * into stored from public.holding_thesis_task_receipts where user_id=current_user_id and idempotency_key=input_idempotency_key;
 if found then if stored.request_payload<>request_payload then raise exception 'Idempotency key was already used with a different request'; end if; return stored.response_payload; end if;
 select * into selected_thesis from public.holding_theses where id=input_thesis_id and user_id=current_user_id;
 if not found then raise exception 'Holding thesis was not found'; end if;
 if selected_thesis.version<>input_expected_thesis_version then raise exception 'Holding thesis version conflict'; end if;
 if not exists(select 1 from public.portfolio_tasks where id=input_task_id and user_id=current_user_id and version=input_expected_task_version) then raise exception 'Task was not found or version conflict'; end if;
 insert into public.holding_thesis_tasks(user_id,thesis_id,task_id) values(current_user_id,input_thesis_id,input_task_id);
 response_payload:=public.app_get_holding_thesis(selected_thesis.instrument_id,selected_thesis.account_id);
 insert into public.holding_thesis_task_receipts(user_id,idempotency_key,request_payload,response_payload) values(current_user_id,input_idempotency_key,request_payload,response_payload);
 return response_payload;
end;
$$;
revoke execute on function public.app_get_holding_thesis_base(bigint,bigint),public.app_list_holding_theses_base() from public,authenticated;
grant select on public.holding_thesis_tasks,public.holding_thesis_task_receipts to authenticated;
grant execute on function public.app_get_holding_thesis(bigint,bigint),public.app_list_holding_theses(),public.app_link_task_to_holding_thesis(uuid,uuid,integer,integer,uuid) to authenticated;
