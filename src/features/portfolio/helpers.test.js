import { describe, expect, it } from 'vitest'
import { parseSpreadsheetPaste } from '../assets/spreadsheetSchema'
import {
  buildPortfolioCsv,
  createAccountModalDraft,
  createInstrumentModalDraft,
} from './helpers'

describe('portfolio helpers', () => {
  it('builds CSV rows sorted by account and market value', () => {
    const csv = buildPortfolioCsv({
      accounts: [{ id: 1, name: 'Beta' }, { id: 2, name: 'Alpha' }],
      holdings: [
        { id: 1, account_id: 1, ticker: 'BBB', quantity: 10, avg_price: 1, include_in_allocation: true },
        { id: 2, account_id: 2, ticker: 'AAA', quantity: 2, avg_price: 10, include_in_allocation: false },
      ],
      instruments: [
        { ticker: 'BBB', display_name: 'Plain', currency: 'KRW', instrument_type: 'market' },
        { ticker: 'AAA', display_name: 'Needs, Quote "Here"', currency: 'USD', instrument_type: 'market' },
      ],
      instrumentTags: [],
      computedPositions: [
        { id: 1, market_value_native: 10, latestPrice: 2, priceChangePercent: 100, market_value_krw: 10 },
        { id: 2, market_value_native: 20.5, latestPrice: 20.5, priceChangePercent: 105, market_value_krw: 30000 },
      ],
    })

    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('Alpha,,"Needs, Quote ""Here""",AAA,market,2,USD,10,,,,true,20.5,20.5,105')
    expect(lines[2]).toBe('Beta,,Plain,BBB,market,10,KRW,1,,,,false,10,2,100')
    const imported = parseSpreadsheetPaste(csv)
    expect(imported.usesImportHeaders).toBe(true)
    expect(imported.rows.map((row) => row.exclude_from_allocation)).toEqual(['true', 'false'])
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
