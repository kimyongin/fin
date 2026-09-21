create table public.product_feedback (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  source text not null check (source in ('app', 'mcp')),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  status text not null default 'received' check (status in ('received', 'reviewing', 'planned', 'resolved', 'deferred')),
  response text check (response is null or char_length(response) <= 4000),
  github_issue_url text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_feedback_reporter_page_idx
  on public.product_feedback (reporter_user_id, created_at desc, id desc);

create index product_feedback_admin_page_idx
  on public.product_feedback (updated_at desc, id desc);

create table public.product_feedback_mutation_receipts (
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (reporter_user_id, idempotency_key)
);

create table public.product_feedback_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.product_feedback enable row level security;
alter table public.product_feedback_mutation_receipts enable row level security;
alter table public.product_feedback_admins enable row level security;

create policy product_feedback_select_own
  on public.product_feedback
  for select
  to authenticated
  using (reporter_user_id = auth.uid());

create policy product_feedback_receipts_select_own
  on public.product_feedback_mutation_receipts
  for select
  to authenticated
  using (reporter_user_id = auth.uid());

grant select on public.product_feedback to authenticated;
grant select on public.product_feedback_mutation_receipts to authenticated;

create or replace function public.app_is_product_feedback_admin()
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.product_feedback_admins as admin
    where admin.user_id = auth.uid()
  );
$$;

create or replace function public.app_submit_product_feedback(
  input_body text,
  input_context jsonb default '{}'::jsonb,
  input_source text default 'app',
  input_idempotency_key uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_body text := btrim(coalesce(input_body, ''));
  normalized_context jsonb := coalesce(input_context, '{}'::jsonb);
  request_data jsonb;
  stored_receipt public.product_feedback_mutation_receipts%rowtype;
  created_feedback public.product_feedback%rowtype;
  result jsonb;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'anonymous sessions cannot submit product feedback';
  end if;

  if char_length(normalized_body) not between 1 and 4000 then
    raise exception 'feedback body must contain 1 to 4000 characters';
  end if;

  if input_source not in ('app', 'mcp') then
    raise exception 'invalid feedback source';
  end if;

  if jsonb_typeof(normalized_context) <> 'object' then
    raise exception 'feedback context must be an object';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(normalized_context) as key_name
    where key_name not in ('page_key', 'app_version', 'tool_name', 'error_code', 'request_id')
  ) then
    raise exception 'feedback context contains an unsupported field';
  end if;

  if exists (
    select 1
    from jsonb_each(normalized_context) as item(key_name, value)
    where jsonb_typeof(item.value) not in ('string', 'null')
       or (jsonb_typeof(item.value) = 'string' and char_length(item.value #>> '{}') > 200)
  ) then
    raise exception 'feedback context values must be short strings or null';
  end if;

  request_data := jsonb_build_object(
    'body', normalized_body,
    'context', normalized_context,
    'source', input_source
  );

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text || ':' || input_idempotency_key::text, 0));

  select *
  into stored_receipt
  from public.product_feedback_mutation_receipts
  where reporter_user_id = current_user_id
    and idempotency_key = input_idempotency_key;

  if found then
    if stored_receipt.request_payload <> request_data then
      raise exception 'idempotency key already used with a different request';
    end if;
    return stored_receipt.response_payload;
  end if;

  insert into public.product_feedback (reporter_user_id, body, source, context)
  values (current_user_id, normalized_body, input_source, normalized_context)
  returning * into created_feedback;

  result := jsonb_build_object(
    'id', created_feedback.id,
    'body', created_feedback.body,
    'source', created_feedback.source,
    'context', created_feedback.context,
    'status', created_feedback.status,
    'response', created_feedback.response,
    'github_issue_url', created_feedback.github_issue_url,
    'version', created_feedback.version,
    'created_at', created_feedback.created_at,
    'updated_at', created_feedback.updated_at
  );

  insert into public.product_feedback_mutation_receipts (
    reporter_user_id,
    idempotency_key,
    request_payload,
    response_payload
  ) values (
    current_user_id,
    input_idempotency_key,
    request_data,
    result
  );

  return result;
end;
$$;

create or replace function public.app_list_my_product_feedback(
  input_cursor jsonb default null,
  input_limit integer default 20
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, auth
as $$
declare
  current_user_id uuid := auth.uid();
  page_limit integer := least(greatest(coalesce(input_limit, 20), 1), 50);
  cursor_created_at timestamptz;
  cursor_id uuid;
  result jsonb;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if input_cursor is not null then
    if jsonb_typeof(input_cursor) <> 'object'
       or not (input_cursor ? 'created_at')
       or not (input_cursor ? 'id') then
      raise exception 'invalid feedback cursor';
    end if;
    cursor_created_at := (input_cursor ->> 'created_at')::timestamptz;
    cursor_id := (input_cursor ->> 'id')::uuid;
  end if;

  with page_rows as (
    select feedback.*
    from public.product_feedback as feedback
    where feedback.reporter_user_id = current_user_id
      and (
        cursor_created_at is null
        or (feedback.created_at, feedback.id) < (cursor_created_at, cursor_id)
      )
    order by feedback.created_at desc, feedback.id desc
    limit page_limit + 1
  ), visible_rows as (
    select *
    from page_rows
    order by created_at desc, id desc
    limit page_limit
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', visible.id,
        'body', visible.body,
        'source', visible.source,
        'context', visible.context,
        'status', visible.status,
        'response', visible.response,
        'github_issue_url', visible.github_issue_url,
        'version', visible.version,
        'created_at', visible.created_at,
        'updated_at', visible.updated_at
      ) order by visible.created_at desc, visible.id desc
    ), '[]'::jsonb),
    'next_cursor', case
      when (select count(*) from page_rows) > page_limit then (
        select jsonb_build_object('created_at', tail.created_at, 'id', tail.id)
        from visible_rows as tail
        order by tail.created_at asc, tail.id asc
        limit 1
      )
      else null
    end,
    'is_admin', public.app_is_product_feedback_admin()
  )
  into result
  from visible_rows as visible;

  return coalesce(result, jsonb_build_object(
    'items', '[]'::jsonb,
    'next_cursor', null,
    'is_admin', public.app_is_product_feedback_admin()
  ));
end;
$$;

revoke all on function public.app_is_product_feedback_admin() from public, anon;
revoke all on function public.app_submit_product_feedback(text, jsonb, text, uuid) from public, anon;
revoke all on function public.app_list_my_product_feedback(jsonb, integer) from public, anon;

grant execute on function public.app_is_product_feedback_admin() to authenticated;
grant execute on function public.app_submit_product_feedback(text, jsonb, text, uuid) to authenticated;
grant execute on function public.app_list_my_product_feedback(jsonb, integer) to authenticated;
