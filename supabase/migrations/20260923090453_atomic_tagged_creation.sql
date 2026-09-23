-- Keep the existing purpose-specific writes and receipts, but let a new
-- activity/task and its selected tags succeed or fail in one RPC transaction.
create function public.app_create_activity_with_tags(
  input_idempotency_key uuid,
  input_payload jsonb,
  input_tag_ids uuid[] default array[]::uuid[]
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tag_ids uuid[] := coalesce(input_tag_ids, array[]::uuid[]);
  created jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if coalesce(jsonb_typeof(input_payload), 'null') <> 'object' then raise exception 'Activity payload must be an object'; end if;
  if cardinality(tag_ids) > 20 or array_position(tag_ids, null) is not null or
     cardinality(tag_ids) <> (select count(distinct value) from unnest(tag_ids) value) then
    raise exception 'Invalid activity tags';
  end if;

  -- Bind tags to the original create receipt so a reused key cannot change
  -- only the tags after a successful first request.
  created := public.app_create_activity(input_idempotency_key, input_payload || jsonb_build_object('tag_ids', tag_ids));
  if cardinality(tag_ids) = 0 then return created; end if;
  return public.app_set_activity_tags(
    (created ->> 'id')::bigint, (created ->> 'version')::integer,
    tag_ids, input_idempotency_key
  );
end;
$$;

create function public.app_create_general_task_with_tags(
  input_idempotency_key uuid,
  input_payload jsonb,
  input_tag_ids uuid[] default array[]::uuid[]
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tag_ids uuid[] := coalesce(input_tag_ids, array[]::uuid[]);
  created jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if input_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if coalesce(jsonb_typeof(input_payload), 'null') <> 'object' then raise exception 'General task payload must be an object'; end if;
  if cardinality(tag_ids) > 20 or array_position(tag_ids, null) is not null or
     cardinality(tag_ids) <> (select count(distinct value) from unnest(tag_ids) value) then
    raise exception 'Invalid activity tags';
  end if;

  created := public.app_save_general_task(
    null, null, input_idempotency_key, input_payload || jsonb_build_object('tag_ids', tag_ids)
  );
  if cardinality(tag_ids) > 0 then
    perform public.app_set_general_task_tags(
      (created ->> 'id')::uuid, (created ->> 'version')::integer,
      tag_ids, input_idempotency_key
    );
  end if;
  return public.app_get_general_task((created ->> 'id')::uuid);
end;
$$;

revoke all on function public.app_create_activity_with_tags(uuid,jsonb,uuid[]) from public, anon;
grant execute on function public.app_create_activity_with_tags(uuid,jsonb,uuid[]) to authenticated;
revoke all on function public.app_create_general_task_with_tags(uuid,jsonb,uuid[]) from public, anon;
grant execute on function public.app_create_general_task_with_tags(uuid,jsonb,uuid[]) to authenticated;
