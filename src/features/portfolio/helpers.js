import { normalizeEditableInstrumentType } from '../../constants/portfolio'
import { createSpreadsheetRows, spreadsheetColumns, spreadsheetCsvHeaders } from '../assets/spreadsheetSchema'

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

export function buildPortfolioCsv({ accounts, holdings, instrumentTags, instruments, computedPositions }) {
  const computedById = new Map(computedPositions.map((row) => [String(row.id), row]))
  const header = [...spreadsheetCsvHeaders, '현재 평가액', '현재가', '수익률']
  const rows = createSpreadsheetRows({ accounts, holdings, instrumentTags, instruments })
    .filter((row) => row.account_name && row.display_name)
    .slice()
    .sort((a, b) => {
      const byAccount = a.account_name.localeCompare(b.account_name, 'ko')
      if (byAccount !== 0) return byAccount

      return (computedById.get(String(b.id))?.market_value_krw ?? 0) - (computedById.get(String(a.id))?.market_value_krw ?? 0)
    })
    .map((row) => {
      const position = computedById.get(String(row.id))
      return [
        ...spreadsheetColumns.map(([field]) => row[field]),
        formatCsvNumber(position?.market_value_native),
        formatCsvNumber(position?.latestPrice),
        formatCsvNumber(position?.priceChangePercent),
      ]
    })

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

export function createInstrumentModalDraft({ instrument = null, tagId = '' }) {
  return {
    id: instrument?.id ?? null,
    ticker: instrument?.ticker ?? '',
    display_name: instrument?.display_name ?? '',
    currency: instrument?.currency ?? 'KRW',
    instrument_type: normalizeEditableInstrumentType(instrument?.instrument_type),
    note: instrument?.note ?? '',
    tag_id: tagId ? String(tagId) : '',
  }
}
