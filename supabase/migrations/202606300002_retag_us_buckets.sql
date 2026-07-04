do $$
declare
    uid uuid;
    tag_sp bigint;
    tag_qqq bigint;
    tag_tech bigint;
    tag_ai bigint;
    tag_long_bond bigint;
    tag_cashlike bigint;
    tag_cash bigint;
    tag_other bigint;
begin
    for uid in
        select distinct user_id
        from public.tags
    loop
        insert into public.tags (user_id, name, color, sort_order)
        values
            (uid, '미국-S&P500', 'neutral', 0),
            (uid, '미국-나스닥100', 'neutral', 1),
            (uid, '미국-테크', 'neutral', 2),
            (uid, '미국-AI인프라', 'neutral', 3),
            (uid, '미국-장기채', 'neutral', 4),
            (uid, '단기채/현금성', 'neutral', 5),
            (uid, '현금', 'neutral', 6),
            (uid, '기타', 'neutral', 7)
        on conflict (user_id, name) do update
        set sort_order = excluded.sort_order;

        select id into tag_sp from public.tags where user_id = uid and name = '미국-S&P500';
        select id into tag_qqq from public.tags where user_id = uid and name = '미국-나스닥100';
        select id into tag_tech from public.tags where user_id = uid and name = '미국-테크';
        select id into tag_ai from public.tags where user_id = uid and name = '미국-AI인프라';
        select id into tag_long_bond from public.tags where user_id = uid and name = '미국-장기채';
        select id into tag_cashlike from public.tags where user_id = uid and name = '단기채/현금성';
        select id into tag_cash from public.tags where user_id = uid and name = '현금';
        select id into tag_other from public.tags where user_id = uid and name = '기타';

        update public.instrument_tags
        set tag_id = case
            when ticker in ('360750', 'SPYM') then tag_sp
            when ticker in ('133690', 'QQQM') then tag_qqq
            when ticker in ('381170', 'DGRW') then tag_tech
            when ticker in ('487230', 'A0173Y0', '455850') then tag_ai
            when ticker in ('453850', '2621') then tag_long_bond
            when ticker in ('MANUAL-8590B4D706', 'IRP-KB-GUARANTEE') then tag_cashlike
            when ticker = 'CASH-KRW' then tag_cash
            else tag_other
        end
        where user_id = uid;
    end loop;
end $$;
