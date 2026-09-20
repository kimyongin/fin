alter table public.trade_entries add column reversed_at timestamptz, add column reversal_reason text;

create table public.trade_reversal_previews (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 trade_id uuid not null, holding_id bigint not null references public.holdings(id) on delete cascade,
 holding_state_version bigint not null, reason text not null check(char_length(trim(reason)) between 1 and 1000),
 affects_current boolean not null, before_snapshot jsonb not null, after_snapshot jsonb not null,
 expires_at timestamptz not null, consumed_at timestamptz, created_at timestamptz not null default now(),
 unique(user_id,id), foreign key(user_id,trade_id) references public.trade_entries(user_id,id)
);
create table public.trade_reversals (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 trade_id uuid not null, preview_id uuid not null, reason text not null, affects_current boolean not null,
 before_snapshot jsonb not null, after_snapshot jsonb not null, authored_via text not null check(authored_via in('app','agent')),
 created_at timestamptz not null default now(), unique(user_id,trade_id), unique(user_id,preview_id),
 foreign key(user_id,trade_id) references public.trade_entries(user_id,id),
 foreign key(user_id,preview_id) references public.trade_reversal_previews(user_id,id)
);
create table public.trade_reversal_mutation_receipts(
 user_id uuid not null references auth.users(id) on delete cascade,idempotency_key uuid not null,request_payload jsonb not null,response_payload jsonb not null,created_at timestamptz not null default now(),primary key(user_id,idempotency_key)
);
alter table public.trade_reversal_previews enable row level security; alter table public.trade_reversals enable row level security; alter table public.trade_reversal_mutation_receipts enable row level security;
create policy trade_reversal_previews_select_own on public.trade_reversal_previews for select to authenticated using(user_id=auth.uid());
create policy trade_reversals_select_own on public.trade_reversals for select to authenticated using(user_id=auth.uid());
create policy trade_reversal_receipts_select_own on public.trade_reversal_mutation_receipts for select to authenticated using(user_id=auth.uid());

