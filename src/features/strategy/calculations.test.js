import { describe, expect, it } from 'vitest'
import { calculateStrategyDashboard } from './calculations'

const buckets = [
  { id: 'a', tag_ids: ['one'], target_percentage: 50, mode_targets: { defensive: 40 } },
  { id: 'b', tag_ids: ['two'], target_percentage: 50, mode_targets: { defensive: 60 } },
]
const tagCards = [{ id: 'one', value: 700 }, { id: 'two', value: 300 }]
const strategy = { mode: 'defensive', monthly_contribution: 100, drift_threshold: 5, principles: { max_trade_amount: 200, monthly_trade_limit: 150, contribution_repair_months: 2 } }

describe('strategy dashboard calculations', () => {
  it('uses the active mode and preserves allocation and limit values', () => {
    const result = calculateStrategyDashboard({ strategy, buckets, tagCards, totalValue: 1000, valuationQuality: { isComplete: true } })
    expect(result.rows.map((row) => [row.currentPercentage, row.targetPercentage, row.differenceValue])).toEqual([[70, 40, -300], [30, 60, 300]])
    expect(result.deficits.map((row) => row.id)).toEqual(['b'])
    expect(result.rebalance.map((row) => row.id)).toEqual(['a', 'b'])
    expect([result.contribution, result.totalDeficit, result.tradeCap, result.repairMonths]).toEqual([100, 300, 150, 2])
  })

  it('does not calculate allocation from zero or incomplete valuation', () => {
    for (const [totalValue, valuationQuality] of [[0, { isComplete: true }], [1000, { isComplete: false }]]) {
      const result = calculateStrategyDashboard({ strategy, buckets, tagCards, totalValue, valuationQuality })
      expect(result.rows.every((row) => row.currentPercentage === null && row.differenceValue === null)).toBe(true)
      expect(result.rebalance).toEqual([])
    }
  })

  it('uses neutral targets and the lower monthly or single trade limit', () => {
    const neutral = { ...strategy, mode: 'neutral', drift_threshold: 25, principles: { max_trade_amount: 80, monthly_trade_limit: 200 } }
    const result = calculateStrategyDashboard({ strategy: neutral, buckets, tagCards, totalValue: 1000, valuationQuality: { isComplete: true } })
    expect(result.rows.map((row) => row.targetPercentage)).toEqual([50, 50])
    expect(result.rebalance).toEqual([])
    expect(result.tradeCap).toBe(80)
    expect(result.repairMonths).toBe(1)
  })
})
