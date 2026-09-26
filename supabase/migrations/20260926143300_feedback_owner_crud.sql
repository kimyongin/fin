-- A reporter may correct or remove their own submission, not administrator triage.
create function public.app_get_my_product_feedback(input_feedback_id uuid)
returns jsonb language plpgsql security definer stable set search_path=public,auth as $$
declare current_row public.product_feedback%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into current_row from public.product_feedback
    where id=input_feedback_id and reporter_user_id=auth.uid();
  if not found then raise exception 'feedback not found'; end if;
  return to_jsonb(current_row) - 'reporter_user_id';
end;
$$;

create function public.app_update_my_product_feedback(input_feedback_id uuid, input_expected_version integer, input_body text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare current_row public.product_feedback%rowtype; normalized_body text:=btrim(coalesce(input_body,''));
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'anonymous sessions cannot update product feedback'; end if;
  if char_length(normalized_body) not between 1 and 4000 then raise exception 'feedback body must contain 1 to 4000 characters'; end if;
  select * into current_row from public.product_feedback
    where id=input_feedback_id and reporter_user_id=auth.uid() for update;
  if not found then raise exception 'feedback not found'; end if;
  if current_row.version<>input_expected_version then raise exception 'feedback version conflict'; end if;
  if current_row.body=normalized_body then return to_jsonb(current_row)-'reporter_user_id'; end if;
  update public.product_feedback set body=normalized_body,version=version+1,updated_at=now()
    where id=input_feedback_id returning * into current_row;
  -- Old submission text is not a second history store. Its prior retry key remains sealed.
  update public.product_feedback_mutation_receipts
    set request_payload=(request_payload-'body')||'{"redacted":true}'::jsonb,
        response_payload=response_payload-'body'
    where reporter_user_id=auth.uid() and response_payload->>'id'=input_feedback_id::text;
  return to_jsonb(current_row)-'reporter_user_id';
end;
$$;

create function public.app_delete_my_product_feedback(input_feedback_id uuid, input_expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare current_row public.product_feedback%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'anonymous sessions cannot delete product feedback'; end if;
  select * into current_row from public.product_feedback
    where id=input_feedback_id and reporter_user_id=auth.uid() for update;
  if not found then raise exception 'feedback not found'; end if;
  if current_row.version<>input_expected_version then raise exception 'feedback version conflict'; end if;
  update public.product_feedback_mutation_receipts
    set request_payload=(request_payload-'body')||'{"deleted":true}'::jsonb,
        response_payload=(response_payload-'body')||'{"deleted":true}'::jsonb
    where reporter_user_id=auth.uid() and response_payload->>'id'=input_feedback_id::text;
  delete from public.product_feedback where id=input_feedback_id;
  return jsonb_build_object('id',input_feedback_id,'deleted',true,'github_issue_url',current_row.github_issue_url);
end;
$$;

revoke all on function public.app_get_my_product_feedback(uuid) from public,anon;
revoke all on function public.app_update_my_product_feedback(uuid,integer,text) from public,anon;
revoke all on function public.app_delete_my_product_feedback(uuid,integer) from public,anon;
grant execute on function public.app_get_my_product_feedback(uuid) to authenticated;
grant execute on function public.app_update_my_product_feedback(uuid,integer,text) to authenticated;
grant execute on function public.app_delete_my_product_feedback(uuid,integer) to authenticated;
