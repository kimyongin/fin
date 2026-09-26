-- Price rows are provider data. Owner clients may request a sync, never submit values.
alter function public.app_save_instrument(bigint,text,text,text,text,numeric,date,bigint,text,text,text,text)
  rename to app_save_instrument_internal;
revoke all on function public.app_save_instrument_internal(bigint,text,text,text,text,numeric,date,bigint,text,text,text,text)
  from public,anon,authenticated;

create function public.app_save_instrument(
  input_instrument_id bigint default null, input_ticker text default null,
  input_display_name text default null, input_currency text default 'KRW',
  input_instrument_type text default 'market', input_price numeric default null,
  input_price_date date default null, input_tag_id bigint default null,
  input_source text default 'user', input_request text default null,
  input_price_source text default 'manual', input_note text default null
)
returns table(instrument_id bigint,ticker text,display_name text,currency text,instrument_type text,activity_id bigint)
language plpgsql security definer set search_path=public as $$
begin
  if input_price is not null or input_price_date is not null then
    raise exception 'Manual prices are not supported; use price sync';
  end if;
  return query select * from public.app_save_instrument_internal(
    input_instrument_id,input_ticker,input_display_name,input_currency,input_instrument_type,
    null,null,input_tag_id,input_source,input_request,input_price_source,input_note);
end;
$$;
revoke all on function public.app_save_instrument(bigint,text,text,text,text,numeric,date,bigint,text,text,text,text)
  from public,anon;
grant execute on function public.app_save_instrument(bigint,text,text,text,text,numeric,date,bigint,text,text,text,text)
  to authenticated;

revoke all on function public.app_upsert_price_rows(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.app_record_price_sync_run(integer,integer,jsonb) from public,anon,authenticated;
revoke all on function public.mcp_upsert_price_rows(text,text,jsonb,jsonb) from public,anon,authenticated;

create function public.app_sync_upsert_price_rows(
  input_owner_user_id uuid,input_ticker text,input_source_symbol text,input_prices jsonb
)
returns integer language plpgsql security definer set search_path=public as $$
declare normalized_ticker text:=upper(btrim(coalesce(input_ticker,'')));
  normalized_symbol text:=upper(btrim(coalesce(input_source_symbol,'')));
  affected_count integer;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Service role required'; end if;
  if input_owner_user_id is null or normalized_ticker='' then raise exception 'Owner and ticker required'; end if;
  if jsonb_typeof(input_prices)<>'array' or jsonb_array_length(input_prices)>400 then raise exception 'Invalid prices'; end if;
  if not exists(select 1 from public.instruments where user_id=input_owner_user_id and ticker=normalized_ticker and instrument_type in ('market','fx'))
    then raise exception 'Market or FX instrument not found'; end if;
  if exists(select 1 from jsonb_array_elements(input_prices) row_data
    where nullif(row_data->>'date','') is null or nullif(row_data->>'close','') is null or (row_data->>'close')::numeric<=0)
    then raise exception 'Every price row requires a date and a positive close'; end if;
  if normalized_symbol<>'' then
    update public.instruments set source_symbol=normalized_symbol
      where user_id=input_owner_user_id and ticker=normalized_ticker and source_symbol is distinct from normalized_symbol;
  end if;
  insert into public.holding_prices_daily(user_id,ticker,price_date,close_price,source)
    select input_owner_user_id,normalized_ticker,(row_data->>'date')::date,(row_data->>'close')::numeric,'yfinance'
    from jsonb_array_elements(input_prices) row_data
    on conflict on constraint holding_prices_daily_user_id_ticker_price_date_key do update
      set close_price=excluded.close_price,source=excluded.source;
  get diagnostics affected_count=row_count;
  return affected_count;
end;
$$;

create function public.app_sync_record_price_run(
  input_owner_user_id uuid,input_total_count integer,input_synced_count integer,input_failed jsonb
)
returns bigint language plpgsql security definer set search_path=public as $$
declare failed_count integer; saved_id bigint;
begin
  if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'Service role required'; end if;
  if input_owner_user_id is null or jsonb_typeof(input_failed)<>'array' then raise exception 'Invalid sync run'; end if;
  failed_count:=jsonb_array_length(input_failed);
  if coalesce(input_total_count,-1)<0 or coalesce(input_synced_count,-1)<0 or input_synced_count+failed_count<>input_total_count
    then raise exception 'Invalid price sync counts'; end if;
  insert into public.sync_runs(user_id,total_count,synced_count,failed_count,failed,started_by)
    values(input_owner_user_id,input_total_count,input_synced_count,failed_count,input_failed,'web') returning id into saved_id;
  insert into public.activity_events(user_id,source,action_type,target_table,target_id,after_data,status,error_message)
    values(input_owner_user_id,'user','sync_prices','holding_prices_daily',saved_id::text,
      jsonb_build_object('total_count',input_total_count,'synced_count',input_synced_count,'failed_count',failed_count),
      case when input_synced_count=0 and failed_count>0 then 'failed' else 'succeeded' end,
      case when input_synced_count=0 and failed_count>0 then 'All price targets failed' else null end);
  return saved_id;
end;
$$;
revoke all on function public.app_sync_upsert_price_rows(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.app_sync_record_price_run(uuid,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.app_sync_upsert_price_rows(uuid,text,text,jsonb) to service_role;
grant execute on function public.app_sync_record_price_run(uuid,integer,integer,jsonb) to service_role;
