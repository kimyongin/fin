-- Search only the caller's existing instruments or tasks before limiting results.
-- A task's completion does not remove it from reference search.
create function public.app_search_activity_references(
  input_kind text, input_query text, input_offset integer default 0, input_limit integer default 20
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  owner_id uuid := auth.uid();
  search_text text := trim(coalesce(input_query, ''));
  rows jsonb;
  result_count integer;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if input_kind not in ('instrument', 'task') or char_length(search_text) > 100
     or input_offset < 0 or input_offset > 1000 or input_limit < 1 or input_limit > 30 then
    raise exception 'Invalid reference search';
  end if;
  if search_text = '' then return jsonb_build_object('items', '[]'::jsonb, 'next_offset', null); end if;

  if input_kind = 'instrument' then
    select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'display_name', r.display_name,
      'ticker', r.ticker) order by r.display_name, r.id), '[]'::jsonb), count(*)
      into rows, result_count
    from (select i.id, i.display_name, i.ticker from public.instruments i
      where i.user_id = owner_id and i.instrument_type <> 'fx'
        and (i.display_name ilike '%' || search_text || '%' or i.ticker ilike '%' || search_text || '%')
      order by i.display_name, i.id offset input_offset limit input_limit + 1) r;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title,
      'due_date', r.due_date, 'recurrence_kind', r.recurrence_kind,
      'control_state', r.control_state) order by r.title, r.id), '[]'::jsonb), count(*)
      into rows, result_count
    from (select t.id, t.title, t.due_date, t.recurrence_kind, t.control_state
      from public.portfolio_tasks t where t.user_id = owner_id and t.kind = 'general'
        and t.title ilike '%' || search_text || '%'
      order by t.title, t.id offset input_offset limit input_limit + 1) r;
  end if;
  return jsonb_build_object('items', (select coalesce(jsonb_agg(value), '[]'::jsonb)
      from (select value from jsonb_array_elements(rows) with ordinality e(value, n)
        where n <= input_limit order by n) limited),
    'next_offset', case when result_count > input_limit then input_offset + input_limit else null end);
end;
$$;
revoke all on function public.app_search_activity_references(text,text,integer,integer) from public, anon;
grant execute on function public.app_search_activity_references(text,text,integer,integer) to authenticated;

-- Old valid holding links can be navigated at the instrument level. A missing
-- holding stays unlinked rather than guessing from the record body.
update public.activity_events event set instrument_id = instrument.id
from public.holdings holding join public.instruments instrument
  on instrument.user_id = holding.user_id and instrument.ticker = holding.ticker
where event.holding_id = holding.id and event.user_id = holding.user_id
  and event.instrument_id is null;

create or replace function public.app_get_activity_without_tags(
  input_activity_id bigint,input_owner_user_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  selected_owner uuid:=coalesce(input_owner_user_id,auth.uid());
  owns boolean:=selected_owner=auth.uid();
  tasks_allowed boolean;
  assets_allowed boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if selected_owner is null then raise exception 'Owner is required'; end if;
  if not owns and not public.can_view_feature(selected_owner,'activity') then return null; end if;
  tasks_allowed:=owns or public.can_view_feature(selected_owner,'tasks');
  assets_allowed:=owns or public.can_view_feature(selected_owner,'assets');
  return (select jsonb_build_object(
    'id',event.id,'version',case when owns then event.version end,
    'title',event.title,'body',event.body,'occurred_at',event.occurred_at,
    'occurrence_on',event.occurrence_on,'created_at',event.created_at,'updated_at',event.updated_at,
    'source',event.source,
    'instrument_id',case when assets_allowed then event.instrument_id end,
    'instrument_summary',case when not assets_allowed or event.instrument_id is null then null else
      (select jsonb_build_object('id',i.id,'display_name',i.display_name,'ticker',i.ticker)
       from public.instruments i where i.id=event.instrument_id and i.user_id=event.user_id) end,
    'account_id',case when assets_allowed then event.account_id end,
    'holding_id',case when assets_allowed then event.holding_id end,
    'holding_summary',case when not assets_allowed or event.holding_id is null then null else
      (select jsonb_build_object('id',holding.id,'ticker',holding.ticker,
        'account_name',account.name,'display_name',coalesce(instrument.display_name,holding.ticker))
       from public.holdings holding
       join public.accounts account on account.id=holding.account_id and account.user_id=holding.user_id
       left join public.instruments instrument on instrument.user_id=holding.user_id and instrument.ticker=holding.ticker
       where holding.id=event.holding_id and holding.user_id=event.user_id) end,
    'task_id',case when tasks_allowed then event.task_id end,
    'origin_task',case when not tasks_allowed or event.task_id is null then null else
      (select jsonb_build_object('id',task.id,'title',task.title,'kind',task.kind,
        'trigger_text',task.trigger_text,'due_date',task.due_date,
        'recurrence_kind',task.recurrence_kind,'recurrence_start_on',task.recurrence_start_on)
       from public.portfolio_tasks task where task.id=event.task_id and task.user_id=event.user_id) end,
    'editable_fields',case when owns then jsonb_build_array('title','body','occurred_at','instrument_id','account_id','holding_id','task_id') else '[]'::jsonb end,
    'action_type',case when owns then event.action_type end,
    'before_data',case when owns then event.before_data end,
    'after_data',case when owns then event.after_data end
  ) from public.activity_events event
  where event.id=input_activity_id and event.user_id=selected_owner and event.status='succeeded');
end;
$$;
