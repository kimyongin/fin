import { formatKrw, formatMoney, formatPercent, formatSignedPercent } from '../../lib/format'
import { normalizeTickerInput, today } from '../../lib/portfolioMath'

export function buildPortfolioMarkdown(tagCards, totalValue) {
  return tagCards
    .flatMap((tag) => {
      const percent = totalValue > 0 ? (tag.value / totalValue) * 100 : NaN
      return [
        `## ${tag.name} · ${formatPercent(percent)}`,
        `${formatKrw(tag.value)} · ${tag.holdings.length}개 통합 종목 · 평균단가 대비 ${formatSignedPercent(tag.returnPercent)}`,
        '',
        ...tag.holdings.flatMap((holding) => {
          const holdingPercent =
            totalValue > 0 ? (holding.market_value_krw / totalValue) * 100 : NaN
          const converted =
            holding.currency !== 'KRW'
              ? ` (${formatKrw(holding.market_value_krw)} 환산)`
              : ''
          return [
            `### ${holding.ticker} · ${formatPercent(holdingPercent)} · ${formatSignedPercent(holding.priceChangePercent)}`,
            holding.display_name ?? holding.ticker,
            `${formatMoney(holding.market_value_native, holding.currency)}${converted}`,
            '',
          ]
        }),
      ]
    })
    .join('\n')
    .trim()
}

export function createAccountModalDraft(account = null) {
  return {
    id: account?.id ?? null,
    name: account?.name ?? '',
    broker: account?.broker ?? '',
    note: account?.note ?? '',
  }
}

export function createInstrumentModalDraft({
  instrument = null,
  latestPrice = null,
  tagId = '',
}) {
  return {
    id: instrument?.id ?? null,
    ticker: instrument?.ticker ?? '',
    display_name: instrument?.display_name ?? '',
    currency: instrument?.currency ?? 'KRW',
    instrument_type: instrument?.instrument_type ?? 'etf',
    price: latestPrice?.close_price?.toString?.() ?? '',
    price_date: latestPrice?.price_date ?? today(),
    tag_id: tagId ? String(tagId) : '',
    linked_account_id: '',
  }
}

export function createHoldingLookupResult({ instrument = null, latestPrice = null, ticker = '' }) {
  if (!ticker) return null

  return {
    ticker,
    display_name: instrument?.display_name ?? ticker,
    currency: instrument?.currency ?? 'KRW',
    instrument_type: instrument?.instrument_type ?? 'stock',
    price: Number.isFinite(latestPrice?.close_price) ? latestPrice.close_price : null,
    price_date: latestPrice?.price_date ?? today(),
    source: instrument ? 'existing' : 'manual',
  }
}

export function createHoldingModalDraft({
  accountId = null,
  holding = null,
  instruments = [],
  latestPriceByTicker,
  ticker = '',
}) {
  const initialTicker = normalizeTickerInput(holding?.ticker ?? ticker ?? '')
  const initialInstrument =
    instruments.find((item) => item.ticker === initialTicker) ?? holding?.instruments ?? null
  const initialLatestPrice = initialTicker ? latestPriceByTicker.get(initialTicker) : null

  return {
    draft: {
      id: holding?.id ?? null,
      account_id: String(holding?.account_id ?? accountId ?? ''),
      ticker: initialTicker,
      quantity: holding?.quantity?.toString?.() ?? '',
      avg_price: holding?.avg_price?.toString?.() ?? '',
      note: holding?.note ?? '',
    },
    lookupResult: createHoldingLookupResult({
      instrument: initialInstrument,
      latestPrice: initialLatestPrice,
      ticker: initialTicker,
    }),
  }
}

export function createTagModalDraft({ nextSortOrder, tag = null }) {
  return {
    id: tag?.id ?? null,
    name: tag?.name ?? '',
    color: tag?.color ?? 'neutral',
    sort_order: String(tag?.sort_order ?? nextSortOrder),
  }
}
