import { describe, expect, it } from 'vitest'
import { filterAssetRows, positionsForAssetRows, UNTAGGED_FILTER } from './filterAssets'

const rows = [
  { ticker: 'AAA', display_name: 'Alpha' },
  { ticker: 'BBB', display_name: 'Beta' },
  { ticker: 'CCC', display_name: 'Cash' },
]
const tagMap = new Map([['AAA', { id: 1, name: '주식' }], ['BBB', { id: 2, name: '안전' }]])

describe('asset list filters', () => {
  it('combines account-scoped rows, search and OR tag selections', () => {
    expect(filterAssetRows(rows, '', [], tagMap)).toEqual(rows)
    expect(filterAssetRows(rows, '', [UNTAGGED_FILTER, '1'], tagMap)).toEqual([rows[0], rows[2]])
    expect(filterAssetRows(rows, 'c', [UNTAGGED_FILTER, '1'], tagMap)).toEqual([rows[2]])
    expect(filterAssetRows(rows.slice(1), '', ['1'], tagMap)).toEqual([])
  })

  it('uses the same visible tickers for every account position in the summary', () => {
    const positions = [
      { ticker: 'AAA', account_id: 1, market_value_krw: 100 },
      { ticker: 'AAA', account_id: 2, market_value_krw: 200 },
      { ticker: 'BBB', account_id: 1, market_value_krw: 300 },
    ]
    expect(positionsForAssetRows(positions, [rows[0]])).toEqual(positions.slice(0, 2))
    expect(positionsForAssetRows(positions.filter((row) => row.account_id === 1), [rows[0]])).toEqual([positions[0]])
    expect(positionsForAssetRows(positions, [])).toEqual([])
  })
})
