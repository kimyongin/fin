create table public.principles (
    id bigint generated always as identity primary key,
    principle_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    kind text not null check (kind ~ '^[a-z][a-z0-9_]{0,63}$'),
    body text not null check (char_length(body) between 1 and 10000),
    scope text check (scope is null or char_length(scope) between 1 and 200),
    effective_at timestamptz not null default clock_timestamp(),
    ended boolean not null default false
);

create index principles_current_idx
    on public.principles(user_id, principle_id, effective_at desc, id desc);
create index principles_kind_idx
    on public.principles(user_id, kind, effective_at desc);

alter table public.principles enable row level security;
create policy principles_owner_read on public.principles
    for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.principles from public, anon, authenticated;
grant select on public.principles to authenticated;

-- Backfill only source values and their real timestamps. No inferred older states.
insert into public.principles(principle_id,user_id,kind,body,scope,effective_at)
select md5(history.user_id::text || ':policy:' || field.kind)::uuid,
       history.user_id, field.kind, field.body, null, history.created_at
from public.investment_policy_history history
cross join lateral (values
    ('investment', history.snapshot ->> 'raw_text'),
    ('goal', history.snapshot ->> 'goal_text'),
    ('horizon', history.snapshot ->> 'horizon_text'),
    ('liquidity', history.snapshot ->> 'liquidity_need_text'),
    ('risk', history.snapshot ->> 'risk_tolerance_text'),
    ('trading', history.snapshot ->> 'trading_preference_text')
) field(kind,body)
where nullif(trim(field.body),'') is not null;

insert into public.principles(principle_id,user_id,kind,body,scope,effective_at)
select md5(profile.user_id::text || ':policy:' || field.kind)::uuid,
       profile.user_id, field.kind, field.body, null, profile.updated_at
from public.investment_policy_profiles profile
cross join lateral (values
    ('investment', profile.raw_text),
    ('goal', profile.goal_text),
    ('horizon', profile.horizon_text),
    ('liquidity', profile.liquidity_need_text),
    ('risk', profile.risk_tolerance_text),
    ('trading', profile.trading_preference_text)
) field(kind,body)
where nullif(trim(field.body),'') is not null;

insert into public.principles(principle_id,user_id,kind,body,scope,effective_at,ended)
select history.rule_id, history.user_id, 'operation',
       concat_ws(E'\n\n', history.snapshot ->> 'title',
           history.snapshot ->> 'applicability', history.snapshot ->> 'body'),
       history.snapshot ->> 'workflow_key', history.created_at,
       history.snapshot ->> 'status' = 'archived'
from public.operating_rule_history history
where nullif(trim(history.snapshot ->> 'body'),'') is not null;

insert into public.principles(principle_id,user_id,kind,body,scope,effective_at,ended)
select rule.id, rule.user_id, 'operation',
       concat_ws(E'\n\n', rule.title, rule.applicability, rule.body),
       rule.workflow_key, rule.updated_at, rule.status = 'archived'
from public.operating_rules rule;

insert into public.principles(principle_id,user_id,kind,body,scope,effective_at)
select md5(strategy.user_id::text || ':strategy_notes')::uuid,
       strategy.user_id, 'strategy', strategy.principles ->> 'notes', null, strategy.updated_at
from public.strategies strategy
where nullif(trim(strategy.principles ->> 'notes'),'') is not null;

create function public.app_list_principles(
    input_on date default null,
    input_timezone text default 'Asia/Seoul',
    input_include_ended boolean default false
) returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare
    cutoff timestamptz;
    items jsonb;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    if not exists(select 1 from pg_timezone_names where name=input_timezone) then
        raise exception 'Invalid timezone';
    end if;
    cutoff := case when input_on is null then now()
        else (input_on + 1)::timestamp at time zone input_timezone end;
    select coalesce(jsonb_agg(to_jsonb(latest) - 'user_id'
           order by latest.kind, latest.effective_at desc, latest.id desc), '[]'::jsonb)
      into items
    from (
        select distinct on (principle_id) *
        from public.principles
        where user_id=auth.uid()
          and (case when input_on is null then effective_at<=cutoff else effective_at<cutoff end)
        order by principle_id, effective_at desc, id desc
    ) latest
    where input_include_ended or not latest.ended;
    return jsonb_build_object('items',items,'on_date',input_on,'timezone',input_timezone);
end;
$$;

create function public.app_save_principle(
    input_principle_id uuid,
    input_expected_row_id bigint,
    input_kind text,
    input_body text,
    input_scope text default null,
    input_end boolean default false
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
    owner_id uuid := auth.uid();
    current_row public.principles%rowtype;
    saved public.principles%rowtype;
    next_kind text := trim(coalesce(input_kind,''));
    next_body text := trim(coalesce(input_body,''));
    next_scope text := nullif(trim(coalesce(input_scope,'')),'');
begin
    if owner_id is null then raise exception 'Authentication required'; end if;
    if input_principle_id is null then raise exception 'Principle ID is required'; end if;
    perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':principle:' || input_principle_id::text,0));
    select * into current_row from public.principles
    where user_id=owner_id and principle_id=input_principle_id
    order by effective_at desc,id desc limit 1 for update;

    if found then
        if input_end then
            next_kind:=current_row.kind;
            next_body:=current_row.body;
            next_scope:=current_row.scope;
        end if;
        if current_row.kind=next_kind and current_row.body=next_body
           and current_row.scope is not distinct from next_scope
           and current_row.ended=coalesce(input_end,false) then
            return to_jsonb(current_row)-'user_id';
        end if;
        if input_expected_row_id is distinct from current_row.id then
            raise exception 'Principle changed; reload before saving';
        end if;
    elsif input_expected_row_id is not null or input_end then
        raise exception 'Principle was not found';
    end if;

    if next_kind !~ '^[a-z][a-z0-9_]{0,63}$' then raise exception 'Invalid principle kind'; end if;
    if char_length(next_body) not between 1 and 10000 then raise exception 'Principle body is required'; end if;
    if next_scope is not null and char_length(next_scope)>200 then raise exception 'Principle scope is too long'; end if;
    insert into public.principles(principle_id,user_id,kind,body,scope,ended)
    values(input_principle_id,owner_id,next_kind,next_body,next_scope,coalesce(input_end,false))
    returning * into saved;
    return to_jsonb(saved)-'user_id';
end;
$$;

revoke all on function public.app_list_principles(date,text,boolean),
    public.app_save_principle(uuid,bigint,text,text,text,boolean) from public,anon;
grant execute on function public.app_list_principles(date,text,boolean),
    public.app_save_principle(uuid,bigint,text,text,text,boolean) to authenticated;
