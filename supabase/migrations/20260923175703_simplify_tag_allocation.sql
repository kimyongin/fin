-- One current target per portfolio tag. Reads are feature-scoped; direct writes use one RPC.
create table public.allocation_targets (
  user_id uuid not null references auth.users(id) on delete cascade,
  tag_id bigint not null references public.tags(id) on delete cascade,
  target_percentage numeric(5,2) not null check (target_percentage between 0 and 100),
  primary key (user_id, tag_id)
);
create index allocation_targets_tag_idx on public.allocation_targets(tag_id);
alter table public.allocation_targets enable row level security;
create policy allocation_targets_owner_read on public.allocation_targets
  for select to authenticated using (user_id=(select auth.uid()));
revoke all on public.allocation_targets from public, anon, authenticated;
grant select on public.allocation_targets to authenticated;

create function public.protect_positive_allocation_target() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if auth.uid()=old.user_id and exists (
    select 1 from public.allocation_targets t where t.tag_id=old.id and t.user_id=old.user_id and t.target_percentage>0
  ) then raise exception 'Move positive allocation target before deleting the tag'; end if;
  return old;
end;
$$;
create trigger protect_positive_allocation_target_before_tag_delete
before delete on public.tags for each row execute function public.protect_positive_allocation_target();
revoke all on function public.protect_positive_allocation_target() from public,anon,authenticated;

-- Convert only an unambiguous active mode: one distinct tag per bucket,
-- two-decimal targets, and an exact 100.00 total. Ambiguous users start unset.
do $$
declare s record; bucket_count integer; valid_count integer; distinct_tags integer; target_sum numeric;
begin
  for s in select id,user_id,mode from public.strategies loop
    select count(*),
      count(*) filter (where link_count=1 and tag_count=1 and target is not null and target between 0 and 100 and target=round(target,2)),
      count(distinct tag_id), coalesce(sum(target),0)
    into bucket_count,valid_count,distinct_tags,target_sum
    from (
      select b.id,
        count(link.tag_id)::integer as link_count,
        count(tag.id)::integer as tag_count,
        min(tag.id) as tag_id,
        coalesce((select mt.target_percentage from public.strategy_bucket_mode_targets mt
          where mt.bucket_id=b.id and mt.mode=s.mode),b.target_percentage) as target
      from public.strategy_buckets b
      left join public.strategy_bucket_tags link on link.bucket_id=b.id
      left join public.tags tag on tag.id=link.tag_id and tag.user_id=s.user_id
      where b.strategy_id=s.id
      group by b.id,b.target_percentage
    ) rows;
    if bucket_count>0 and valid_count=bucket_count and distinct_tags=bucket_count and target_sum=100 then
      insert into public.allocation_targets(user_id,tag_id,target_percentage)
      select s.user_id,link.tag_id,
        coalesce((select mt.target_percentage from public.strategy_bucket_mode_targets mt
          where mt.bucket_id=b.id and mt.mode=s.mode),b.target_percentage)
      from public.strategy_buckets b
      join public.strategy_bucket_tags link on link.bucket_id=b.id
      join public.tags tag on tag.id=link.tag_id and tag.user_id=s.user_id
      where b.strategy_id=s.id;
    end if;
  end loop;
end;
$$;

