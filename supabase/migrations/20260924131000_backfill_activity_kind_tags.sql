-- Preserve the meaning of legacy categories as ordinary user-owned tags
-- before retiring the category column. This migration changes no read/write
-- contract and creates no reserved tag names.
with legacy(user_id,name) as (
  select distinct event.user_id,
    case event.record_kind
      when 'research' then '조사'
      when 'review' then '점검'
      when 'decision' then '판단'
      when 'retrospective' then '회고'
      when 'trade' then '매매'
      when 'reconciliation' then '잔고 보정'
    end
  from public.activity_events event
  where event.record_kind in ('research','review','decision','retrospective','trade','reconciliation')
)
insert into public.activity_tags(user_id,name)
select user_id,name from legacy
on conflict do nothing;

with legacy(event_id,user_id,name) as (
  select event.id,event.user_id,
    case event.record_kind
      when 'research' then '조사'
      when 'review' then '점검'
      when 'decision' then '판단'
      when 'retrospective' then '회고'
      when 'trade' then '매매'
      when 'reconciliation' then '잔고 보정'
    end
  from public.activity_events event
  where event.record_kind in ('research','review','decision','retrospective','trade','reconciliation')
)
insert into public.activity_event_tags(user_id,activity_event_id,tag_id)
select legacy.user_id,legacy.event_id,tag.id
from legacy join public.activity_tags tag
  on tag.user_id=legacy.user_id and lower(trim(tag.name))=lower(legacy.name)
on conflict do nothing;
