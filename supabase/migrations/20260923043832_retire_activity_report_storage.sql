-- Retrospectives are editable activities; the period source reader remains.
drop function if exists public.app_save_activity_report(uuid, integer, uuid, jsonb);
drop function if exists public.app_list_activity_reports(integer, jsonb);
drop function if exists public.app_get_activity_report(uuid);
drop table if exists public.activity_report_mutation_receipts;
drop table if exists public.activity_report_revisions;
drop table if exists public.activity_reports;
