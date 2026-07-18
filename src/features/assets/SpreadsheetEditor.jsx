import { useEffect, useMemo, useState } from 'react'
import { MaximizeIcon, MinimizeIcon, UndoIcon } from '../../components/icons'
import { editableInstrumentTypeOptions } from '../../constants/portfolio'
import {
  createBlankSpreadsheetRow,
  createSpreadsheetRows,
  findMatchingSpreadsheetRow,
  parseSpreadsheetPaste,
  spreadsheetColumns,
  spreadsheetOriginalValueLabel,
  validateSpreadsheetRow,
} from './spreadsheetSchema'

function Cell({ changed, column, error, hasUndo, onChange, originalValue, row, tags }) {
  const [field, label, type] = column
  const unavailable = (row.instrument_type !== 'market' && field === 'avg_price')
    || (row.instrument_type !== 'valuation' && field === 'purchase_amount')
    || (!['valuation', 'cash'].includes(row.instrument_type) && field === 'valuation_amount')
    || (['valuation', 'cash'].includes(row.instrument_type) && field === 'quantity')
  const showOriginal = changed && originalValue !== undefined
  const className = `${showOriginal ? 'h-8' : 'h-10'} w-full min-w-28 border-0 bg-transparent px-2.5 text-sm outline-none focus:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:bg-black/20 disabled:text-[var(--muted-ink)] ${hasUndo ? 'pr-10' : ''} ${error ? 'bg-red-500/10 text-red-100' : changed ? 'bg-red-500/10 font-semibold text-red-300' : ''}`
  let control
  if (field === 'currency') control = <select aria-label={label} className={className} onChange={(event) => onChange(field, event.target.value)} value={row[field]}><option>KRW</option><option>USD</option><option>JPY</option></select>
  else if (field === 'instrument_type') control = <select aria-label={label} className={className} onChange={(event) => onChange(field, event.target.value)} value={row[field]}>{editableInstrumentTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
  else if (field === 'tag_id') control = <select aria-label={label} className={className} onChange={(event) => onChange(field, event.target.value)} value={row[field]}><option value="">없음</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>
  else control = <input aria-label={label} className={className} disabled={unavailable} min={type === 'number' ? '0' : undefined} onChange={(event) => onChange(field, event.target.value)} step={type === 'number' ? 'any' : undefined} type={type} value={unavailable ? '' : row[field]} />
  return <div className={showOriginal ? 'py-1' : ''}>{control}{showOriginal && <p className="truncate px-2.5 text-[11px] leading-4 text-[var(--muted-ink)]" title={spreadsheetOriginalValueLabel({ field, originalValue, tags })}>{spreadsheetOriginalValueLabel({ field, originalValue, tags })}</p>}</div>
}

function SpreadsheetTable({ errorsById, expanded, onChange, onPaste, onResetRow, rows, tags }) {
  const originalRowById = useMemo(() => new Map(rows.original.map((row) => [row.id, row])), [rows.original])
  return (
    <div className={`${expanded ? 'fixed inset-0 z-50 flex flex-col rounded-none border-0' : 'relative overflow-hidden rounded-lg border'} border-[var(--line)] bg-[var(--panel)]`}>
      <button aria-label={expanded ? '전체 화면 닫기' : '전체 화면으로 표 편집'} className="absolute right-1.5 top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)] text-white shadow-sm transition hover:brightness-95 [&>svg]:h-3.5 [&>svg]:w-3.5" onClick={rows.toggleExpanded} title={expanded ? '전체 화면 닫기' : '전체 화면으로 표 편집'} type="button">{expanded ? <MinimizeIcon /> : <MaximizeIcon />}</button>
      <div className={`spreadsheet-scroll overflow-auto ${expanded ? 'min-h-0 flex-1' : ''}`} onPaste={onPaste}>
        <table className="w-full min-w-[1080px] border-collapse text-left">
          <thead className="bg-[var(--surface-2)] text-xs font-medium text-[var(--muted-ink)]"><tr>{spreadsheetColumns.map(([, label]) => <th className="border-b border-[var(--line)] px-2.5 py-3" key={label}>{label}</th>)}</tr></thead>
          <tbody>{rows.visible.length === 0 ? <tr><td className="px-3 py-8 text-center text-sm text-[var(--muted-ink)]" colSpan={spreadsheetColumns.length}>일치하는 행이 없습니다.</td></tr> : rows.visible.map((row) => { const errors = errorsById.get(row.id); const original = originalRowById.get(row.id); const changed = !original || spreadsheetColumns.some(([field]) => String(row[field] ?? '') !== String(original[field] ?? '')); return <tr className={`border-b border-[var(--line)] last:border-b-0 ${changed ? 'bg-[var(--accent-soft)]' : ''}`} key={row.id}>{spreadsheetColumns.map((column, index) => { const field = column[0]; const cellChanged = !original || String(row[field] ?? '') !== String(original[field] ?? ''); const hasUndo = changed && index === 0; return <td className={`relative min-w-28 border-r border-[var(--line)] last:border-r-0 ${changed && index === 0 ? 'border-l-2 border-l-[var(--accent)]' : ''}`} key={field} title={errors[field] ?? ''}><Cell changed={cellChanged} column={column} error={errors[field]} hasUndo={hasUndo} onChange={(nextField, value) => onChange(row.id, nextField, value)} originalValue={original?.[field]} row={row} tags={tags} />{hasUndo && <button aria-label="행 변경 취소" className="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded border border-[var(--line)] bg-[var(--surface-3)] text-[var(--muted-ink)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]" onClick={() => onResetRow(row.id)} title="행 변경 취소" type="button"><UndoIcon /></button>}</td>})}</tr>})}</tbody>
        </table>
      </div>
    </div>
  )
}

export default function SpreadsheetEditor({ accounts, canSave = true, holdings, instrumentTags, instruments, onSave, saving, tags }) {
  const source = { accounts, holdings, instrumentTags, instruments }
  const [rows, setRows] = useState(() => createSpreadsheetRows(source))
  const [originalRows, setOriginalRows] = useState(() => createSpreadsheetRows(source))
  const [accountFilter, setAccountFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [savingError, setSavingError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const errorsById = useMemo(() => new Map(rows.map((row) => [row.id, validateSpreadsheetRow(row)])), [rows])
  const invalidRows = rows.filter((row) => Object.keys(errorsById.get(row.id)).length > 0)
  const hasChanges = useMemo(() => rows.length !== originalRows.length || rows.some((row, index) => {
    const original = originalRows[index]
    return !original || spreadsheetColumns.some(([field]) => String(row[field] ?? '') !== String(original[field] ?? ''))
  }), [originalRows, rows])
  const accountNames = useMemo(() => [...new Set(rows.map((row) => row.account_name.trim()).filter(Boolean))].sort(), [rows])
  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return rows.filter((row) => (accountFilter === 'all' || row.account_name === accountFilter) && (tagFilter === 'all' || row.tag_id === tagFilter) && (!normalizedQuery || [row.ticker, row.display_name, row.note].some((value) => value.toLowerCase().includes(normalizedQuery))))
  }, [accountFilter, query, rows, tagFilter])

  useEffect(() => {
    const nextRows = createSpreadsheetRows(source)
    setRows(nextRows)
    setOriginalRows(nextRows)
  }, [accounts, holdings, instrumentTags, instruments])

  useEffect(() => {
    const handleKeyDown = (event) => event.key === 'Escape' && setExpanded(false)
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  function updateRow(id, field, value) {
    setMessage(''); setSavingError('')
    setRows((current) => current.map((row) => row.id === id ? { ...row, [field]: field === 'ticker' ? value.toUpperCase() : value } : row))
  }
  function resetRow(id) {
    const original = originalRows.find((row) => row.id === id)
    setMessage(''); setSavingError('')
    setRows((current) => current.map((row) => row.id === id ? (original ? { ...original } : { ...createBlankSpreadsheetRow(), id }) : row))
  }
  function resetAllRows() { setMessage(''); setSavingError(''); setRows(originalRows.map((row) => ({ ...row }))) }
  function addRow() { setRows((current) => [...current, createBlankSpreadsheetRow()]) }
  function handlePaste(event) {
    const text = event.clipboardData.getData('text/plain')
    if (!text.includes('\t') && !text.includes('\n')) return
    event.preventDefault()
    const { rows: pastedRows, usesImportHeaders } = parseSpreadsheetPaste(text)
    if (!pastedRows.length) return
    setRows((current) => {
      if (!usesImportHeaders) return [...current, ...pastedRows.map((row) => ({ ...createBlankSpreadsheetRow(), ...row }))]
      const nextRows = [...current]
      pastedRows.forEach((importedRow) => {
        const matchingRow = findMatchingSpreadsheetRow(nextRows, importedRow)
        if (!matchingRow) nextRows.push({ ...createBlankSpreadsheetRow(), ...importedRow })
        else nextRows[nextRows.findIndex((row) => row.id === matchingRow.id)] = { ...matchingRow, ...Object.fromEntries(Object.entries(importedRow).filter(([, value]) => value !== '')) }
      })
      return nextRows
    })
    setMessage(usesImportHeaders ? `${pastedRows.length}개 행을 반영했습니다.` : `${pastedRows.length}개 행을 추가했습니다.`)
  }
  async function handleSave() {
    if (invalidRows.length) { setSavingError(`${invalidRows.length}개 행의 필수 입력값을 확인해 주세요.`); return }
    setSavingError('')
    try { const result = await onSave(rows); setMessage(`계좌 ${result.account_count}개, 종목 ${result.instrument_count}개, 보유내역 ${result.holding_count}개를 저장했습니다.`) }
    catch (error) { setSavingError(error.message ?? '표를 저장하지 못했습니다.') }
  }

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3"><div><h2 className="text-base font-semibold">표 편집</h2><p className="mt-1 text-sm text-[var(--muted-ink)]">엑셀에서 복사한 행을 표 안에 붙여넣고 한 번에 저장할 수 있습니다.</p></div><div className="flex w-full flex-wrap items-center gap-2 lg:w-auto"><select aria-label="계좌 필터" className="h-10 min-w-28 rounded-lg border border-[var(--line)] bg-[var(--surface-3)] px-3 text-sm outline-none focus:border-[var(--accent)]" onChange={(event) => setAccountFilter(event.target.value)} value={accountFilter}><option value="all">전체 계좌</option>{accountNames.map((name) => <option key={name} value={name}>{name}</option>)}</select><select aria-label="태그 필터" className="h-10 min-w-28 rounded-lg border border-[var(--line)] bg-[var(--surface-3)] px-3 text-sm outline-none focus:border-[var(--accent)]" onChange={(event) => setTagFilter(event.target.value)} value={tagFilter}><option value="all">전체 태그</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><input aria-label="종목 검색" className="h-10 min-w-36 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-3)] px-3 text-sm outline-none focus:border-[var(--accent)] lg:w-44 lg:flex-none" onChange={(event) => setQuery(event.target.value)} placeholder="티커 또는 종목명" value={query} /><button className="h-10 shrink-0 rounded-lg border border-[var(--line)] px-3 text-sm font-medium text-[var(--muted-ink)] hover:bg-[var(--surface-2)]" onClick={addRow} type="button">행 추가</button></div></div>
      <SpreadsheetTable errorsById={errorsById} expanded={expanded} onChange={updateRow} onPaste={handlePaste} onResetRow={resetRow} rows={{ original: originalRows, toggleExpanded: () => setExpanded((current) => !current), visible: visibleRows }} tags={tags} />
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="text-sm text-[var(--muted-ink)]">{visibleRows.length} / {rows.length}개 행{invalidRows.length > 0 ? ` · 확인 필요 ${invalidRows.length}개` : ' · 저장 가능'}</div><div className="flex items-center gap-2"><button className="h-10 rounded-lg border border-[var(--line)] px-3 text-sm font-medium text-[var(--muted-ink)] hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50" disabled={saving || !hasChanges} onClick={resetAllRows} type="button">전체 롤백</button><button className="h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={saving || !canSave} onClick={handleSave} type="button">{saving ? '저장 중' : '표 저장'}</button></div></div>
      {message && <p className="text-sm text-emerald-300">{message}</p>}
      {savingError && <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">{savingError}</p>}
    </section>
  )
}
