update public.tags
set color = case name
    when '미국-S&P500' then 'orange'
    when '미국-나스닥100' then 'cyan'
    when '미국-테크' then 'blue'
    when '미국-AI인프라' then 'rose'
    when '미국-장기채' then 'lime'
    when '단기채/현금성' then 'amber'
    when '현금' then 'slate'
    when '기타' then 'violet'
    else color
end
where name in (
    '미국-S&P500',
    '미국-나스닥100',
    '미국-테크',
    '미국-AI인프라',
    '미국-장기채',
    '단기채/현금성',
    '현금',
    '기타'
);
