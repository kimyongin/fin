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

export const STALE_PRICE_DAYS = 7

export function isPriceStale(priceDate, asOf = new Date(), staleDays = STALE_PRICE_DAYS) {
  if (!priceDate) return false
  const timestamp = Date.parse(`${priceDate}T00:00:00Z`)
  if (!Number.isFinite(timestamp)) return false
  const asOfTimestamp = asOf instanceof Date ? asOf.getTime() : Date.parse(asOf)
  return Number.isFinite(asOfTimestamp) && asOfTimestamp - timestamp > staleDays * 86400000
}

export function nativeToKrw(value, currency, latestPriceByTicker) {
  if (!Number.isFinite(value)) return null
  if (value === 0) return 0
  const fxTicker = fxTickerForCurrency(currency)
  if (!fxTicker) return value
  const fxRate = latestPriceByTicker.get(fxTicker)?.close_price
  return Number.isFinite(fxRate) && fxRate > 0 ? value * fxRate : null
}

export function effectiveKrwValue(row, latestPriceByTicker) {
  if (Number.isFinite(row?.market_value_krw)) return row.market_value_krw
  if (!Number.isFinite(row?.market_value_native)) return null
  return nativeToKrw(row.market_value_native, row?.currency, latestPriceByTicker)
}

export function resolvePositionValuation({
  instrumentType = 'market',
  currency = 'KRW',
  quantity = 0,
  valuationAmount = null,
  latestPrice = null,
  latestPriceByTicker,
  asOf = new Date(),
}) {
  const isMarket = instrumentType === 'market'
  const priceValue = latestPrice?.close_price
  const hasMarketPrice = Number.isFinite(priceValue) && priceValue > 0
  const marketValueNative = isMarket
    ? (quantity === 0 ? 0 : (hasMarketPrice ? quantity * priceValue : null))
    : (Number.isFinite(valuationAmount) ? valuationAmount : null)
  const fxTicker = fxTickerForCurrency(currency)
  const fxPrice = fxTicker ? latestPriceByTicker.get(fxTicker) : null
  const hasFxRate = !fxTicker || (Number.isFinite(fxPrice?.close_price) && fxPrice.close_price > 0)
  const issues = []
  if (isMarket && quantity !== 0 && !hasMarketPrice) issues.push('missing_price')
  if (!isMarket && !Number.isFinite(valuationAmount)) issues.push('missing_valuation')
  if (marketValueNative !== 0 && !hasFxRate) issues.push('missing_fx')
  if (hasMarketPrice && isPriceStale(latestPrice.price_date, asOf)) issues.push('stale_price')
  if (fxTicker && hasFxRate && isPriceStale(fxPrice.price_date, asOf)) issues.push('stale_fx')
  const missing = issues.some((issue) => issue.startsWith('missing_'))
  const stale = issues.some((issue) => issue.startsWith('stale_'))
  return {
    marketValueNative,
    marketValueKrw: nativeToKrw(marketValueNative, currency, latestPriceByTicker),
    status: missing ? 'missing' : stale ? 'stale' : 'complete',
    issues,
    priceDate: latestPrice?.price_date ?? null,
    fxTicker,
    fxPriceDate: fxPrice?.price_date ?? null,
  }
}

export function matchesTagFilter(ticker, selectedTagId, tagMapByTicker) {
  if (selectedTagId === 'all') return true
  const tag = tagMapByTicker.get(ticker)
  if (selectedTagId === 'untagged') return !tag?.id
  return String(tag?.id ?? '') === selectedTagId
}
