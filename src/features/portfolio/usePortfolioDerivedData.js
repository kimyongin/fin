import { useMemo } from 'react'
import { chartPalette } from '../../constants/portfolio'
import {
  effectiveKrwValue,
  matchesTagFilter,
  nativeToKrw,
  resolveTagColor,
} from '../../lib/portfolioMath'

export function usePortfolioDerivedData({
  accountTagFilter,
  instrumentTagFilter,
  latestPriceByTicker,
  state,
}) {
  const computedPositions = useMemo(() => {
    const instrumentByTicker = new Map(state.instruments.map((instrument) => [instrument.ticker, instrument]))

    return state.holdings.map((holding) => {
      const instrument = holding.instruments ?? instrumentByTicker.get(holding.ticker) ?? null
      const latestPrice = latestPriceByTicker.get(holding.ticker)?.close_price
      const fallbackPrice = Number.isFinite(holding.avg_price) ? holding.avg_price : 0
      const marketPrice = Number.isFinite(latestPrice) ? latestPrice : fallbackPrice
      const quantity = Number(holding.quantity ?? 0)
      const avgPrice = Number(holding.avg_price ?? 0)
      const marketValueNative = quantity * marketPrice
      const costBasisNative = quantity * (Number.isFinite(avgPrice) ? avgPrice : 0)
      const marketValueKrw = nativeToKrw(marketValueNative, instrument?.currency ?? 'KRW', latestPriceByTicker)
      const costBasisKrw = nativeToKrw(costBasisNative, instrument?.currency ?? 'KRW', latestPriceByTicker)
      const priceChangePercent =
        Number.isFinite(latestPrice) && Number.isFinite(avgPrice) && avgPrice > 0
          ? ((latestPrice - avgPrice) / avgPrice) * 100
          : null

      return {
        ...holding,
        display_name: instrument?.display_name ?? holding.ticker,
        currency: instrument?.currency ?? 'KRW',
        instrument_type: instrument?.instrument_type ?? null,
        quantity,
        avgCost: Number.isFinite(avgPrice) ? avgPrice : null,
        cost_basis_native: costBasisNative,
        cost_basis_krw: costBasisKrw,
        latestPrice: Number.isFinite(latestPrice) ? latestPrice : null,
        market_value_native: marketValueNative,
        market_value_krw: marketValueKrw,
        priceChangePercent,
      }
    })
  }, [state.holdings, state.instruments, latestPriceByTicker])

  const totalValue = useMemo(
    () => computedPositions.reduce((sum, row) => sum + effectiveKrwValue(row, latestPriceByTicker), 0),
    [computedPositions, latestPriceByTicker],
  )

  const tagMapByTicker = useMemo(() => {
    const map = new Map()
    for (const row of state.instrumentTags) {
      if (!map.has(row.ticker) && row.tags) {
        map.set(row.ticker, row.tags)
      }
    }
    return map
  }, [state.instrumentTags])

  const holdingsByAccountId = useMemo(() => {
    const map = new Map()
    for (const row of computedPositions) {
      const items = map.get(row.account_id) ?? []
      items.push(row)
      map.set(row.account_id, items)
    }
    return map
  }, [computedPositions])

  const holdingsByTicker = useMemo(() => {
    const map = new Map()
    for (const row of computedPositions) {
      const items = map.get(row.ticker) ?? []
      items.push(row)
      map.set(row.ticker, items)
    }
    return map
  }, [computedPositions])

  const accountById = useMemo(() => {
    return new Map(state.accounts.map((account) => [account.id, account]))
  }, [state.accounts])

  const accountCards = useMemo(() => {
    return state.accounts
      .map((account) => {
        const rows = computedPositions.filter((pos) => pos.account_id === account.id)
        const marketValueKrw = rows.reduce(
          (sum, row) => sum + effectiveKrwValue(row, latestPriceByTicker),
          0,
        )
        const costBasisKrw = rows.reduce((sum, row) => sum + (row.cost_basis_krw ?? 0), 0)
        return {
          ...account,
          count: rows.length,
          market_value_krw: marketValueKrw,
          returnPercent:
            costBasisKrw > 0 ? ((marketValueKrw - costBasisKrw) / costBasisKrw) * 100 : null,
        }
      })
      .sort((a, b) => b.market_value_krw - a.market_value_krw)
  }, [state.accounts, computedPositions, latestPriceByTicker])

  const filteredAccountCards = useMemo(() => {
    if (accountTagFilter === 'all') return accountCards
    return accountCards.filter((account) => {
      const holdings = holdingsByAccountId.get(account.id) ?? []
      return holdings.some((holding) =>
        matchesTagFilter(holding.ticker, accountTagFilter, tagMapByTicker),
      )
    })
  }, [accountCards, accountTagFilter, holdingsByAccountId, tagMapByTicker])

  const instrumentRows = useMemo(() => {
    const aggregated = new Map()
    for (const pos of computedPositions) {
      const current = aggregated.get(pos.ticker) ?? {
        ticker: pos.ticker,
        display_name: pos.display_name,
        currency: pos.currency,
        quantity: 0,
        cost_basis_native: 0,
        market_value_native: 0,
        market_value_krw: 0,
        accounts: new Set(),
      }
      current.quantity += pos.quantity ?? 0
      current.cost_basis_native += (pos.quantity ?? 0) * (Number(pos.avg_price) || 0)
      current.market_value_native += pos.market_value_native ?? 0
      current.market_value_krw += effectiveKrwValue(pos, latestPriceByTicker)
      if (pos.account_id) current.accounts.add(pos.account_id)
      aggregated.set(pos.ticker, current)
    }

    return state.instruments
      .filter((item) => item.instrument_type !== 'fx')
      .map((instrument) => {
        const position = aggregated.get(instrument.ticker)
        const latestPrice = latestPriceByTicker.get(instrument.ticker)
        const tag = tagMapByTicker.get(instrument.ticker)
        const quantity = position?.quantity ?? 0
        const avgCost = quantity > 0 ? (position?.cost_basis_native ?? 0) / quantity : null
        const priceChangePercent =
          Number.isFinite(latestPrice?.close_price) && Number.isFinite(avgCost) && avgCost > 0
            ? ((latestPrice.close_price - avgCost) / avgCost) * 100
            : null
        return {
          ...instrument,
          tagId: tag?.id ? String(tag.id) : '',
          tagName: tag?.name ?? 'Untagged',
          quantity,
          avgCost,
          cost_basis_native: position?.cost_basis_native ?? 0,
          priceChangePercent,
          market_value_native: position?.market_value_native ?? 0,
          market_value_krw: position?.market_value_krw ?? 0,
          accountCount: position?.accounts.size ?? 0,
          latestPrice: latestPrice?.close_price ?? null,
          latestPriceDate: latestPrice?.price_date ?? '',
        }
      })
      .sort((a, b) => b.market_value_krw - a.market_value_krw || a.display_name.localeCompare(b.display_name))
  }, [state.instruments, computedPositions, latestPriceByTicker, tagMapByTicker])

  const filteredInstrumentRows = useMemo(() => {
    if (instrumentTagFilter === 'all') return instrumentRows
    if (instrumentTagFilter === 'untagged') {
      return instrumentRows.filter((instrument) =>
        matchesTagFilter(instrument.ticker, instrumentTagFilter, tagMapByTicker),
      )
    }
    return instrumentRows.filter((instrument) =>
      matchesTagFilter(instrument.ticker, instrumentTagFilter, tagMapByTicker),
    )
  }, [instrumentRows, instrumentTagFilter, tagMapByTicker])

  const tagCards = useMemo(() => {
    const rows = instrumentRows.filter((row) => (row.market_value_krw ?? 0) > 0)
    const byTag = new Map()
    for (const row of rows) {
      const tag = tagMapByTicker.get(row.ticker) ?? {
        id: 'untagged',
        name: 'Untagged',
        color: '#8a8e96',
      }
      const current = byTag.get(tag.id) ?? {
        ...tag,
        value: 0,
        costBasisKrw: 0,
        holdings: [],
      }
      current.value += row.market_value_krw ?? 0
      current.costBasisKrw += nativeToKrw(
        row.cost_basis_native ?? 0,
        row.currency,
        latestPriceByTicker,
      )
      current.holdings.push(row)
      byTag.set(tag.id, current)
    }

    return [...byTag.values()]
      .map((tag, index) => ({
        ...tag,
        color: resolveTagColor(tag.color, chartPalette[index % chartPalette.length]),
        returnPercent:
          tag.costBasisKrw > 0 ? ((tag.value - tag.costBasisKrw) / tag.costBasisKrw) * 100 : null,
        holdings: tag.holdings.sort((a, b) => b.market_value_krw - a.market_value_krw),
      }))
      .sort((a, b) => b.value - a.value)
  }, [instrumentRows, tagMapByTicker, latestPriceByTicker])

  const chartSlices = useMemo(() => {
    if (!totalValue) return []

    let cursor = 0
    return tagCards.map((tag, index) => {
      const value = Math.min((tag.value / totalValue) * 100, 100)
      const start = cursor
      const end = cursor + value
      cursor = end
      return {
        ...tag,
        start,
        end,
        color: tag.color || chartPalette[index % chartPalette.length],
      }
    })
  }, [tagCards, totalValue])

  const chartGradient = useMemo(() => {
    if (!chartSlices.length) return 'conic-gradient(#e7ddd2 0% 100%)'
    return `conic-gradient(${chartSlices
      .map((slice) => `${slice.color} ${slice.start}% ${slice.end}%`)
      .join(', ')})`
  }, [chartSlices])

  return {
    accountById,
    chartGradient,
    computedPositions,
    filteredAccountCards,
    filteredInstrumentRows,
    holdingsByAccountId,
    holdingsByTicker,
    instrumentRows,
    latestPriceByTicker,
    tagCards,
    tagMapByTicker,
    totalValue,
  }
}
