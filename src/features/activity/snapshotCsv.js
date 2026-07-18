import { spreadsheetColumns, spreadsheetCsvHeaders } from '../assets/spreadsheetSchema'

function escapeCsvCell(value) {
  const normalized = value == null ? '' : String(value)
  return /[",\n\r]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized
}

export function buildBulkSnapshotCsv(snapshot) {
  const accountsById = new Map((snapshot?.accounts ?? []).map((account) => [String(account.id), account]))
  const instrumentsByTicker = new Map((snapshot?.instruments ?? []).map((instrument) => [instrument.ticker, instrument]))
  const tagIdByTicker = new Map((snapshot?.instrument_tags ?? []).map((item) => [item.ticker, item.tag_id]))
  const rows = (snapshot?.holdings ?? [])
    .slice()
    .sort((left, right) => {
      const leftAccount = accountsById.get(String(left.account_id))?.name ?? ''
      const rightAccount = accountsById.get(String(right.account_id))?.name ?? ''
      return leftAccount.localeCompare(rightAccount, 'ko') || String(left.ticker).localeCompare(String(right.ticker))
    })
    .map((holding) => {
      const account = accountsById.get(String(holding.account_id)) ?? {}
      const instrument = instrumentsByTicker.get(holding.ticker) ?? {}
      return {
        account_name: account.name ?? '',
        broker: account.broker ?? '',
        display_name: instrument.display_name ?? holding.ticker ?? '',
        ticker: holding.ticker ?? '',
        instrument_type: instrument.instrument_type ?? 'market',
        quantity: holding.quantity,
        currency: instrument.currency ?? 'KRW',
        avg_price: holding.avg_price,
        purchase_amount: holding.purchase_amount,
        valuation_amount: holding.valuation_amount,
        tag_id: tagIdByTicker.get(holding.ticker) ?? '',
        note: holding.note ?? '',
      }
    })

  return [spreadsheetCsvHeaders, ...rows]
    .map((row) => {
      const values = Array.isArray(row) ? row : spreadsheetColumns.map(([field]) => row[field])
      return values.map(escapeCsvCell).join(',')
    })
    .join('\r\n')
}
