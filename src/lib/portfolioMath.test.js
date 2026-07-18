import { describe, expect, it } from 'vitest'
import {
  effectiveKrwValue,
  fxTickerForCurrency,
  hasComparablePriceMetrics,
  latestPrices,
  matchesTagFilter,
  nativeToKrw,
  normalizeTickerInput,
} from './portfolioMath'

describe('portfolioMath', () => {
  it('normalizes ticker input', () => {
    expect(normalizeTickerInput('  tiger360750 ')).toBe('TIGER360750')
    expect(normalizeTickerInput(null)).toBe('')
  })

  it('keeps only the first non-holiday price per ticker', () => {
    expect(
      latestPrices([
        { ticker: 'AAPL', close_price: 1, source: 'holiday' },
        { ticker: 'AAPL', close_price: 2, source: 'yahoo' },
        { ticker: 'AAPL', close_price: 3, source: 'manual' },
        { ticker: 'MSFT', close_price: 4, source: 'manual' },
      ]),
    ).toEqual([
      { ticker: 'AAPL', close_price: 2, source: 'yahoo' },
      { ticker: 'MSFT', close_price: 4, source: 'manual' },
    ])
  })

  it('converts native values to KRW with the matching FX ticker', () => {
    const prices = new Map([['USDKRW=X', { close_price: 1400 }]])

    expect(fxTickerForCurrency('USD')).toBe('USDKRW=X')
    expect(nativeToKrw(10, 'USD', prices)).toBe(14000)
    expect(nativeToKrw(10, 'KRW', prices)).toBe(10)
    expect(nativeToKrw(10, 'JPY', prices)).toBe(0)
  })

  it('prefers explicit KRW market value when present', () => {
    const prices = new Map([['USDKRW=X', { close_price: 1400 }]])

    expect(effectiveKrwValue({ market_value_krw: 123, market_value_native: 10, currency: 'USD' }, prices)).toBe(123)
    expect(effectiveKrwValue({ market_value_native: 10, currency: 'USD' }, prices)).toBe(14000)
  })

  it('resolves tags and comparable metric exceptions', () => {
    const tags = new Map([['AAPL', { id: 7 }]])

    expect(matchesTagFilter('AAPL', 'all', tags)).toBe(true)
    expect(matchesTagFilter('AAPL', '7', tags)).toBe(true)
    expect(matchesTagFilter('MSFT', 'untagged', tags)).toBe(true)
    expect(hasComparablePriceMetrics({ ticker: 'USD', instrument_type: 'cash' })).toBe(false)
    expect(hasComparablePriceMetrics({ ticker: 'AAPL', instrument_type: 'stock' })).toBe(true)
  })
})
