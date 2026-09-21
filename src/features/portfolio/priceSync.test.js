import { describe, expect, it } from 'vitest'
import { summarizePriceSync } from './priceSync'

describe('summarizePriceSync', () => {
  it('summarizes a successful sync with the number of stored rows', () => {
    expect(summarizePriceSync({
      total_count: 2,
      synced: [{ ticker: 'AAPL', rows: 3 }, { ticker: 'USDKRW=X', rows: 1 }],
      failed: [],
    })).toEqual({
      changed: true,
      message: '2/2개 종목 확인, 새 가격 4건 저장.',
      status: 'success',
    })
  })

  it('keeps partial failures visible instead of reporting a generic success', () => {
    const summary = summarizePriceSync({
      total_count: 2,
      synced: [{ ticker: 'AAPL', rows: 1 }],
      failed: [{ ticker: 'UNKNOWN', error: 'Yahoo symbol not found' }],
    })

    expect(summary.status).toBe('partial')
    expect(summary.message).toContain('실패 1개')
    expect(summary.message).toContain('UNKNOWN: Yahoo symbol not found')
  })

  it('throws when every requested ticker failed', () => {
    expect(() => summarizePriceSync({
      total_count: 1,
      synced: [],
      failed: [{ ticker: 'UNKNOWN', error: 'Yahoo response 429' }],
    })).toThrow('가격 동기화 실패: UNKNOWN: Yahoo response 429')
  })

  it('rejects a malformed function response', () => {
    expect(() => summarizePriceSync({})).toThrow('가격 동기화 결과를 확인할 수 없습니다.')
  })
})
