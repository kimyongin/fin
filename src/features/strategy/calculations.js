export function calculateStrategyDashboard({ strategy, buckets, tagCards, totalValue, valuationQuality }) {
  const principles = strategy.principles ?? {}
  const mode = strategy.mode ?? 'neutral'
  const calculationAvailable = valuationQuality?.isComplete !== false
  const values = new Map(tagCards.map((tag) => [String(tag.id), tag.value]))
  const rows = buckets.map((bucket) => {
    const value = bucket.tag_ids.reduce((sum, id) => sum + (values.get(String(id)) ?? 0), 0)
    const targetPercentage = Number(bucket.mode_targets?.[mode] ?? bucket.target_percentage)
    const currentPercentage = calculationAvailable && totalValue > 0 ? (value / totalValue) * 100 : null
    return {
      ...bucket,
      value,
      targetPercentage,
      currentPercentage,
      differencePercentage: currentPercentage == null ? null : targetPercentage - currentPercentage,
      differenceValue: currentPercentage == null ? null : (totalValue * targetPercentage) / 100 - value,
    }
  })
  const contribution = Number(strategy.monthly_contribution) || 0
  const threshold = Number(strategy.drift_threshold)
  const deficits = rows.filter((row) => row.differenceValue > 0)
  const totalDeficit = deficits.reduce((sum, row) => sum + row.differenceValue, 0)
  const rebalance = rows.filter((row) => Math.abs(row.differencePercentage) >= threshold)
  const tradeCap = Math.min(Number(principles.max_trade_amount) || Infinity, Number(principles.monthly_trade_limit) || Infinity)
  const repairMonths = Math.max(1, Number(principles.contribution_repair_months) || 1)
  return { calculationAvailable, contribution, deficits, mode, rebalance, repairMonths, rows, threshold, totalDeficit, tradeCap }
}
