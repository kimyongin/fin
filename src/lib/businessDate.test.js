import { describe, expect, it } from 'vitest'

import { activityNoon, businessDate } from './businessDate'

describe('portfolio business dates', () => {
  it('uses the Korean calendar day through midnight and morning UTC boundaries', () => {
    expect(businessDate('2026-09-22T15:00:00Z')).toBe('2026-09-23')
    expect(businessDate('2026-09-22T22:00:00Z')).toBe('2026-09-23')
    expect(businessDate('2026-09-23T00:00:00Z')).toBe('2026-09-23')
    expect(businessDate('2026-09-23T14:59:59Z')).toBe('2026-09-23')
    expect(businessDate('2026-09-23T15:00:00Z')).toBe('2026-09-24')
  })

  it('honors an explicit recurrence timezone without changing the default', () => {
    expect(businessDate('2026-09-23T07:00:00Z', 'America/New_York')).toBe('2026-09-23')
    expect(businessDate('2026-09-23T03:00:00Z', 'America/New_York')).toBe('2026-09-22')
    expect(activityNoon('2026-09-23')).toBe('2026-09-23T12:00:00+09:00')
  })
})
