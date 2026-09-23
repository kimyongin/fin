-- Preserve old classification as readable Markdown without inventing revisions.
do $$
begin
  if exists (
    select 1 from public.principles p
    where char_length(
      '## ' || case p.kind
        when 'investment' then '투자 방향' when 'goal' then '목표'
        when 'horizon' then '투자 기간' when 'liquidity' then '유동성'
        when 'risk' then '위험 허용' when 'trading' then '매매 방식'
        when 'operation' then '운영 규칙' when 'strategy' then '전략 메모'
        else p.kind end
      || case when p.scope is null then '' else E'\n적용 범위: ' || p.scope end
      || E'\n\n' || p.body
    ) > 10000
  ) then
    raise exception 'Principle migration needs review: Markdown prefix exceeds 10000 characters';
  end if;
end;
$$;

update public.principles p
set body = '## ' || case p.kind
  when 'investment' then '투자 방향' when 'goal' then '목표'
  when 'horizon' then '투자 기간' when 'liquidity' then '유동성'
  when 'risk' then '위험 허용' when 'trading' then '매매 방식'
  when 'operation' then '운영 규칙' when 'strategy' then '전략 메모'
  else p.kind end
  || case when p.scope is null then '' else E'\n적용 범위: ' || p.scope end
  || E'\n\n' || p.body;

drop function public.app_save_principle(uuid,bigint,text,text,text,boolean);
drop index public.principles_kind_idx;
alter table public.principles drop column kind, drop column scope;
alter table public.principles add column change_note text
  check (change_note is null or char_length(change_note) between 1 and 1000);

create or replace function public.app_list_principles(
  input_on date default null,
  input_timezone text default 'Asia/Seoul',
  input_include_ended boolean default false
) returns jsonb
language plpgsql volatile security definer set search_path=public
as $$
declare
  cutoff timestamptz;
  items jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then
    raise exception 'Invalid timezone';
  end if;
  cutoff := case when input_on is null then clock_timestamp()
    else (input_on + 1)::timestamp at time zone input_timezone end;
  select coalesce(jsonb_agg(to_jsonb(latest)-'user_id'
    order by latest.effective_at desc, latest.id desc), '[]'::jsonb)
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
  input_body text,
  input_change_note text default null,
  input_end boolean default false
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  owner_id uuid := auth.uid();
  current_row public.principles%rowtype;
  saved public.principles%rowtype;
  next_body text := input_body;
  next_note text := nullif(trim(coalesce(input_change_note,'')), '');
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_principle_id is null then raise exception 'Principle ID is required'; end if;
  if next_note is not null and char_length(next_note)>1000 then raise exception 'Principle change note is too long'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':principle:' || input_principle_id::text,0));
  select * into current_row from public.principles
  where user_id=owner_id and principle_id=input_principle_id
  order by effective_at desc,id desc limit 1 for update;

  if found then
    if input_end then next_body:=current_row.body; end if;
    if current_row.body=next_body
      and current_row.change_note is not distinct from next_note
      and current_row.ended=coalesce(input_end,false) then
      return to_jsonb(current_row)-'user_id';
    end if;
    if input_expected_row_id is distinct from current_row.id then
      raise exception 'Principle changed; reload before saving';
    end if;
  elsif input_expected_row_id is not null or input_end then
    raise exception 'Principle was not found';
  end if;

  if next_body is null or btrim(next_body) = '' or char_length(next_body)>10000 then
    raise exception 'Principle body is required';
  end if;
  insert into public.principles(principle_id,user_id,body,change_note,ended)
  values(input_principle_id,owner_id,next_body,next_note,coalesce(input_end,false))
  returning * into saved;
  return to_jsonb(saved)-'user_id';
end;
$$;

revoke all on function public.app_save_principle(uuid,bigint,text,text,boolean) from public,anon;
grant execute on function public.app_save_principle(uuid,bigint,text,text,boolean) to authenticated;

create or replace function public.app_list_principle_changes(
  input_limit integer default 20,
  input_cursor jsonb default null
) returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare
  page_limit integer;
  cursor_at timestamptz;
  cursor_id bigint;
  result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  page_limit := least(greatest(coalesce(input_limit, 20), 1), 50);
  if input_cursor is not null then
    if jsonb_typeof(input_cursor) <> 'object'
      or not (input_cursor ? 'effective_at' and input_cursor ? 'id') then
      raise exception 'Invalid principle change cursor';
    end if;
    begin
      cursor_at := (input_cursor ->> 'effective_at')::timestamptz;
      cursor_id := (input_cursor ->> 'id')::bigint;
    exception when others then
      raise exception 'Invalid principle change cursor';
    end;
    if cursor_at is null or cursor_id is null then raise exception 'Invalid principle change cursor'; end if;
  end if;

  with bounded as (
    select p.* from public.principles p
    where p.user_id=auth.uid()
      and (cursor_at is null or (p.effective_at,p.id)<(cursor_at,cursor_id))
    order by p.effective_at desc,p.id desc
    limit page_limit+1
  ), page as (
    select * from bounded order by effective_at desc,id desc limit page_limit
  ), decorated as (
    select p.effective_at,p.id,
      (to_jsonb(p)-'user_id') || jsonb_build_object(
        'change_type',case when p.ended then 'ended'
          when not exists (
            select 1 from public.principles old
            where old.user_id=p.user_id and old.principle_id=p.principle_id
              and (old.effective_at,old.id)<(p.effective_at,p.id)
          ) then 'added' else 'updated' end
      ) item
    from page p
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(item order by effective_at desc,id desc) from decorated),'[]'::jsonb),
    'next_cursor',case when (select count(*) from bounded)>page_limit
      then (select jsonb_build_object('effective_at',effective_at,'id',id)
        from page order by effective_at,id limit 1)
      else null end
  ) into result;
  return result;
end;
$$;
