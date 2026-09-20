create or replace function public.sync_holding_ledger_projection()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        new.ledger_quantity := coalesce(new.ledger_quantity, coalesce(new.quantity::numeric, 0));
        new.ledger_cost_pool := coalesce(new.ledger_cost_pool,
            case when new.quantity is null or new.avg_price is null then 0 else new.quantity::numeric * new.avg_price::numeric end);
        new.state_version := coalesce(new.state_version, 1);
        new.ledger_checkpoint_at := coalesce(new.ledger_checkpoint_at, now());
    elsif new.ledger_quantity is not distinct from old.ledger_quantity
       and new.ledger_cost_pool is not distinct from old.ledger_cost_pool
       and (new.quantity is distinct from old.quantity or new.avg_price is distinct from old.avg_price) then
        new.ledger_quantity := coalesce(new.quantity::numeric, 0);
        new.ledger_cost_pool := case when new.quantity is null or new.avg_price is null then 0
            else new.quantity::numeric * new.avg_price::numeric end;
        new.ledger_checkpoint_at := clock_timestamp();
        new.state_version := old.state_version + 1;
    elsif new.ledger_quantity is distinct from old.ledger_quantity
       or new.ledger_cost_pool is distinct from old.ledger_cost_pool then
        new.quantity := new.ledger_quantity::real;
        new.avg_price := case when new.ledger_quantity = 0 then null else (new.ledger_cost_pool / new.ledger_quantity)::real end;
        new.state_version := old.state_version + 1;
    elsif new.purchase_amount is distinct from old.purchase_amount
       or new.valuation_amount is distinct from old.valuation_amount then
        new.ledger_checkpoint_at := clock_timestamp();
        new.state_version := old.state_version + 1;
    end if;
    return new;
end;
$$;
