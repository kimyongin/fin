const automaticTitles = {
  update_entity_note: '메모 수정',
  create_account: '계좌 등록', update_account: '계좌 수정', delete_account: '계좌 삭제',
  create_instrument: '종목 등록', update_instrument: '종목 수정', delete_instrument: '종목 삭제',
  create_holding: '보유 추가', update_holding: '보유 수정', delete_holding: '보유 삭제',
  update_holding_avg_price: '평균가 수정',
  create_tag: '태그 추가', update_tag: '태그 수정', delete_tag: '태그 삭제',
  update_strategy: '목표 배분 변경', reset_allocation_targets: '목표 배분 초기화',
  bulk_edit_portfolio: '표 편집', save_asset_detail: '자산 정보 수정',
  log_completed_trade: '매매 기록', reconcile_holding: '잔고 보정',
  complete_general_task: '할 일 완료', reopen_general_task: '할 일 다시 열기',
  cancel_general_task: '반복 중단', update_principle: '원칙 변경',
}

export function activityReadableTitle(activity) {
  return activity?.title?.trim() || activity?.after_data?.title?.trim()
    || automaticTitles[activity?.action_type] || '활동 기록'
}
