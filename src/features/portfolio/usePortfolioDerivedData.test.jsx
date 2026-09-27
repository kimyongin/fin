import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { usePortfolioDerivedData } from './usePortfolioDerivedData'

function derive(state, latestPriceByTicker) {
  let result
  function Capture() {
    result = usePortfolioDerivedData({ state, latestPriceByTicker })
    return null
  }
  renderToStaticMarkup(<Capture />)
  return result
}

describe('allocation scope', () => {
  it('keeps all accounts in assets while excluding only one holding of the same ticker', () => {
    const state = {
      accounts: [{ id: 1, name: '투자' }, { id: 2, name: '비상금' }],
      instruments: [
        { ticker: 'STOCK', display_name: '주식', instrument_type: 'market', currency: 'KRW' },
        { ticker: 'CASH', display_name: '현금', instrument_type: 'cash', currency: 'KRW' },
      ],
      holdings: [
        { id: 1, ticker: 'STOCK', account_id: 1, quantity: 1, avg_price: 50, include_in_allocation: true },
        { id: 2, ticker: 'CASH', account_id: 1, valuation_amount: 20, include_in_allocation: true },
        { id: 3, ticker: 'CASH', account_id: 2, valuation_amount: 20, include_in_allocation: false },
      ],
      instrumentTags: [
        { ticker: 'STOCK', tags: { id: 10, name: '주식' } },
        { ticker: 'CASH', tags: { id: 11, name: '현금' } },
      ],
      valuation_quality: null,
    }
    const result = derive(state, new Map([['STOCK', { close_price: 60, price_date: '2026-09-27' }]]))
    expect(result.totalValue).toBe(100)
    expect(result.allocationTotalValue).toBe(80)
    expect(result.excludedValue).toBe(20)
    expect(result.tagCards.map(({ name, value }) => [name, value])).toEqual([['주식', 60], ['현금', 20]])
  })

  it('does not let a missing quote on an excluded holding block included allocation', () => {
    const state = {
      accounts: [{ id: 1, name: '투자' }],
      instruments: [
        { ticker: 'CASH', display_name: '현금', instrument_type: 'cash', currency: 'KRW' },
        { ticker: 'MISSING', display_name: '시세 없음', instrument_type: 'market', currency: 'KRW' },
      ],
      holdings: [
        { id: 1, ticker: 'CASH', account_id: 1, valuation_amount: 20, include_in_allocation: true },
        { id: 2, ticker: 'MISSING', account_id: 1, quantity: 1, avg_price: 5, include_in_allocation: false },
      ],
      instrumentTags: [], valuation_quality: null,
    }
    const result = derive(state, new Map())
    expect(result.allocationTotalValue).toBe(20)
    expect(result.allocationValuationQuality.isComplete).toBe(true)
    expect(result.excludedMissingCount).toBe(1)
  })
})
