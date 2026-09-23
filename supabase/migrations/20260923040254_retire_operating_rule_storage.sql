-- Narrative operating rules are now principle rows (kind=operation, scope=workflow).
-- The principles migration already copied current and historical rule content.
drop function if exists public.app_archive_operating_rule(uuid, integer, uuid, text, text);
drop function if exists public.app_save_operating_rule(uuid, integer, uuid, text, text, text, text, text, text);
drop function if exists public.app_list_operating_rules(text, boolean);
drop function if exists public.app_operating_rule_json(public.operating_rules);

drop table if exists public.operating_rule_mutation_receipts;
drop table if exists public.operating_rule_history;
drop table if exists public.operating_rules;
