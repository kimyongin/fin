const KRW = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
})

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

const JPY = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  currencyDisplay: 'narrowSymbol',
  maximumFractionDigits: 0,
})

export function formatKrw(value) {
  return Number.isFinite(value) ? KRW.format(Math.round(value)) : '-'
}

export function formatMoney(value, currency = 'KRW') {
  if (!Number.isFinite(value)) return '-'
  if (currency === 'JPY') return JPY.format(Math.round(value))
  if (currency === 'USD') return USD.format(value)
  return formatKrw(value)
}

export function formatUnitPrice(value, currency = 'KRW') {
  if (!Number.isFinite(value)) return '-'
  return `${formatMoney(value, currency)} ${currency}`
}

export function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '-'
}

export function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return '-'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

export function returnToneClass(value) {
  if (value > 0) return 'text-red-400'
  if (value < 0) return 'text-blue-300'
  return 'text-[var(--muted-ink)]'
}

export function formatNumber(value) {
  return Number.isFinite(value)
    ? Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })
    : '-'
}

export function formattedValueWithConversion(nativeValue, currency, krwValue = null) {
  if (!Number.isFinite(nativeValue)) return '-'
  const converted =
    currency !== 'KRW' && Number.isFinite(krwValue) ? ` (${formatKrw(krwValue)} 환산)` : ''
  return `${formatMoney(nativeValue, currency)}${converted}`
}
