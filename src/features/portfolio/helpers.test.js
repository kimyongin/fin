import { describe, expect, it } from 'vitest'
import {
  buildPortfolioCsv,
  createAccountModalDraft,
  createHoldingLookupResult,
  createHoldingModalDraft,
  createInstrumentModalDraft,
  createTagModalDraft,
} from './helpers'

describe('portfolio helpers', () => {
  it('builds CSV rows sorted by account and market value', () => {
    const accounts = new Map([
      [1, { id: 1, name: 'Beta' }],
      [2, { id: 2, name: 'Alpha' }],
    ])
    const csv = buildPortfolioCsv(
      [
        {
          account_id: 1,
          display_name: 'Plain',
          ticker: 'BBB',
          currency: 'KRW',
          market_value_native: 10,
          avgCost: 1,
          latestPrice: 2,
          priceChangePercent: 100,
          market_value_krw: 10,
        },
        {
          account_id: 2,
          display_name: 'Needs, Quote "Here"',
          ticker: 'AAA',
          currency: 'USD',
          market_value_native: 20.5,
          avgCost: 10,
          latestPrice: 20.5,
          priceChangePercent: 105,
          market_value_krw: 30000,
        },
      ],
      accounts,
    )

    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('Alpha,"Needs, Quote ""Here""",AAA,USD,20.5,10,20.5,105')
    expect(lines[2]).toBe('Beta,Plain,BBB,KRW,10,1,2,100')
  })

  it('creates modal drafts with normalized defaults', () => {
    expect(createAccountModalDraft({ id: 3, name: 'ISA', broker: null, note: 'memo' })).toEqual({
      id: 3,
      name: 'ISA',
      broker: '',
      note: 'memo',
    })

    expect(
      createInstrumentModalDraft({
        instrument: {
          id: 9,
          ticker: 'AAPL',
          display_name: 'Apple',
          currency: 'USD',
          instrument_type: 'stock',
          note: 'Core position',
        },
        latestPrice: { close_price: 123.45, price_date: '2026-07-12' },
        tagId: 4,
      }),
    ).toMatchObject({
      id: 9,
      ticker: 'AAPL',
      display_name: 'Apple',
      currency: 'USD',
      instrument_type: 'stock',
      note: 'Core position',
      price: '123.45',
      price_date: '2026-07-12',
      tag_id: '4',
      linked_account_id: '',
    })

    expect(createTagModalDraft({ nextSortOrder: 2 })).toEqual({
      id: null,
      name: '',
      color: 'neutral',
      sort_order: '2',
    })
  })

  it('creates holding drafts and lookup results from instruments and prices', () => {
    const latestPriceByTicker = new Map([['AAPL', { close_price: 200, price_date: '2026-07-12' }]])
    const instruments = [{ ticker: 'AAPL', display_name: 'Apple', currency: 'USD', instrument_type: 'stock' }]

    expect(createHoldingLookupResult({ ticker: '' })).toBeNull()
    expect(createHoldingModalDraft({ accountId: 5, instruments, latestPriceByTicker, ticker: ' aapl ' })).toEqual({
      draft: {
        id: null,
        account_id: '5',
        ticker: 'AAPL',
        quantity: '',
        avg_price: '',
        note: '',
      },
      lookupResult: {
        ticker: 'AAPL',
        display_name: 'Apple',
        currency: 'USD',
        instrument_type: 'stock',
        price: 200,
        price_date: '2026-07-12',
        source: 'existing',
      },
    })
  })
})
