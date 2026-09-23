-- Existing investment rows may be discarded by the user's explicit decision.
-- New reviews and the current review context already use activity_events.
-- Keep the decisions table temporarily, but sever its obsolete briefing FK.
alter table public.investment_decisions
  drop constraint if exists investment_decisions_user_id_source_briefing_id_fkey;

drop function if exists public.app_create_daily_context(text,text[]);
drop function if exists public.app_create_daily_context_before_private_notes(text,text[]);
drop function if exists public.app_create_daily_context_before_principles(text,text[]);
drop function if exists public.app_create_daily_context_without_lifecycle(text,text[]);
drop function if exists public.app_save_daily_briefing(uuid,uuid,jsonb);
drop function if exists public.app_get_daily_briefing(uuid);
drop function if exists public.app_get_daily_briefing_for_owner(uuid,uuid);
drop function if exists public.app_list_daily_briefings(integer,timestamptz);
drop function if exists public.app_list_daily_briefings_for_owner(uuid,integer,timestamptz);
drop function if exists public.app_list_daily_briefing_page(uuid,integer,jsonb);
drop function if exists public.app_list_briefing_related_tasks(uuid,uuid,integer);

drop table if exists public.daily_briefing_scope_evidence;
drop table if exists public.daily_briefing_scope_sources;
drop table if exists public.daily_briefing_scopes;
drop table if exists public.daily_briefing_evidence;
drop table if exists public.daily_briefings;
drop table if exists public.daily_review_contexts;
drop table if exists public.daily_review_mutation_receipts;
