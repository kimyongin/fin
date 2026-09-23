-- Intermediate storage slice for the activity model transition. Existing
-- readers and category compatibility stay in place until the following slice.
alter table public.activity_events
  add column body text,
  add column holding_id bigint references public.holdings(id) on delete set null,
  add constraint activity_events_body_length_check check (body is null or char_length(body) <= 25000);

create index activity_events_user_holding_time_idx
  on public.activity_events(user_id, holding_id, occurred_at desc, id desc)
  where holding_id is not null;

-- Historical human-entered fields become one readable Markdown body. Do not
-- copy arbitrary before/after JSON, which may contain private verification data.
update public.activity_events
set body = case when action_type='record_manual_activity' then nullif(concat_ws(E'\n\n',
  nullif(trim(coalesce(note,'')),''),
  nullif(trim(coalesce(result,'')),''),
  nullif(trim(coalesce(conclusion,'')),'')
),'') end,
holding_id = case when target_table='holdings' and target_id ~ '^[0-9]+$'
  and exists(select 1 from public.holdings h where h.id=target_id::bigint and h.user_id=activity_events.user_id)
  then target_id::bigint else null end;

update public.activity_events
set body = case
  when action_type='log_completed_trade' then format('%s %s주 · 체결가 %s · 보유 %s→%s주',
    case when after_data->>'side'='buy' then '매수' else '매도' end,
    coalesce(after_data->>'trade_quantity','?'),coalesce(after_data->>'unit_price','?'),
    coalesce(before_data->>'quantity','0'),coalesce(after_data->>'quantity','?'))
  when action_type='reconcile_holding' then concat_ws(' · ', '증권사 기준 잔고 보정',
    case when before_data ? 'quantity' and after_data ? 'quantity'
      then format('수량 %s→%s',before_data->>'quantity',after_data->>'quantity') end)
  when action_type='verify_holding' then '증권사에서 현재 잔고를 확인했습니다.'
  when action_type='complete_general_task' then concat_ws(' · ',coalesce(title,after_data->>'title','할 일 완료'),
    nullif(after_data->>'result',''))
  when action_type='reopen_general_task' then concat_ws(' · ',coalesce(title,after_data->>'title','할 일'), '다시 열림')
  else coalesce(nullif(trim(title),''), '기록') end
where body is null;

create function public.app_fill_activity_body()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.body is not null then return new; end if;
  if new.action_type='record_manual_activity' then
    new.body := nullif(concat_ws(E'\n\n',nullif(trim(coalesce(new.note,'')),''),
      nullif(trim(coalesce(new.result,'')),''),nullif(trim(coalesce(new.conclusion,'')),'')), '');
  end if;
  if new.body is not null then return new; end if;
  new.body := case
    when new.action_type='log_completed_trade' then format('%s %s주 · 체결가 %s · 보유 %s→%s주',
      case when new.after_data->>'side'='buy' then '매수' else '매도' end,
      coalesce(new.after_data->>'trade_quantity','?'),coalesce(new.after_data->>'unit_price','?'),
      coalesce(new.before_data->>'quantity','0'),coalesce(new.after_data->>'quantity','?'))
    when new.action_type='reconcile_holding' then concat_ws(' · ', '증권사 기준 잔고 보정',
      case when new.before_data ? 'quantity' and new.after_data ? 'quantity'
        then format('수량 %s→%s',new.before_data->>'quantity',new.after_data->>'quantity') end)
    when new.action_type='verify_holding' then '증권사에서 현재 잔고를 확인했습니다.'
    when new.action_type='complete_general_task' then concat_ws(' · ',
      coalesce(new.title,new.after_data->>'title','할 일 완료'),nullif(new.after_data->>'result',''))
    when new.action_type='reopen_general_task' then concat_ws(' · ',
      coalesce(new.title,new.after_data->>'title','할 일'),'다시 열림')
    else coalesce(nullif(trim(new.title),''),nullif(trim(new.after_data->>'title'),''), '기록') end;
  return new;
end;
$$;
create trigger activity_events_fill_body
before insert on public.activity_events
for each row execute function public.app_fill_activity_body();

create function public.app_validate_activity_holding_reference()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.holding_id is not null and not exists(
    select 1 from public.holdings h where h.id=new.holding_id and h.user_id=new.user_id
  ) then raise exception 'Holding reference not found for activity owner'; end if;
  return new;
end;
$$;
create trigger activity_events_validate_holding_reference
before insert or update of holding_id,user_id on public.activity_events
for each row execute function public.app_validate_activity_holding_reference();

-- Automatic holding writes already carry a concrete target_id. Keep the
-- reference explicit for new rows without inventing a general relation table.
create function public.app_fill_activity_holding_reference()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.holding_id is null and new.target_table='holdings' and new.target_id ~ '^[0-9]+$' then
    select h.id into new.holding_id from public.holdings h
    where h.id=new.target_id::bigint and h.user_id=new.user_id;
  end if;
  return new;
end;
$$;
create trigger activity_events_fill_holding_reference
before insert on public.activity_events
for each row execute function public.app_fill_activity_holding_reference();
