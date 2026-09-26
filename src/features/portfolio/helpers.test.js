import { describe, expect, it } from 'vitest'
import {
  buildPortfolioCsv,
  createAccountModalDraft,
  createInstrumentModalDraft,
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
        tagId: 4,
      }),
    ).toMatchObject({
      id: 9,
      ticker: 'AAPL',
      display_name: 'Apple',
      currency: 'USD',
        instrument_type: 'market',
      note: 'Core position',
      tag_id: '4',
    })

  })

})
