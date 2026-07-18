import { describe, expect, it } from 'vitest'
import { buildBulkSnapshotCsv } from './snapshotCsv'

describe('buildBulkSnapshotCsv', () => {
  it('creates spreadsheet-compatible CSV rows from a portfolio snapshot', () => {
    const csv = buildBulkSnapshotCsv({
      accounts: [{ id: 1, name: 'ISA', broker: 'Mirae' }],
      instruments: [{ ticker: 'AAPL', display_name: 'Apple', currency: 'USD', instrument_type: 'market' }],
      instrument_tags: [{ ticker: 'AAPL', tag_id: 7 }],
      holdings: [{ account_id: 1, ticker: 'AAPL', quantity: 4, avg_price: 120, note: 'Core' }],
    })

    expect(csv.split('\r\n')).toEqual([
      '계좌명,증권사,종목명,티커,자산구분,수량,통화,평균매수가,매입금액,평가금액,태그,메모',
      'ISA,Mirae,Apple,AAPL,market,4,USD,120,,,7,Core',
    ])
  })
})
