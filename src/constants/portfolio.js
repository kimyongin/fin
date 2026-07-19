export const allTabs = [
  { id: 'overview', label: '자산' },
  { id: 'strategy', label: '전략' },
  { id: 'news', label: '뉴스' },
  { id: 'activity', label: '기록' },
  { id: 'settings', label: '설정' },
  { id: 'guide', label: '가이드' },
]

export const assetViewOptions = [
  { id: 'tags', label: '태그 기준' },
  { id: 'accounts', label: '계좌 기준' },
  { id: 'instruments', label: '종목 기준' },
  { id: 'sheet', label: '표 편집' },
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
