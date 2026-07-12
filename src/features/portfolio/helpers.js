import { normalizeTickerInput, today } from '../../lib/portfolioMath'

function escapeCsvCell(value) {
  const normalized = value == null ? '' : String(value)
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`
  }
  return normalized
}

function formatCsvNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return ''
  return Number(value).toFixed(digits).replace(/\.?0+$/, '')
}

export function buildPortfolioCsv(computedPositions, accountById) {
  const header = ['계좌', '종목', '티커', '통화', '평가금액', '평균가', '현재가', '수익률']
  const rows = computedPositions
    .slice()
    .sort((a, b) => {
      const accountNameA = accountById.get(a.account_id)?.name ?? ''
      const accountNameB = accountById.get(b.account_id)?.name ?? ''
      const byAccount = accountNameA.localeCompare(accountNameB, 'ko')
      if (byAccount !== 0) return byAccount

      return (b.market_value_krw ?? 0) - (a.market_value_krw ?? 0)
    })
    .map((position) => [
      accountById.get(position.account_id)?.name ?? '',
      position.display_name ?? position.ticker,
      position.ticker ?? '',
      position.currency ?? 'KRW',
      formatCsvNumber(position.market_value_native),
      formatCsvNumber(position.avgCost),
      formatCsvNumber(position.latestPrice),
      formatCsvNumber(position.priceChangePercent),
    ])

  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
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
    note: instrument?.note ?? '',
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
