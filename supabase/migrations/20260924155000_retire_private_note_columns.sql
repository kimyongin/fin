-- Existing private text must be exported outside Git before applying to a data-bearing target.
-- The user approved deleting legacy investment data; the local copy is backed up.
drop function public.app_save_asset_detail(bigint,jsonb,jsonb,jsonb,uuid);
alter table public.instruments drop column private_note;
alter table public.holdings drop column private_note;
