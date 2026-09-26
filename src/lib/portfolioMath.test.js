import { describe, expect, it } from 'vitest'
import {
  effectiveKrwValue,
  fxTickerForCurrency,
  hasComparablePriceMetrics,
  latestPrices,
  matchesTagFilter,
  nativeToKrw,
  normalizeTickerInput,
  resolvePositionValuation,
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
    expect(nativeToKrw(10, 'JPY', prices)).toBeNull()
    expect(nativeToKrw(0, 'KRW', prices)).toBe(0)
    expect(nativeToKrw(0, 'JPY', prices)).toBe(0)
  })

  it('keeps missing prices and exchange rates out of known valuation', () => {
    const prices = new Map([
      ['OLD', { close_price: 150, price_date: '2026-09-01' }],
      ['USDKRW=X', { close_price: 0, price_date: '2026-09-20' }],
    ])

    expect(resolvePositionValuation({
      currency: 'USD', quantity: 2, latestPrice: prices.get('OLD'), latestPriceByTicker: prices, asOf: new Date('2026-09-21T00:00:00Z'),
    })).toMatchObject({ marketValueNative: 300, marketValueKrw: null, status: 'missing', issues: ['missing_fx', 'stale_price'] })
    expect(resolvePositionValuation({
      currency: 'USD', quantity: 2, latestPrice: null, latestPriceByTicker: prices,
    })).toMatchObject({ marketValueNative: null, status: 'missing', issues: ['missing_price'] })
    expect(resolvePositionValuation({
      currency: 'KRW', quantity: 0, latestPrice: null, latestPriceByTicker: prices,
    })).toMatchObject({ marketValueNative: 0, marketValueKrw: 0, status: 'complete', issues: [] })
    expect(resolvePositionValuation({
      instrumentType: 'valuation', currency: 'JPY', valuationAmount: 1000, latestPriceByTicker: prices,
    })).toMatchObject({ marketValueNative: 1000, marketValueKrw: null, status: 'missing', issues: ['missing_fx'] })
  })

  it('ignores old ticker quotes for directly valued and cash holdings', () => {
    const prices = new Map([['DIRECT', { close_price: 100, price_date: '2026-09-01' }]])
    const asOf = new Date('2026-09-26T00:00:00Z')

    for (const instrumentType of ['valuation', 'cash']) {
      expect(resolvePositionValuation({
        instrumentType, currency: 'KRW', valuationAmount: 1000,
        latestPrice: prices.get('DIRECT'), latestPriceByTicker: prices, asOf,
      })).toMatchObject({ marketValueNative: 1000, status: 'complete', issues: [] })
    }
  })

  it('warns on a stale exchange rate only when a foreign value needs conversion', () => {
    const prices = new Map([['USDKRW=X', { close_price: 1400, price_date: '2026-09-01' }]])
    const asOf = new Date('2026-09-26T00:00:00Z')

    expect(resolvePositionValuation({
      instrumentType: 'cash', currency: 'USD', valuationAmount: 100,
      latestPriceByTicker: prices, asOf,
    })).toMatchObject({ status: 'stale', issues: ['stale_fx'] })
    expect(resolvePositionValuation({
      instrumentType: 'cash', currency: 'USD', valuationAmount: 0,
      latestPriceByTicker: prices, asOf,
    })).toMatchObject({ status: 'complete', issues: [] })
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
