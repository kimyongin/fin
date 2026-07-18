import { describe, expect, it } from 'vitest'
import {
  findMatchingSpreadsheetRow,
  parseSpreadsheetPaste,
  spreadsheetCsvHeaders,
  validateSpreadsheetRow,
} from './spreadsheetSchema'

describe('spreadsheetSchema', () => {
  it('parses a header-based CSV export into editable fields', () => {
    const csv = [
      spreadsheetCsvHeaders.join(','),
      'ISA,Mirae,Apple,AAPL,market,4,USD,120,,,7,Core',
    ].join('\r\n')

    expect(parseSpreadsheetPaste(csv)).toEqual({
      rows: [{
        account_name: 'ISA',
        avg_price: '120',
        broker: 'Mirae',
        currency: 'USD',
        display_name: 'Apple',
        instrument_type: 'market',
        note: 'Core',
        quantity: '4',
        tag_id: '7',
        ticker: 'AAPL',
        purchase_amount: '',
        valuation_amount: '',
      }],
      usesImportHeaders: true,
    })
  })

  it('matches imported rows by account and ticker without changing another account', () => {
    const rows = [
      { id: '1', account_name: 'ISA', ticker: 'AAPL', display_name: 'Apple' },
      { id: '2', account_name: 'Pension', ticker: 'AAPL', display_name: 'Apple' },
    ]

    expect(findMatchingSpreadsheetRow(rows, { account_name: 'Pension', ticker: 'aapl' })?.id).toBe('2')
  })

  it('requires only the fields that belong to each asset type', () => {
    const cash = {
      account_name: 'ISA', avg_price: '', currency: 'KRW', display_name: 'Cash', instrument_type: 'cash',
      purchase_amount: '', quantity: '', ticker: 'KRW', valuation_amount: '3000000',
    }
    const market = { ...cash, instrument_type: 'market', quantity: '3', avg_price: '100', valuation_amount: '' }

    expect(validateSpreadsheetRow(cash)).toEqual({})
    expect(validateSpreadsheetRow(market)).toEqual({})
  })
})
