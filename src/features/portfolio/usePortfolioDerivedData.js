import { useMemo } from 'react'
import {
  effectiveKrwValue,
  matchesTagFilter,
  nativeToKrw,
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
      const instrumentType = instrument?.instrument_type ?? 'market'
      const latestPrice = latestPriceByTicker.get(holding.ticker)?.close_price
      const fallbackPrice = Number.isFinite(holding.avg_price) ? holding.avg_price : 0
      const marketPrice = Number.isFinite(latestPrice) ? latestPrice : fallbackPrice
      const quantity = Number(holding.quantity ?? 0)
      const avgPrice = Number(holding.avg_price ?? 0)
      const directPurchaseAmount = Number(holding.purchase_amount)
      const directValuationAmount = Number(holding.valuation_amount)
      const isValuation = instrumentType === 'valuation'
      const isCash = instrumentType === 'cash'
      const marketValueNative = isValuation
        ? (Number.isFinite(directValuationAmount) ? directValuationAmount : 0)
        : isCash
          ? (Number.isFinite(directValuationAmount) ? directValuationAmount : 0)
          : quantity * marketPrice
      const costBasisNative = isValuation
        ? (Number.isFinite(directPurchaseAmount) ? directPurchaseAmount : 0)
        : isCash
          ? 0
          : quantity * (Number.isFinite(avgPrice) ? avgPrice : 0)
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
        instrument_type: instrumentType,
        quantity,
        avgCost: !isValuation && !isCash && Number.isFinite(avgPrice) ? avgPrice : null,
        cost_basis_native: costBasisNative,
        cost_basis_krw: costBasisKrw,
        latestPrice: !isValuation && !isCash && Number.isFinite(latestPrice) ? latestPrice : null,
        market_value_native: marketValueNative,
        market_value_krw: marketValueKrw,
        priceChangePercent: isValuation || isCash
          ? (costBasisNative > 0 ? ((marketValueNative - costBasisNative) / costBasisNative) * 100 : null)
          : priceChangePercent,
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
          cost_basis_krw: costBasisKrw,
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
      current.cost_basis_native += pos.cost_basis_native ?? 0
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
        const avgCost = instrument.instrument_type === 'market' && quantity > 0 ? (position?.cost_basis_native ?? 0) / quantity : null
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
          latestPrice: instrument.instrument_type === 'market' ? latestPrice?.close_price ?? null : null,
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
      .map((tag) => ({
        ...tag,
        returnPercent:
          tag.costBasisKrw > 0 ? ((tag.value - tag.costBasisKrw) / tag.costBasisKrw) * 100 : null,
        holdings: tag.holdings.sort((a, b) => b.market_value_krw - a.market_value_krw),
      }))
      .sort((a, b) => b.value - a.value)
  }, [instrumentRows, tagMapByTicker, latestPriceByTicker])

  return {
    accountById,
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