create or replace function public.calculate_trade_stream_without(input_user_id uuid,input_holding_id bigint,input_excluded_trade_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare checkpoint public.holding_reconciliations%rowtype; first_trade public.trade_entries%rowtype; item public.trade_entries%rowtype; quantity numeric(38,16); cost numeric(38,16); checkpoint_time timestamptz;
begin
 select * into checkpoint from public.holding_reconciliations where user_id=input_user_id and holding_id=input_holding_id order by created_at desc limit 1;
 if found then quantity:=(checkpoint.after_snapshot->>'quantity')::numeric; cost:=quantity*coalesce((checkpoint.after_snapshot->>'avg_price')::numeric,0); checkpoint_time:=checkpoint.created_at;
 else select * into first_trade from public.trade_entries where user_id=input_user_id and holding_id=input_holding_id order by created_at,sequence_no limit 1; if not found then raise exception 'Trade stream has no baseline'; end if; quantity:=first_trade.before_quantity; cost:=first_trade.before_cost_pool; checkpoint_time:=null; end if;
 for item in select * from public.trade_entries where user_id=input_user_id and holding_id=input_holding_id and reversed_at is null and id<>input_excluded_trade_id and (checkpoint_time is null or created_at>checkpoint_time) order by created_at,sequence_no loop
  if item.side='buy' then quantity:=quantity+item.quantity; cost:=cost+item.quantity*item.unit_price;
  else if item.quantity>quantity then raise exception 'Reversal would make a later sell exceed the recalculated holding'; end if; cost:=case when quantity-item.quantity=0 then 0 else cost*(quantity-item.quantity)/quantity end; quantity:=quantity-item.quantity; end if;
 end loop;
 return jsonb_build_object('quantity',quantity::text,'avg_price',case when quantity=0 then null else (cost/quantity)::text end,'cost_pool',cost::text);
end; $$;

create or replace function public.app_preview_trade_reversal(input_trade_id uuid,input_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_user_id uuid:=auth.uid(); trade public.trade_entries%rowtype; holding public.holdings%rowtype; latest_checkpoint timestamptz; affects boolean; before_value jsonb; after_value jsonb; saved public.trade_reversal_previews%rowtype;
begin
 if current_user_id is null then raise exception 'Authentication required'; end if; if char_length(trim(coalesce(input_reason,''))) not between 1 and 1000 then raise exception 'Reversal reason is required'; end if;
 select * into trade from public.trade_entries where id=input_trade_id and user_id=current_user_id; if not found then raise exception 'Trade was not found or is not accessible'; end if; if trade.reversed_at is not null then raise exception 'Trade was already reversed'; end if;
 select * into holding from public.holdings where id=trade.holding_id and user_id=current_user_id; select max(created_at) into latest_checkpoint from public.holding_reconciliations where user_id=current_user_id and holding_id=holding.id;
 affects:=latest_checkpoint is null or trade.created_at>latest_checkpoint;
 before_value:=jsonb_build_object('quantity',holding.ledger_quantity::text,'avg_price',case when holding.ledger_quantity=0 then null else (holding.ledger_cost_pool/holding.ledger_quantity)::text end,'cost_pool',holding.ledger_cost_pool::text);
 after_value:=case when affects then public.calculate_trade_stream_without(current_user_id,holding.id,trade.id) else before_value end;
 insert into public.trade_reversal_previews(user_id,trade_id,holding_id,holding_state_version,reason,affects_current,before_snapshot,after_snapshot,expires_at) values(current_user_id,trade.id,holding.id,holding.state_version,trim(input_reason),affects,before_value,after_value,clock_timestamp()+interval '15 minutes') returning * into saved;
 return jsonb_build_object('preview_id',saved.id,'trade_id',saved.trade_id,'expires_at',saved.expires_at,'affects_current',saved.affects_current,'before',saved.before_snapshot,'after',saved.after_snapshot,'reason',saved.reason);
end; $$;

create or replace function public.app_reverse_trade_entry(input_preview_id uuid,input_idempotency_key uuid,input_authored_via text default 'app')
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_user_id uuid:=auth.uid(); preview public.trade_reversal_previews%rowtype; trade public.trade_entries%rowtype; holding public.holdings%rowtype; saved public.trade_reversals%rowtype; receipt public.trade_reversal_mutation_receipts%rowtype; request jsonb; response jsonb;
begin
 if current_user_id is null then raise exception 'Authentication required'; end if; if input_authored_via not in('app','agent') then raise exception 'Invalid authored_via'; end if;
 request:=jsonb_build_object('preview_id',input_preview_id,'authored_via',input_authored_via); perform pg_advisory_xact_lock(hashtextextended(current_user_id::text||':reverse_trade:'||input_idempotency_key::text,0));
 select * into receipt from public.trade_reversal_mutation_receipts where user_id=current_user_id and idempotency_key=input_idempotency_key; if found then if receipt.request_payload<>request then raise exception 'Idempotency key was already used with a different request'; end if; return receipt.response_payload; end if;
 select * into preview from public.trade_reversal_previews where id=input_preview_id and user_id=current_user_id for update; if not found then raise exception 'Trade reversal preview was not found or is not accessible'; end if; if preview.consumed_at is not null then raise exception 'Trade reversal preview was already consumed'; end if; if preview.expires_at<=clock_timestamp() then raise exception 'Trade reversal preview expired'; end if;
 select * into trade from public.trade_entries where id=preview.trade_id and user_id=current_user_id for update; if trade.reversed_at is not null then raise exception 'Trade was already reversed'; end if;
 select * into holding from public.holdings where id=preview.holding_id and user_id=current_user_id for update; if holding.state_version<>preview.holding_state_version then raise exception 'Trade reversal preview is stale; create a new preview'; end if;
 if preview.affects_current then update public.holdings set ledger_quantity=(preview.after_snapshot->>'quantity')::numeric,ledger_cost_pool=(preview.after_snapshot->>'cost_pool')::numeric,updated_at=clock_timestamp() where id=holding.id returning * into holding; end if;
 update public.trade_entries set reversed_at=clock_timestamp(),reversal_reason=preview.reason where id=trade.id;
 insert into public.trade_reversals(user_id,trade_id,preview_id,reason,affects_current,before_snapshot,after_snapshot,authored_via) values(current_user_id,trade.id,preview.id,preview.reason,preview.affects_current,preview.before_snapshot,preview.after_snapshot,input_authored_via) returning * into saved;
 update public.trade_reversal_previews set consumed_at=clock_timestamp() where id=preview.id;
 insert into public.activity_events(user_id,source,action_type,target_table,target_id,before_data,after_data,status) values(current_user_id,case when input_authored_via='app' then 'user' else 'agent' end,'reverse_trade_entry','trade_reversals',saved.id::text,preview.before_snapshot,preview.after_snapshot||jsonb_build_object('affects_current',preview.affects_current),'succeeded');
 response:=jsonb_build_object('reversal_id',saved.id,'trade_id',trade.id,'affects_current',saved.affects_current,'holding_state_version',holding.state_version,'before',saved.before_snapshot,'after',saved.after_snapshot);
 insert into public.trade_reversal_mutation_receipts values(current_user_id,input_idempotency_key,request,response,now()); return response;
end; $$;

grant select on public.trade_reversal_previews,public.trade_reversals,public.trade_reversal_mutation_receipts to authenticated;
grant execute on function public.app_preview_trade_reversal(uuid,text) to authenticated;
grant execute on function public.app_reverse_trade_entry(uuid,uuid,text) to authenticated;

create or replace function public.app_list_transactions(input_limit integer default 50,input_before timestamptz default null)
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(listed.item order by listed.created_at desc),'[]'::jsonb) from (
  select trade.created_at,jsonb_build_object('id',trade.id,'account_id',trade.account_id,'account_name',account.name,'instrument_id',trade.instrument_id,'ticker',instrument.ticker,'instrument_name',instrument.display_name,'side',trade.side,'quantity',trade.quantity::text,'unit_price',trade.unit_price::text,'executed_on',trade.executed_on,'sequence_no',trade.sequence_no,'before_quantity',trade.before_quantity::text,'after_quantity',trade.after_quantity::text,'after_avg_price',case when trade.after_quantity=0 then null else (trade.after_cost_pool/trade.after_quantity)::text end,'authored_via',trade.authored_via,'created_at',trade.created_at,'reversed_at',trade.reversed_at,'reversal_reason',trade.reversal_reason) item
  from public.trade_entries trade join public.accounts account on account.id=trade.account_id and account.user_id=trade.user_id join public.instruments instrument on instrument.id=trade.instrument_id and instrument.user_id=trade.user_id
  where trade.user_id=auth.uid() and (input_before is null or trade.created_at<input_before) order by trade.created_at desc limit least(greatest(coalesce(input_limit,50),1),100)
 ) listed;
$$;
