-- No current web or OAuth MCP consumer calls the old UUID-preview confirmer.
-- The current estimate is read-only and the direct writer checks the holding
-- version while holding the account/instrument stream lock.
drop function public.app_log_completed_trade(uuid,uuid,text);
alter table public.trade_entries drop column preview_id;
drop table public.trade_previews;
