begin;
select plan(4);

select ok(position('Asia/Seoul' in pg_get_functiondef('public.app_preview_trade_entry(bigint,bigint,text,numeric,numeric,date)'::regprocedure)) > 0, 'trade preview validates the Seoul business date');
select ok(position('Asia/Seoul' in pg_get_functiondef('public.app_record_completed_trade(bigint,bigint,text,numeric,numeric,date,bigint,bigint,uuid,text)'::regprocedure)) > 0, 'trade confirmation validates the Seoul business date');
select ok(position('Asia/Seoul' in pg_get_functiondef('public.app_preview_holding_reconciliation(bigint,jsonb,text,date,text[])'::regprocedure)) > 0, 'holding correction preview validates the Seoul business date');
select ok(position('Asia/Seoul' in pg_get_functiondef('public.app_verify_holding(bigint,bigint,text[],date,text,uuid,text)'::regprocedure)) > 0, 'holding verification validates the Seoul business date');

select * from finish();
rollback;
