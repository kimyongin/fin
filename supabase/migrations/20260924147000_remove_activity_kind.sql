-- All live reads now use the general body/tag/reference contract. Retire the
-- private kind classifier instead of leaving an invisible product type.
drop function public.app_list_narrative_activities(text,uuid,integer,jsonb);
drop trigger activity_events_classify_kind on public.activity_events;
drop function public.app_classify_activity_kind();
drop index public.activity_events_kind_time_idx;
alter table public.activity_events drop column record_kind;
