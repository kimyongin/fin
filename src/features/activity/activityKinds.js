export const activityKinds = [
  { id: 'general', label: '일반' },
  { id: 'research', label: '조사' },
  { id: 'review', label: '점검' },
  { id: 'decision', label: '판단' },
  { id: 'retrospective', label: '회고' },
  { id: 'trade', label: '매매' },
  { id: 'reconciliation', label: '잔고 보정' },
  { id: 'task', label: '할 일' },
]

export const activityKindLabels = Object.fromEntries(activityKinds.map(({ id, label }) => [id, label]))
