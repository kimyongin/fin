-- Supabase hosted Edge Functions use named secret API keys. Send that key on
-- apikey only; Authorization expects a JWT and is not needed for this worker.
create or replace function public.activity_search_dispatch() returns void
language plpgsql security definer set search_path = public, pgmq, extensions as $$
declare
  endpoint text;
  service_key text;
  message_row record;
begin
  select decrypted_secret into endpoint from vault.decrypted_secrets
    where name='activity_search_api_url' limit 1;
  select decrypted_secret into service_key from vault.decrypted_secrets
    where name='activity_search_service_role_key' limit 1;
  if endpoint is null or service_key is null then return; end if;
  for message_row in select * from pgmq.read('activity_search_index',120,3) loop
    if message_row.read_ct > 5 then
      perform pgmq.archive('activity_search_index',message_row.msg_id);
    else
      perform net.http_post(
        url := endpoint || '/functions/v1/activity-search-index',
        headers := jsonb_build_object('Content-Type','application/json','apikey',service_key),
        body := jsonb_build_object('message_id',message_row.msg_id,'job',message_row.message),
        timeout_milliseconds := 30000
      );
    end if;
  end loop;
end;
$$;
