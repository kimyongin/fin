import { editableInstrumentTypeOptions, normalizeEditableInstrumentType } from '../../constants/portfolio'

export const spreadsheetColumns = [
  ['account_name', '계좌명', 'text'],
  ['broker', '증권사', 'text'],
  ['display_name', '종목명', 'text'],
  ['ticker', '티커', 'text'],
  ['instrument_type', '자산구분', 'select'],
  ['quantity', '수량', 'number'],
  ['currency', '통화', 'select'],
  ['avg_price', '평균매수가', 'number'],
  ['purchase_amount', '매입금액', 'number'],
  ['valuation_amount', '평가금액', 'number'],
  ['tag_id', '태그', 'select'],
  ['note', '메모', 'text'],
]

export const spreadsheetCsvHeaders = spreadsheetColumns.map(([, label]) => label)

export function createBlankSpreadsheetRow() {
  return {
    id: crypto.randomUUID(), account_name: '', broker: '', ticker: '', display_name: '', currency: 'KRW',
    instrument_type: 'market', quantity: '', avg_price: '', purchase_amount: '', valuation_amount: '', tag_id: '', note: '',
  }
}

export function createSpreadsheetRows({ accounts, holdings, instrumentTags, instruments }) {
  const accountById = new Map(accounts.map((account) => [String(account.id), account]))
  const instrumentByTicker = new Map(instruments.map((instrument) => [instrument.ticker, instrument]))
  const tagByTicker = new Map(instrumentTags.map((item) => [item.ticker, item.tag_id]))
  const rows = holdings.map((holding) => {
    const account = accountById.get(String(holding.account_id))
    const instrument = instrumentByTicker.get(holding.ticker) ?? holding.instruments ?? {}
    return {
      id: String(holding.id),
      account_name: account?.name ?? '',
      broker: account?.broker ?? '',
      ticker: holding.ticker ?? '',
      display_name: instrument.display_name ?? '',
      currency: instrument.currency ?? 'KRW',
      instrument_type: normalizeEditableInstrumentType(instrument.instrument_type),
      quantity: holding.quantity ?? '',
      avg_price: holding.avg_price ?? '',
      purchase_amount: holding.purchase_amount ?? '',
      valuation_amount: holding.valuation_amount ?? '',
      tag_id: tagByTicker.get(holding.ticker) ? String(tagByTicker.get(holding.ticker)) : '',
      note: holding.note ?? '',
    }
  })
  return rows.length ? rows : [createBlankSpreadsheetRow()]
}

export function validateSpreadsheetRow(row) {
  const errors = {}
  if (!row.account_name.trim()) errors.account_name = '계좌명이 필요합니다.'
  if (row.instrument_type === 'market' && !row.ticker.trim()) errors.ticker = '티커가 필요합니다.'
  if (!row.display_name.trim()) errors.display_name = '종목명이 필요합니다.'
  if (!['KRW', 'USD', 'JPY'].includes(row.currency)) errors.currency = '통화를 확인해 주세요.'
  const validNonnegativeNumber = (value) => value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0
  if (row.instrument_type === 'market' && !validNonnegativeNumber(row.quantity)) errors.quantity = '0 이상 입력하세요.'
  if (row.instrument_type === 'market' && !validNonnegativeNumber(row.avg_price)) errors.avg_price = '0 이상 입력하세요.'
  if (row.instrument_type === 'valuation' && !validNonnegativeNumber(row.purchase_amount)) errors.purchase_amount = '0 이상 입력하세요.'
  if (row.instrument_type === 'valuation' && !validNonnegativeNumber(row.valuation_amount)) errors.valuation_amount = '0 이상 입력하세요.'
  if (row.instrument_type === 'cash' && !validNonnegativeNumber(row.valuation_amount)) errors.valuation_amount = '0 이상 입력하세요.'
  return errors
}

const importHeaderFields = Object.fromEntries([
  ...spreadsheetColumns.map(([field, label]) => [label, field]),
  ['종류', 'instrument_type'],
  ['평균 매수가', 'avg_price'],
])

function parseClipboardRows(text) {
  const delimiter = text.includes('\t') ? '\t' : ','
  const rows = []
  let row = []
  let value = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else quoted = !quoted
    } else if (character === delimiter && !quoted) {
      row.push(value)
      value = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(value)
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      value = ''
    } else value += character
  }
  row.push(value)
  if (row.some((cell) => cell.trim())) rows.push(row)
  return rows
}

export function parseSpreadsheetPaste(text) {
  const pastedRows = parseClipboardRows(text.trim())
  if (!pastedRows.length) return { rows: [], usesImportHeaders: false }
  const fields = pastedRows[0].map((header) => importHeaderFields[header.trim()] ?? null)
  const usesImportHeaders = fields.some(Boolean)
  if (!usesImportHeaders) {
    return {
      rows: pastedRows.map((values) => Object.fromEntries(spreadsheetColumns.map(([field], index) => [field, values[index] ?? '']))),
      usesImportHeaders: false,
    }
  }
  return {
    rows: pastedRows.slice(1).map((values) => Object.fromEntries(fields.flatMap((field, index) => field ? [[field, values[index]?.trim() ?? '']] : []))),
    usesImportHeaders: true,
  }
}

function normalizeMatchValue(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function findMatchingSpreadsheetRow(rows, importedRow) {
  const accountName = normalizeMatchValue(importedRow.account_name)
  const ticker = normalizeMatchValue(importedRow.ticker)
  const displayName = normalizeMatchValue(importedRow.display_name)
  return rows.find((row) => {
    if (normalizeMatchValue(row.account_name) !== accountName) return false
    if (ticker) return normalizeMatchValue(row.ticker) === ticker
    return displayName && normalizeMatchValue(row.display_name) === displayName
  })
}

export function spreadsheetOriginalValueLabel({ field, originalValue, tags }) {
  if (originalValue === '') return '비어 있음'
  if (field === 'instrument_type') return editableInstrumentTypeOptions.find((option) => option.value === originalValue)?.label ?? originalValue
  if (field === 'tag_id') return tags.find((tag) => String(tag.id) === String(originalValue))?.name ?? '없음'
  return originalValue
}
