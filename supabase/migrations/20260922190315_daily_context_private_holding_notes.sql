-- Transitional wrapper: context remains owner-only and shared briefing DTOs
-- omit context_snapshot. This will fold into the simplified context in #87.
alter function public.app_create_daily_context(text,text[])
    rename to app_create_daily_context_before_private_notes;
revoke all on function public.app_create_daily_context_before_private_notes(text,text[])
    from public,anon,authenticated;
revoke all on function public.app_create_daily_context_before_principles(text,text[])
    from public,anon,authenticated;

create function public.app_create_daily_context(
    input_timezone text default 'Asia/Seoul',
    input_subject_tickers text[] default null
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare
    created jsonb;
    snapshot_value jsonb;
begin
    if auth.uid() is null then raise exception 'Authentication required'; end if;
    created:=public.app_create_daily_context_before_private_notes(input_timezone,input_subject_tickers);
    update public.daily_review_contexts context
    set snapshot=jsonb_set(context.snapshot,'{private_holding_notes}',
        public.app_list_private_holding_notes()->'items')
    where context.id=(created->>'context_id')::uuid and context.user_id=auth.uid()
    returning context.snapshot into snapshot_value;
    if snapshot_value is null then raise exception 'Daily context was not found'; end if;
    return created || jsonb_build_object('snapshot',snapshot_value);
end;
$$;

revoke all on function public.app_create_daily_context(text,text[]) from public,anon;
grant execute on function public.app_create_daily_context(text,text[]) to authenticated;
