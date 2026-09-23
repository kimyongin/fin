-- The live correction path estimates without storage and writes the current
-- holding plus one automatic activity. Old investment data may be discarded.
drop function if exists public.app_reconcile_holding(uuid, uuid, text);

drop table if exists public.holding_reconciliations;
drop table if exists public.holding_reconciliation_previews;
