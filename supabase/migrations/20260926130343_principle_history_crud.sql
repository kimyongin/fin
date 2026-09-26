-- A correction changes an existing revision, while an approved policy change
-- continues to append a new revision. The marker protects old five-argument
-- clients from silently overwriting a corrected current document.
alter table public.principles add column corrected_at timestamptz;

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
    if input_expected_row_id is distinct from current_row.id or current_row.corrected_at is not null then
      raise exception 'Principle changed; reload before saving';
    end if;
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

create function public.app_save_principle_checked(
  input_principle_id uuid,
  input_expected_row_id bigint,
  input_expected_body text,
  input_expected_change_note text,
  input_body text,
  input_change_note text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  current_row public.principles%rowtype;
  saved public.principles%rowtype;
  next_note text:=nullif(trim(coalesce(input_change_note,'')), '');
  next_id uuid;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
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
    if input_expected_row_id is distinct from current_row.id
       or input_expected_body is distinct from current_row.body
       or input_expected_change_note is distinct from current_row.change_note then
      raise exception 'Principle changed; reload before saving';
    end if;
    next_id:=current_row.principle_id;
  else
    if input_expected_row_id is not null or input_expected_body is not null or input_expected_change_note is not null then
      raise exception 'Principle changed; reload before saving';
    end if;
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

create function public.app_get_principle_row(input_row_id bigint)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare selected public.principles%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into selected from public.principles where user_id=auth.uid() and id=input_row_id;
  if not found then raise exception 'Principle revision not found'; end if;
  return to_jsonb(selected)-'user_id';
end;
$$;

create function public.app_correct_principle_row(
  input_row_id bigint,
  input_expected_body text,
  input_expected_change_note text,
  input_body text,
  input_change_note text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  selected public.principles%rowtype;
  next_note text:=nullif(trim(coalesce(input_change_note,'')), '');
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_body is null or btrim(input_body)='' or char_length(input_body)>10000 then raise exception 'Principle body is required'; end if;
  if next_note is not null and char_length(next_note)>1000 then raise exception 'Principle change note is too long'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':principle',0));
  select * into selected from public.principles where user_id=owner_id and id=input_row_id for update;
  if not found then raise exception 'Principle revision not found'; end if;
  if selected.body=input_body and selected.change_note is not distinct from next_note then
    return to_jsonb(selected)-'user_id';
  end if;
  if selected.body is distinct from input_expected_body
     or selected.change_note is distinct from input_expected_change_note then
    raise exception 'Principle revision changed; reload before saving';
  end if;
  update public.principles set body=input_body,change_note=next_note,corrected_at=clock_timestamp()
    where id=selected.id returning * into selected;
  return to_jsonb(selected)-'user_id';
end;
$$;

create function public.app_delete_principle_row(
  input_row_id bigint,
  input_expected_body text,
  input_expected_change_note text,
  input_expected_current_row_id bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  owner_id uuid:=auth.uid();
  selected public.principles%rowtype;
  current_row public.principles%rowtype;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || ':principle',0));
  select * into selected from public.principles where user_id=owner_id and id=input_row_id for update;
  if not found then raise exception 'Principle revision not found'; end if;
  select * into current_row from public.principles where user_id=owner_id
    order by effective_at desc,id desc limit 1 for update;
  if input_expected_current_row_id is distinct from current_row.id then
    raise exception 'Current principle changed; reload before deleting';
  end if;
  if selected.body is distinct from input_expected_body
     or selected.change_note is distinct from input_expected_change_note then
    raise exception 'Principle revision changed; reload before deleting';
  end if;
  delete from public.principles where id=selected.id and user_id=owner_id;
  select * into current_row from public.principles where user_id=owner_id
    order by effective_at desc,id desc limit 1;
  return jsonb_build_object('deleted_row_id',selected.id,
    'current',case when current_row.id is null or current_row.ended then null else to_jsonb(current_row)-'user_id' end);
end;
$$;

revoke all on function public.app_save_principle_checked(uuid,bigint,text,text,text,text),
  public.app_get_principle_row(bigint),
  public.app_correct_principle_row(bigint,text,text,text,text),
  public.app_delete_principle_row(bigint,text,text,bigint) from public,anon;
grant execute on function public.app_save_principle_checked(uuid,bigint,text,text,text,text),
  public.app_get_principle_row(bigint),
  public.app_correct_principle_row(bigint,text,text,text,text),
  public.app_delete_principle_row(bigint,text,text,bigint) to authenticated;
