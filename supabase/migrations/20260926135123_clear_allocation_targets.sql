-- Clearing the complete configured set is different from saving 0% targets.
create function public.app_clear_allocation_targets(input_expected_targets jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare owner_id uuid:=auth.uid(); current_targets jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_expected_targets is null or jsonb_typeof(input_expected_targets)<>'array' then raise exception 'Invalid expected targets'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text||':allocation-targets',0));
  select coalesce(jsonb_agg(jsonb_build_object('tag_id',t.tag_id,'target_percentage',t.target_percentage)
    order by t.tag_id),'[]'::jsonb) into current_targets
  from public.allocation_targets t where t.user_id=owner_id;
  if current_targets='[]'::jsonb then return public.app_get_strategy_state(null); end if;
  if current_targets<>input_expected_targets then raise exception 'Allocation targets changed; reload before clearing'; end if;
  delete from public.allocation_targets where user_id=owner_id;
  insert into public.activity_events(user_id,source,action_type,target_table,after_data,status)
    values(owner_id,'user','reset_allocation_targets','allocation_targets','[]'::jsonb,'succeeded');
  return public.app_get_strategy_state(null);
end;
$$;
revoke all on function public.app_clear_allocation_targets(jsonb) from public,anon;
grant execute on function public.app_clear_allocation_targets(jsonb) to authenticated;
