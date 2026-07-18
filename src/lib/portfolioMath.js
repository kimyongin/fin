import { comparablePriceMetricTickers } from '../constants/portfolio'

export function hasComparablePriceMetrics(item) {
  if (!item) return true
  const instrumentType = item.instrument_type ?? item.instruments?.instrument_type ?? ''
  const ticker = String(item.ticker ?? '').toUpperCase()
  if ((instrumentType === 'cash' || instrumentType === 'other') && comparablePriceMetricTickers.has(ticker)) {
    return false
  }
  return true
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

export function normalizeTickerInput(value) {
  return String(value ?? '').trim().toUpperCase()
}

export function latestPrices(rows) {
  const seen = new Set()
  const result = []
  for (const row of rows) {
    if (row.source === 'holiday' || seen.has(row.ticker)) continue
    seen.add(row.ticker)
    result.push(row)
  }
  return result
}

export function fxTickerForCurrency(currency) {
  if (!currency || currency === 'KRW') return null
  return `${currency}KRW=X`
}

export function nativeToKrw(value, currency, latestPriceByTicker) {
  if (!Number.isFinite(value)) return 0
  const fxTicker = fxTickerForCurrency(currency)
  if (!fxTicker) return value
  const fxRate = latestPriceByTicker.get(fxTicker)?.close_price
  return Number.isFinite(fxRate) ? value * fxRate : 0
}

export function effectiveKrwValue(row, latestPriceByTicker) {
  if (Number.isFinite(row?.market_value_krw)) return row.market_value_krw
  if (!Number.isFinite(row?.market_value_native)) return 0
  return nativeToKrw(row.market_value_native, row?.currency, latestPriceByTicker)
}

export function matchesTagFilter(ticker, selectedTagId, tagMapByTicker) {
  if (selectedTagId === 'all') return true
  const tag = tagMapByTicker.get(ticker)
  if (selectedTagId === 'untagged') return !tag?.id
  return String(tag?.id ?? '') === selectedTagId
}
