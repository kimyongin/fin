-- Keep every historical body. Current reads select one owner-wide latest revision.
create or replace function public.app_list_principles(
  input_on date default null,
  input_timezone text default 'Asia/Seoul',
  input_include_ended boolean default false
) returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare
  cutoff timestamptz;
  latest public.principles%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from pg_timezone_names where name=input_timezone) then raise exception 'Invalid timezone'; end if;
  cutoff := case when input_on is null then clock_timestamp()
    else (input_on + 1)::timestamp at time zone input_timezone end;
  select * into latest from public.principles
  where user_id=auth.uid() and effective_at<cutoff
  order by effective_at desc,id desc limit 1;
  return jsonb_build_object('items',case when latest.id is null or (latest.ended and not input_include_ended)
    then '[]'::jsonb else jsonb_build_array(to_jsonb(latest)-'user_id') end,
    'on_date',input_on,'timezone',input_timezone);
end;
$$;

create or replace function public.app_save_principle(
  input_principle_id uuid,
  input_expected_row_id bigint,
  input_body text,
  input_change_note text default null,
  input_end boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  current_row public.principles%rowtype;
  saved public.principles%rowtype;
  next_note text:=nullif(trim(coalesce(input_change_note,'')), '');
  next_id uuid;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_end then raise exception 'Ending individual principles is no longer supported'; end if;
  if input_body is null or btrim(input_body)='' or char_length(input_body)>10000 then raise exception 'Principle body is required'; end if;
  if next_note is not null and char_length(next_note)>1000 then raise exception 'Principle change note is too long'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':principle',0));
  select * into current_row from public.principles where user_id=owner_id
    order by effective_at desc,id desc limit 1 for update;
  if found and not current_row.ended then
    if input_principle_id is distinct from current_row.principle_id then raise exception 'Current principle ID changed; reload before saving'; end if;
    if current_row.body=input_body and current_row.change_note is not distinct from next_note then
      return to_jsonb(current_row)-'user_id';
    end if;
    if input_expected_row_id is distinct from current_row.id then raise exception 'Principle changed; reload before saving'; end if;
    next_id:=current_row.principle_id;
  else
    if input_expected_row_id is not null then raise exception 'Principle changed; reload before saving'; end if;
    next_id:=coalesce(input_principle_id,gen_random_uuid());
    if exists(select 1 from public.principles where user_id=owner_id and principle_id=next_id) then
      raise exception 'Principle ID was previously used';
    end if;
  end if;
  insert into public.principles(principle_id,user_id,body,change_note,ended)
    values(next_id,owner_id,input_body,next_note,false) returning * into saved;
  return to_jsonb(saved)-'user_id';
end;
$$;
