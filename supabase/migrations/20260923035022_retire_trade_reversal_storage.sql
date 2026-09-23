-- Wrongly entered trades are corrected against the brokerage's current values.
-- The reversal engine is no longer exposed by the app or MCP and has no live
-- rows in the audited local or production schemas. Keep trade history columns
-- readable for historical records, but remove the unused reversal writer.
drop function if exists public.app_reverse_trade_entry(uuid, uuid, text);
drop function if exists public.app_preview_trade_reversal(uuid, text);
drop function if exists public.calculate_trade_stream_without(uuid, bigint, uuid);

drop table if exists public.trade_reversal_mutation_receipts;
drop table if exists public.trade_reversals;
drop table if exists public.trade_reversal_previews;
