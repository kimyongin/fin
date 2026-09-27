import { describe, expect, it } from 'vitest'
import {
  createBlankSpreadsheetRow,
  createSpreadsheetRows,
  findMatchingSpreadsheetRow,
  parseSpreadsheetPaste,
  spreadsheetCsvHeaders,
  validateSpreadsheetRow,
} from './spreadsheetSchema'

describe('spreadsheetSchema', () => {
  it('parses a header-based CSV export into editable fields', () => {
    const csv = [
      spreadsheetCsvHeaders.join(','),
      'ISA,Mirae,Apple,AAPL,market,4,USD,120,,,7',
    ].join('\r\n')

    expect(parseSpreadsheetPaste(csv)).toEqual({
      rows: [{
        account_name: 'ISA',
        avg_price: '120',
        broker: 'Mirae',
        currency: 'USD',
        display_name: 'Apple',
        instrument_type: 'market',
        quantity: '4',
        tag_id: '7',
        exclude_from_allocation: '',
        ticker: 'AAPL',
        purchase_amount: '',
        valuation_amount: '',
      }],
      usesImportHeaders: true,
    })
  })

  it('converts the old inclusion CSV column to the exclusion setting', () => {
    const csv = '계좌명,종목명,티커,배분에 포함\r\nISA,Apple,AAPL,false\r\nISA,Bond,BOND,true'
    expect(parseSpreadsheetPaste(csv).rows[0]).toMatchObject({
      account_name: 'ISA', display_name: 'Apple', ticker: 'AAPL', exclude_from_allocation: 'true',
    })
    expect(parseSpreadsheetPaste(csv).rows[1].exclude_from_allocation).toBe('false')
  })

  it('shows new and included holdings as not excluded by default', () => {
    expect(createBlankSpreadsheetRow().exclude_from_allocation).toBe('false')
    const rows = createSpreadsheetRows({
      accounts: [{ id: 1, name: 'ISA' }],
      holdings: [
        { id: 1, account_id: 1, ticker: 'AAPL' },
        { id: 2, account_id: 1, ticker: 'BOND', include_in_allocation: false },
      ],
      instruments: [{ ticker: 'AAPL', display_name: 'Apple' }, { ticker: 'BOND', display_name: 'Bond' }],
      instrumentTags: [],
    })
    expect(rows.map((row) => row.exclude_from_allocation)).toEqual(['false', 'true'])
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
