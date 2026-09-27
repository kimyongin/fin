export const UNTAGGED_FILTER = 'untagged'

export function sortAssetRowsByTag(rows, tagMapByTicker) {
  return [...rows].sort((a, b) => {
    const leftTag = tagMapByTicker.get(a.ticker)?.name
    const rightTag = tagMapByTicker.get(b.ticker)?.name
    if (!leftTag || !rightTag) {
      if (!leftTag && rightTag) return 1
      if (leftTag && !rightTag) return -1
    }
    const byTag = (leftTag ?? '').localeCompare(rightTag ?? '', 'ko')
    return byTag || (b.market_value_krw ?? 0) - (a.market_value_krw ?? 0)
      || String(a.display_name ?? a.ticker).localeCompare(String(b.display_name ?? b.ticker), 'ko')
  })
}

export function filterAssetRows(rows, query, selectedTags, tagMapByTicker) {
  const term = query.trim().toLocaleLowerCase()
  return rows.filter((row) => {
    if (term && ![row.display_name, row.ticker].some((value) => String(value ?? '').toLocaleLowerCase().includes(term))) return false
    if (selectedTags.length === 0) return true
    const tag = tagMapByTicker.get(row.ticker)
    return (!tag && selectedTags.includes(UNTAGGED_FILTER)) || (tag && selectedTags.includes(String(tag.id)))
  })
}

export function positionsForAssetRows(positions, rows) {
  const tickers = new Set(rows.map((row) => row.ticker))
  return positions.filter((row) => tickers.has(row.ticker))
}
