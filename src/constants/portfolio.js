export const allTabs = [
  { id: 'overview', label: '자산' },
  { id: 'settings', label: '설정' },
]

export const assetViewOptions = [
  { id: 'tags', label: '태그 기준' },
  { id: 'accounts', label: '계좌 기준' },
  { id: 'instruments', label: '종목 기준' },
]

export const chartPalette = ['#db6a21', '#26c6da', '#7dd3fc', '#f97316', '#84cc16', '#facc15', '#fb7185']

export const tagColorOptions = [
  { value: 'orange', label: 'Orange' },
  { value: 'cyan', label: 'Cyan' },
  { value: 'blue', label: 'Blue' },
  { value: 'lime', label: 'Lime' },
  { value: 'amber', label: 'Amber' },
  { value: 'rose', label: 'Rose' },
  { value: 'violet', label: 'Violet' },
  { value: 'slate', label: 'Slate' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
  { value: 'danger', label: 'Danger' },
]

export const tagColorMap = {
  orange: '#ff8a00',
  cyan: '#26c6da',
  blue: '#7dd3fc',
  lime: '#84cc16',
  amber: '#f59e0b',
  rose: '#fb7185',
  violet: '#a78bfa',
  slate: '#94a3b8',
  neutral: '#8a8e96',
  info: '#26c6da',
  success: '#7cb342',
  warning: '#f59e0b',
  danger: '#ef4444',
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
