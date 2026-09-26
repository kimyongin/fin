import { describe, expect, it } from 'vitest'
import { exchangeRatesForPositions } from './exchangeRates'

describe('exchangeRatesForPositions', () => {
  it('shows each visible foreign holding currency once with its own quote date', () => {
    const positions = [{ currency: 'USD' }, { currency: 'KRW' }, { currency: 'JPY' }, { currency: 'USD' }]
    const prices = new Map([
      ['USDKRW=X', { close_price: 1350.1234, price_date: '2026-09-25' }],
      ['JPYKRW=X', { close_price: 9.45, price_date: '2026-09-20' }],
    ])
    expect(exchangeRatesForPositions(positions, prices, new Date('2026-09-26T00:00:00Z'))).toEqual([
      { currency: 'JPY', rate: 9.45, date: '2026-09-20', stale: false },
      { currency: 'USD', rate: 1350.1234, date: '2026-09-25', stale: false },
    ])
  })

  it('distinguishes missing and stale rates without substituting zero', () => {
    const positions = [{ currency: 'EUR' }, { currency: 'USD' }]
    const prices = new Map([
      ['EURKRW=X', { close_price: 0, price_date: '2026-09-26' }],
      ['USDKRW=X', { close_price: 1340, price_date: '2026-09-10' }],
    ])
    expect(exchangeRatesForPositions(positions, prices, new Date('2026-09-26T00:00:00Z'))).toEqual([
      { currency: 'EUR', rate: null, date: '2026-09-26', stale: false },
      { currency: 'USD', rate: 1340, date: '2026-09-10', stale: true },
    ])
  })
})
