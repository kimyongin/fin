import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const inputDir = process.argv[2] ?? 'C:/Users/yongin/Desktop/stocks'
const outputPath = process.argv[3] ?? path.join(inputDir, 'portfolio-import.csv')

function parseCsv(text) {
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
    } else if (character === ',' && !quoted) {
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

function numberValue(value) {
  const normalized = String(value ?? '').replaceAll(',', '').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeTicker(value) {
  const ticker = String(value ?? '').trim().toUpperCase()
  return /^A\d{6}$/.test(ticker) ? ticker.slice(1) : ticker
}

function resolveCashCurrency({ displayName, ticker }) {
  const normalizedName = displayName.replaceAll(' ', '').toUpperCase()
  if (ticker === 'USD' || normalizedName.includes('미국달러')) return 'USD'
  if (ticker === 'JPY' || normalizedName.includes('일본엔')) return 'JPY'
  return null
}

function resolveCurrency({ cashCurrency, displayName, ticker, sourceType }) {
  if (cashCurrency) return cashCurrency
  if (sourceType === '해외주식') return /^\d{4}$/.test(ticker) ? 'JPY' : 'USD'
  if (/^\d{4}$/.test(ticker) && /\bJPY\b/i.test(displayName)) return 'JPY'
  return 'KRW'
}

const outputFileName = path.basename(outputPath)
const fileNames = (await readdir(inputDir))
  .filter((name) => name.toLowerCase().endsWith('.csv') && !name.toLowerCase().startsWith('portfolio-import'))
  .filter((name) => name !== outputFileName)
  .sort()
const sourceRows = []

for (const fileName of fileNames) {
  const source = await readFile(path.join(inputDir, fileName))
  const utf8Text = new TextDecoder('utf-8').decode(source)
  const text = (utf8Text.includes('종목명') ? utf8Text : new TextDecoder('euc-kr').decode(source)).replace(/^\uFEFF/, '')
  const [header = [], ...records] = parseCsv(text)
  const indexByName = new Map(header.map((name, index) => [name.trim(), index]))
  const accountName = path.basename(fileName, path.extname(fileName))
  for (const record of records) {
    sourceRows.push({ accountName, indexByName, record })
  }
}

const tickerByDisplayName = new Map()
for (const { indexByName, record } of sourceRows) {
  const displayName = record[indexByName.get('종목명')]?.trim() ?? ''
  const ticker = normalizeTicker(record[indexByName.get('종목번호')])
  if (displayName && ticker) tickerByDisplayName.set(displayName, ticker)
}

const outputRows = []
for (const { accountName, indexByName, record } of sourceRows) {
    const displayName = record[indexByName.get('종목명')]?.trim() ?? ''
    const quantity = numberValue(record[indexByName.get('보유량')])
    if (!displayName || quantity == null) continue
    const sourceType = record[indexByName.get('유형')]?.trim() ?? ''
    const explicitAverage = numberValue(record[indexByName.get('평균단가')])
    const purchaseAmount = numberValue(record[indexByName.get('매입금액')])
    const valuationAmount = numberValue(record[indexByName.get('평가금액')])
    const ticker = normalizeTicker(record[indexByName.get('종목번호')]) || tickerByDisplayName.get(displayName) || ''
    const cashCurrency = resolveCashCurrency({ displayName, ticker })
    const currency = resolveCurrency({ cashCurrency, displayName, ticker, sourceType })
    const averagePrice = explicitAverage ?? (purchaseAmount != null && quantity !== 0 ? purchaseAmount / quantity : null)
    const roundedAveragePrice = averagePrice == null ? null : Math.round(averagePrice)
    const instrumentType = displayName.includes('현금성자산') || cashCurrency ? 'cash' : (explicitAverage != null || ticker ? 'market' : 'valuation')
    const resolvedTicker = instrumentType === 'cash' ? currency : ticker
    outputRows.push([
      accountName,
      '',
      displayName,
      resolvedTicker,
      instrumentType,
      instrumentType === 'market' ? String(quantity) : '',
      currency,
      instrumentType === 'market' && roundedAveragePrice != null && roundedAveragePrice > 0 ? String(roundedAveragePrice) : '',
      instrumentType === 'valuation' && purchaseAmount != null ? String(purchaseAmount) : '',
      (instrumentType === 'valuation' && valuationAmount != null) || instrumentType === 'cash' ? String(valuationAmount ?? quantity) : '',
      '',
      '',
    ])
}

const csv = [['계좌명', '증권사', '종목명', '티커', '자산구분', '수량', '통화', '평균매수가', '매입금액', '평가금액', '태그', '메모'], ...outputRows]
  .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""').replaceAll('\r', ' ').replaceAll('\n', ' ')}"`).join(','))
  .join('\n')

await writeFile(outputPath, `\uFEFF${csv}\n`, 'utf8')
console.log(`Wrote ${outputRows.length} rows to ${outputPath}`)
