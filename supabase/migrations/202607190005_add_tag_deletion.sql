create function public.app_delete_tag(
  input_tag_id bigint,
  input_source text default 'user',
  input_request text default null
)
returns table (
  tag_id bigint,
  unlinked_instrument_count integer,
  activity_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_source text := coalesce(nullif(trim(input_source), ''), 'user');
  tag_row jsonb;
  unlinked_tickers jsonb;
  before_row jsonb;
  after_row jsonb;
  removed_count integer;
  event_id bigint;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if normalized_source not in ('user', 'agent') then
    raise exception 'Invalid activity source';
  end if;

  select to_jsonb(t) into tag_row
  from public.tags t
  where t.id = input_tag_id and t.user_id = current_user_id;

  if tag_row is null then
    raise exception 'Tag not found';
  end if;

  with removed_links as (
    delete from public.instrument_tags it
    where it.user_id = current_user_id and it.tag_id = input_tag_id
    returning it.ticker
  )
  select coalesce(jsonb_agg(ticker order by ticker), '[]'::jsonb), count(*)::integer
  into unlinked_tickers, removed_count
  from removed_links;

  before_row := tag_row || jsonb_build_object('linked_tickers', unlinked_tickers);

  delete from public.tags t
  where t.id = input_tag_id and t.user_id = current_user_id;

  after_row := jsonb_build_object(
    'id', input_tag_id,
    'deleted', true,
    'unlinked_tickers', unlinked_tickers
  );

  insert into public.activity_events (
    user_id, source, action_type, natural_language_request, target_table, target_id, before_data, after_data, status
  )
  values (
    current_user_id, normalized_source, 'delete_tag', nullif(trim(coalesce(input_request, '')), ''),
    'tags', input_tag_id::text, before_row, after_row, 'succeeded'
  )
  returning id into event_id;

  return query select input_tag_id, removed_count, event_id;
end;
$$;

create function public.mcp_delete_tag(
  input_token_hash text,
  input_tag_id bigint,
  input_request text default null
)
returns table (
  tag_id bigint,
  unlinked_instrument_count integer,
  activity_id bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.mcp_adopt_agent_token(input_token_hash);
  return query
  select * from public.app_delete_tag(input_tag_id, 'agent', input_request);
end;
$$;

grant execute on function public.app_delete_tag(bigint, text, text) to authenticated;
grant execute on function public.mcp_delete_tag(text, bigint, text) to anon, authenticated;
