-- The UI defaults to the Seoul business date. PostgreSQL sessions use UTC, so
-- between midnight and 09:00 KST the unqualified CURRENT_DATE is yesterday.
-- Patch only the four current financial write/preview functions; retain their
-- existing signatures, grants, and transactional behavior.
do $$
declare
    function_name text;
    function_oid oid;
    definition text;
begin
    foreach function_name in array array[
        'app_preview_trade_entry',
        'app_record_completed_trade',
        'app_preview_holding_reconciliation',
        'app_verify_holding'
    ] loop
        select p.oid into strict function_oid
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = function_name;

        definition := pg_get_functiondef(function_oid);
        if length(definition) - length(replace(definition, 'current_date', '')) <> length('current_date') then
            raise exception 'Expected exactly one current_date check in %', function_name;
        end if;
        execute replace(definition, 'current_date', '(clock_timestamp() at time zone ''Asia/Seoul'')::date');
    end loop;
end;
$$;
