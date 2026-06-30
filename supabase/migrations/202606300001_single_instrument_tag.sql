with ranked_tags as (
    select
        it.id,
        row_number() over (
            partition by it.user_id, it.ticker
            order by
                case t.name
                    when '현금' then 1
                    when '채권' then 2
                    when 'AI' then 3
                    when '미국주식' then 4
                    when '기타' then 5
                    when 'ETF' then 6
                    else 99
                end,
                it.id
        ) as rn
    from public.instrument_tags it
    join public.tags t on t.id = it.tag_id
)
delete from public.instrument_tags it
using ranked_tags rt
where it.id = rt.id
  and rt.rn > 1;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'instrument_tags_user_id_ticker_key'
    ) then
        alter table public.instrument_tags
            add constraint instrument_tags_user_id_ticker_key unique (user_id, ticker);
    end if;
end $$;
