import { describe, expect, it } from 'vitest'
import { yahooTickerCandidates } from './yahoo-finance.ts'

describe('yahooTickerCandidates', () => {
  it('prefers an already resolved source symbol', () => {
    expect(yahooTickerCandidates('360750', '360750.KS')).toEqual([
      '360750.KS',
      '360750.KQ',
      '360750',
    ])
  })

  it('tries Korean and Japanese exchange suffixes before a bare numeric ticker', () => {
    expect(yahooTickerCandidates('133690')).toEqual(['133690.KS', '133690.KQ', '133690'])
    expect(yahooTickerCandidates('2621')).toEqual(['2621.T', '2621'])
  })

  it('uses an ordinary symbol without modification', () => {
    expect(yahooTickerCandidates('USDKRW=X')).toEqual(['USDKRW=X'])
  })
})
