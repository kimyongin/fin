-- #168 S3: repair only unedited automatic placeholders whose original facts
-- are still present in that same row. Do not infer an old name/ticker from a
-- current asset, and do not rewrite any versioned user edit.
update public.activity_events e
set title=case e.action_type
    when 'update_entity_note' then case e.target_table
      when 'accounts' then '계좌 메모 수정' else '종목 메모 수정' end
    when 'create_account' then left(coalesce(e.after_data->>'name','계좌'),480)||' · 계좌 등록'
    when 'update_account' then left(coalesce(e.after_data->>'name',e.before_data->>'name','계좌'),480)||' · 계좌 수정'
    when 'delete_account' then left(coalesce(e.before_data->>'name','계좌'),480)||' · 계좌 삭제'
    when 'create_instrument' then left(coalesce(e.after_data->>'display_name','종목'),480)||' · 종목 등록'
    when 'update_instrument' then left(coalesce(e.after_data->>'display_name',e.before_data->>'display_name','종목'),480)||' · 종목 수정'
    when 'delete_instrument' then left(coalesce(e.before_data->>'display_name','종목'),480)||' · 종목 삭제'
    when 'create_tag' then left(coalesce(e.after_data->>'name','태그'),480)||' · 태그 추가'
    when 'update_tag' then left(coalesce(e.after_data->>'name',e.before_data->>'name','태그'),480)||' · 태그 수정'
    when 'delete_tag' then left(coalesce(e.before_data->>'name','태그'),480)||' · 태그 삭제'
    when 'create_holding' then left(coalesce(e.after_data->>'display_name',e.after_data->>'ticker','보유'),480)||' · 보유 추가'
    when 'update_holding' then left(coalesce(e.after_data->>'display_name',e.after_data->>'ticker','보유'),480)||' · 보유 수정'
    when 'delete_holding' then left(coalesce(e.before_data->>'display_name',e.before_data->>'ticker','보유'),480)||' · 보유 삭제'
    when 'update_strategy' then '목표 배분 변경'
    when 'reset_allocation_targets' then '목표 배분 초기화'
  end,
  body=case e.action_type
    when 'update_entity_note' then coalesce(nullif(e.after_data->>'note',''),'메모를 삭제했습니다.')
    when 'create_account' then format('계좌를 등록했습니다. 이름: %s%s',
      coalesce(e.after_data->>'name','확인 불가'),
      case when nullif(e.after_data->>'broker','') is null then '' else E'\n증권사: '||(e.after_data->>'broker') end)
    when 'update_account' then concat_ws(E'\n',
      '계좌 정보를 수정했습니다.',
      case when e.before_data->>'name' is distinct from e.after_data->>'name'
        then format('이름: %s → %s',coalesce(e.before_data->>'name','없음'),coalesce(e.after_data->>'name','없음')) end,
      case when e.before_data->>'broker' is distinct from e.after_data->>'broker'
        then format('증권사: %s → %s',coalesce(e.before_data->>'broker','없음'),coalesce(e.after_data->>'broker','없음')) end,
      case when e.before_data->>'note' is distinct from e.after_data->>'note'
        then coalesce(nullif(e.after_data->>'note',''),'메모를 삭제했습니다.') end)
    when 'delete_account' then format('%s 계좌를 삭제했습니다.',coalesce(e.before_data->>'name','당시 계좌'))
    when 'create_instrument' then format('종목을 등록했습니다. %s (%s)',
      coalesce(e.after_data->>'display_name','당시 종목'),coalesce(e.after_data->>'ticker','티커 확인 불가'))
    when 'update_instrument' then concat_ws(E'\n',
      format('종목 정보를 수정했습니다. %s (%s)',coalesce(e.after_data->>'display_name','당시 종목'),
        coalesce(e.after_data->>'ticker',e.before_data->>'ticker','티커 확인 불가')),
      case when e.before_data->>'note' is distinct from e.after_data->>'note'
        then coalesce(nullif(e.after_data->>'note',''),'메모를 삭제했습니다.') end)
    when 'delete_instrument' then format('종목을 삭제했습니다. %s (%s)',
      coalesce(e.before_data->>'display_name','당시 종목'),coalesce(e.before_data->>'ticker','티커 확인 불가'))
    when 'create_tag' then format('%s 태그를 추가했습니다.',coalesce(e.after_data->>'name','태그'))
    when 'update_tag' then format('태그 이름: %s → %s',
      coalesce(e.before_data->>'name','없음'),coalesce(e.after_data->>'name','없음'))
    when 'delete_tag' then format('%s 태그를 삭제했습니다.',coalesce(e.before_data->>'name','태그'))
    when 'create_holding' then format('%s · %s 보유를 추가했습니다. 수량: %s주, 평균가: %s',
      coalesce(e.after_data->>'account_name','당시 계좌'),
      coalesce(e.after_data->>'display_name',e.after_data->>'ticker','당시 종목'),
      coalesce(e.after_data->>'quantity','없음'),coalesce(e.after_data->>'avg_price','없음'))
    when 'update_holding' then concat_ws(E'\n',
      format('%s · %s 보유를 수정했습니다.',coalesce(e.after_data->>'account_name','당시 계좌'),
        coalesce(e.after_data->>'display_name',e.after_data->>'ticker','당시 종목')),
      case when e.before_data->>'quantity' is distinct from e.after_data->>'quantity'
        then format('수량: %s → %s주',coalesce(e.before_data->>'quantity','없음'),coalesce(e.after_data->>'quantity','없음')) end,
      case when e.before_data->>'avg_price' is distinct from e.after_data->>'avg_price'
        then format('평균가: %s → %s',coalesce(e.before_data->>'avg_price','없음'),coalesce(e.after_data->>'avg_price','없음')) end)
    when 'delete_holding' then format('%s · %s 보유를 삭제했습니다. 당시 수량: %s주, 평균가: %s',
      coalesce(e.before_data->>'account_name','당시 계좌'),
      coalesce(e.before_data->>'display_name',e.before_data->>'ticker','당시 종목'),
      coalesce(e.before_data->>'quantity','없음'),coalesce(e.before_data->>'avg_price','없음'))
    when 'update_strategy' then format('태그별 목표 배분을 변경했습니다. 당시 설정 항목: %s개.',
      case when jsonb_typeof(e.after_data)='array' then jsonb_array_length(e.after_data) else 0 end)
    when 'reset_allocation_targets' then '설정된 목표 배분을 초기화했습니다.'
  end,
  instrument_ticker=case
    when e.action_type in ('create_instrument','update_instrument')
      and e.after_data->>'instrument_type'='market'
      and upper(btrim(e.after_data->>'ticker')) ~ '^[A-Z0-9^][A-Z0-9.^=_-]{0,31}$'
      then public.app_normalize_activity_ticker(e.after_data->>'ticker')
    when e.action_type='delete_instrument' and e.before_data->>'instrument_type'='market'
      and upper(btrim(e.before_data->>'ticker')) ~ '^[A-Z0-9^][A-Z0-9.^=_-]{0,31}$'
      then public.app_normalize_activity_ticker(e.before_data->>'ticker')
    else e.instrument_ticker end
where e.status='succeeded' and e.version=1 and e.source in ('user','agent')
  and e.title is null and e.body='기록'
  and e.action_type in ('update_entity_note','create_account','update_account','delete_account',
    'create_instrument','update_instrument','delete_instrument','create_tag','update_tag','delete_tag',
    'create_holding','update_holding','delete_holding','update_strategy','reset_allocation_targets');
