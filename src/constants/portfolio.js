export const allTabs = [
  { id: 'overview', label: '자산' },
  { id: 'decisions', label: '판단 모아보기' },
  { id: 'tasks', label: '활동' },
  { id: 'strategy', label: '원칙' },
  { id: 'activity', label: '활동 내역 (이전 주소)' },
  { id: 'feedback', label: '피드백' },
  { id: 'settings', label: '설정' },
  { id: 'guide', label: '가이드' },
]

export const editableInstrumentTypeOptions = [
  { value: 'market', label: '시장형 투자' },
  { value: 'valuation', label: '평가형 투자' },
  { value: 'cash', label: '현금성' },
]

export function normalizeEditableInstrumentType(value) {
  if (value === 'valuation' || value === 'cash') return value
  return 'market'
}

export const comparablePriceMetricTickers = new Set([
  'AUD',
  'CAD',
  'CHF',
  'CNY',
  'EUR',
  'GBP',
  'HKD',
  'JPY',
  'KRW',
  'SGD',
  'USD',
])
