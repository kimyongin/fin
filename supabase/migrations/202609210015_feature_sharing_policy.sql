create table public.feature_sharing_policies (
    owner_user_id uuid primary key references auth.users(id) on delete cascade,
    version integer not null default 1 check(version>0),
    updated_at timestamptz not null default now()
);
create table public.feature_sharing_grants (
    owner_user_id uuid not null references public.feature_sharing_policies(owner_user_id) on delete cascade,
    feature_key text not null check(feature_key in ('assets','strategy','news','activity','briefings','decisions','tasks','investment_profile','holding_theses','research_evidence')),
    can_read boolean not null,
    primary key(owner_user_id,feature_key)
);
alter table public.feature_sharing_policies enable row level security;
alter table public.feature_sharing_grants enable row level security;
create policy feature_sharing_policies_owner on public.feature_sharing_policies for select to authenticated using(owner_user_id=auth.uid());
create policy feature_sharing_grants_owner on public.feature_sharing_grants for select to authenticated using(owner_user_id=auth.uid());

create or replace function public.app_get_sharing_policy()
returns jsonb language sql stable security definer set search_path=public as $$
  with policy as (select version from public.feature_sharing_policies where owner_user_id=auth.uid()),
  defaults(feature_key,can_read) as (values ('assets',true),('strategy',true),('news',true),('activity',true),('briefings',false),('decisions',false),('tasks',false),('investment_profile',false),('holding_theses',false),('research_evidence',false))
  select jsonb_build_object('version',coalesce((select version from policy),0),'grants',
    (select jsonb_object_agg(d.feature_key,coalesce(g.can_read,d.can_read)) from defaults d left join public.feature_sharing_grants g on g.owner_user_id=auth.uid() and g.feature_key=d.feature_key),
    'preset',case
      when coalesce((select bool_and(coalesce(g.can_read,d.can_read)=case when d.feature_key in ('assets','strategy','news','activity') then true else false end) from defaults d left join public.feature_sharing_grants g on g.owner_user_id=auth.uid() and g.feature_key=d.feature_key),false) then 'portfolio_only'
      when coalesce((select bool_and(coalesce(g.can_read,d.can_read)=case when d.feature_key in ('assets','strategy','news','activity','briefings','decisions','tasks') then true else false end) from defaults d left join public.feature_sharing_grants g on g.owner_user_id=auth.uid() and g.feature_key=d.feature_key),false) then 'portfolio_and_reviews'
      else 'custom' end);
$$;

create or replace function public.app_update_sharing_policy(input_expected_version integer,input_grants jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_user_id uuid:=auth.uid(); current_version integer; feature text; value jsonb;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if coalesce(jsonb_typeof(input_grants),'null')<>'object' then raise exception 'Sharing grants must be an object'; end if;
  if exists(select 1 from jsonb_each(input_grants) item where item.key not in ('assets','strategy','news','activity','briefings','decisions','tasks','investment_profile','holding_theses','research_evidence') or jsonb_typeof(item.value)<>'boolean') then raise exception 'Invalid sharing feature or value'; end if;
  select version into current_version from public.feature_sharing_policies where owner_user_id=current_user_id for update;
  if not found then current_version:=0; end if;
  if input_expected_version is distinct from current_version then raise exception 'Sharing policy version conflict'; end if;
  insert into public.feature_sharing_policies(owner_user_id,version) values(current_user_id,current_version+1)
  on conflict(owner_user_id) do update set version=excluded.version,updated_at=clock_timestamp();
  for feature,value in select item.key,item.value from jsonb_each(input_grants) item loop
    insert into public.feature_sharing_grants(owner_user_id,feature_key,can_read) values(current_user_id,feature,(value#>>'{}')::boolean)
    on conflict(owner_user_id,feature_key) do update set can_read=excluded.can_read;
  end loop;
  insert into public.activity_events(user_id,source,action_type,target_table,target_id,after_data,status)
  values(current_user_id,'user','update_sharing_policy','feature_sharing_policies',current_user_id::text,public.app_get_sharing_policy(),'succeeded');
  return public.app_get_sharing_policy();
end;
$$;

create or replace function public.can_view_feature(owner_id uuid,input_feature_key text)
returns boolean language sql stable security definer set search_path=public as $$
  select owner_id=auth.uid() or (public.can_view_owner(owner_id) and coalesce(
    (select grant_row.can_read from public.feature_sharing_grants grant_row where grant_row.owner_user_id=owner_id and grant_row.feature_key=input_feature_key),
    input_feature_key in ('assets','strategy','news','activity')));
$$;
grant select on public.feature_sharing_policies,public.feature_sharing_grants to authenticated;
grant execute on function public.app_get_sharing_policy(),public.app_update_sharing_policy(integer,jsonb),public.can_view_feature(uuid,text) to authenticated;