create or replace function public.app_get_strategy_state(input_owner_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare selected_owner uuid := coalesce(input_owner_user_id,auth.uid()); result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_view_feature(selected_owner,'strategy') then raise exception 'Allocation targets are not shared'; end if;
  select jsonb_build_object(
    'configured',exists(select 1 from public.allocation_targets t where t.user_id=selected_owner),
    'targets',coalesce(jsonb_agg(jsonb_build_object(
      'tag_id',t.tag_id,'tag_name',tag.name,'target_percentage',t.target_percentage)
      order by tag.sort_order,tag.id) filter (where t.tag_id is not null),'[]'::jsonb)
  ) into result
  from public.allocation_targets t
  join public.tags tag on tag.id=t.tag_id and tag.user_id=t.user_id
  where t.user_id=selected_owner;
  return result;
end;
$$;

create function public.app_save_allocation_targets(input_targets jsonb,input_expected_targets jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare owner_id uuid := auth.uid(); item jsonb; tag_id bigint; percentage numeric;
  seen bigint[] := '{}'; total numeric := 0; current_targets jsonb; desired_targets jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(input_targets)<>'array' or jsonb_array_length(input_targets)=0 then
    raise exception 'Allocation targets must be a nonempty array';
  end if;
  if input_expected_targets is null or jsonb_typeof(input_expected_targets)<>'array' then raise exception 'Invalid expected targets'; end if;
  for item in select value from jsonb_array_elements(input_targets) loop
    if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'tag_id')<>'number'
      or jsonb_typeof(item->'target_percentage')<>'number'
      or (item->>'tag_id') !~ '^[1-9][0-9]*$'
      or (item->>'target_percentage') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception 'Invalid allocation target';
    end if;
    tag_id := (item->>'tag_id')::bigint;
    percentage := (item->>'target_percentage')::numeric;
    if tag_id<=0 or percentage<0 or percentage>100 or tag_id=any(seen) then
      raise exception 'Invalid or duplicate allocation target';
    end if;
    if not exists(select 1 from public.tags tag where tag.id=tag_id and tag.user_id=owner_id) then
      raise exception 'Allocation tag does not belong to the owner';
    end if;
    seen := array_append(seen,tag_id);
    total := total+percentage;
  end loop;
  if total<>100 then raise exception 'Allocation targets must total 100.00 percent'; end if;

  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':allocation-targets',0));
  select coalesce(jsonb_agg(jsonb_build_object('tag_id',t.tag_id,'target_percentage',t.target_percentage)
    order by t.tag_id),'[]'::jsonb) into current_targets
  from public.allocation_targets t where t.user_id=owner_id;
  select jsonb_agg(jsonb_build_object('tag_id',(value->>'tag_id')::bigint,
    'target_percentage',(value->>'target_percentage')::numeric) order by (value->>'tag_id')::bigint)
    into desired_targets from jsonb_array_elements(input_targets);
  if current_targets=desired_targets then return public.app_get_strategy_state(null); end if;
  if current_targets<>input_expected_targets then raise exception 'Allocation targets changed; reload before saving'; end if;

  delete from public.allocation_targets where user_id=owner_id;
  insert into public.allocation_targets(user_id,tag_id,target_percentage)
  select owner_id,(value->>'tag_id')::bigint,(value->>'target_percentage')::numeric
  from jsonb_array_elements(input_targets);
  insert into public.activity_events(user_id,source,action_type,target_table,after_data,status)
  values(owner_id,'user','update_strategy','allocation_targets',desired_targets,'succeeded');
  return public.app_get_strategy_state(null);
end;
$$;
revoke all on function public.app_save_allocation_targets(jsonb,jsonb) from public,anon;
grant execute on function public.app_save_allocation_targets(jsonb,jsonb) to authenticated;

drop function public.mcp_save_strategy(text,text,numeric,integer,numeric,jsonb,text,text,jsonb);
drop function public.app_save_strategy(text,numeric,integer,numeric,jsonb,text,text,jsonb);

create function public.mcp_save_strategy(input_token_hash text,input_targets jsonb,input_expected_targets jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.mcp_adopt_agent_token(input_token_hash);
  return public.app_save_allocation_targets(input_targets,input_expected_targets);
end;
$$;
revoke all on function public.mcp_save_strategy(text,jsonb,jsonb) from public;
grant execute on function public.mcp_save_strategy(text,jsonb,jsonb) to anon,authenticated;

drop table public.strategy_bucket_mode_targets;
drop table public.strategy_bucket_tags;
drop table public.strategy_buckets;
drop table public.strategies;
