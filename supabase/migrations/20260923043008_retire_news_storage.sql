-- New research is a categorized activity. The previous facts/opinions and
-- their archive UI are intentionally retired under the user's clean-slate
-- data decision. The current daily-context base still asks for saved_news;
-- keep only an empty compatibility response until that context is simplified.
create or replace function public.app_get_news_state(input_owner_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if input_owner_user_id is not null and not public.can_view_owner(input_owner_user_id) then
    raise exception 'Portfolio access denied';
  end if;
  return jsonb_build_object('facts','[]'::jsonb);
end;
$$;

drop function if exists public.mcp_save_news_record(text,text,text,text);
drop function if exists public.mcp_get_news_state(text);
drop function if exists public.app_delete_news_fact_annotation(bigint);
drop function if exists public.app_delete_news_fact(bigint);
drop function if exists public.app_update_news_fact(bigint,text,text);
drop function if exists public.app_save_news_fact_annotation(bigint,text,text);
drop function if exists public.app_save_news_fact(date,text,text,text,text,text,text);
drop table if exists public.news_fact_annotations;
drop table if exists public.news_facts;
