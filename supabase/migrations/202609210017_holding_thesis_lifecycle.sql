create or replace function public.deactivate_theses_after_position_close()
returns trigger language plpgsql security definer set search_path=public as $$
declare owner_id uuid:=coalesce(new.user_id,old.user_id); account_key bigint:=coalesce(new.account_id,old.account_id);
  ticker_key text:=coalesce(new.ticker,old.ticker); instrument_key bigint; changed_thesis public.holding_theses%rowtype;
begin
  select id into instrument_key from public.instruments where user_id=owner_id and ticker=ticker_key;
  if instrument_key is null then if tg_op='DELETE' then return old; else return new; end if; end if;
  if not exists(select 1 from public.holdings h where h.user_id=owner_id and h.account_id=account_key and h.ticker=ticker_key and coalesce(h.ledger_quantity,h.quantity::numeric,0)>0) then
    for changed_thesis in update public.holding_theses set is_active=false,version=version+1,updated_at=clock_timestamp()
      where user_id=owner_id and instrument_id=instrument_key and account_id=account_key and is_active returning * loop
      insert into public.holding_thesis_history(user_id,thesis_id,version,snapshot,change_reason,authored_via)
      values(owner_id,changed_thesis.id,changed_thesis.version,to_jsonb(changed_thesis)-'user_id','Position fully closed; explicit review required before reuse','app');
    end loop;
  end if;
  if not exists(select 1 from public.holdings h where h.user_id=owner_id and h.ticker=ticker_key and coalesce(h.ledger_quantity,h.quantity::numeric,0)>0) then
    for changed_thesis in update public.holding_theses set is_active=false,version=version+1,updated_at=clock_timestamp()
      where user_id=owner_id and instrument_id=instrument_key and account_id is null and is_active returning * loop
      insert into public.holding_thesis_history(user_id,thesis_id,version,snapshot,change_reason,authored_via)
      values(owner_id,changed_thesis.id,changed_thesis.version,to_jsonb(changed_thesis)-'user_id','All positions fully closed; explicit review required before reuse','app');
    end loop;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger deactivate_theses_after_position_close_trigger after insert or update or delete on public.holdings
for each row execute function public.deactivate_theses_after_position_close();
