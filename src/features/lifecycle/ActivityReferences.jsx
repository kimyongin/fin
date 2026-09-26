import { useEffect, useRef, useState } from 'react'

const inputClass = 'form-control'

function SearchReference({ disabled, kind, label, onChange, selectedId, selectedSummary, supabase }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState([])
  const [offset, setOffset] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [chosen, setChosen] = useState(null)
  const request = useRef(0)

  useEffect(() => {
    const sequence = ++request.current
    setItems([]); setOffset(null); setError(''); setActive(0)
    if (!query.trim()) { setOpen(false); setLoading(false); return }
    setOpen(true); setLoading(true)
    const timer = setTimeout(async () => {
      const { data, error: nextError } = await supabase.rpc('app_search_activity_references', {
        input_kind: kind, input_query: query.trim(), input_offset: 0, input_limit: 20,
      })
      if (request.current !== sequence) return
      setLoading(false)
      if (nextError) setError('검색하지 못했습니다. 다시 시도해 주세요.')
      else { setItems(data?.items ?? []); setOffset(data?.next_offset ?? null) }
    }, 200)
    return () => { clearTimeout(timer); request.current += 1 }
  }, [kind, query, supabase])

  async function more() {
    if (offset == null || loading) return
    const sequence = request.current
    setLoading(true); setError('')
    const { data, error: nextError } = await supabase.rpc('app_search_activity_references', {
      input_kind: kind, input_query: query.trim(), input_offset: offset, input_limit: 20,
    })
    if (request.current !== sequence) return
    setLoading(false)
    if (nextError) setError('다음 결과를 불러오지 못했습니다.')
    else { setItems((current) => [...current, ...(data?.items ?? [])]); setOffset(data?.next_offset ?? null) }
  }
  function choose(item) {
    setChosen(item); onChange(item.id); setQuery(''); setOpen(false)
  }
  function description(item) {
    return kind === 'task'
      ? `${item.title}${item.recurrence_kind === 'daily' ? ' · 매일' : item.due_date ? ` · ${item.due_date}` : ''}${item.control_state === 'cancelled' ? ' · 종료' : ''}`
      : `${item.display_name} · ${item.ticker}`
  }
  const selected = chosen?.id === selectedId ? chosen : selectedSummary
  return <div className="grid gap-2">
    <label className="form-field form-label">{label}
      <input aria-autocomplete="list" aria-expanded={open} className={inputClass} data-escape-results-open={open ? 'true' : undefined} disabled={disabled} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false) }
        if (event.key === 'ArrowDown' && open) { event.preventDefault(); setActive((value) => Math.min(value + 1, Math.max(items.length - 1, 0))) }
        if (event.key === 'ArrowUp' && open) { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)) }
        if (event.key === 'Enter' && open && items[active]) { event.preventDefault(); choose(items[active]) }
      }} onFocus={() => { if (query.trim()) setOpen(true) }} placeholder={kind === 'task' ? '할 일 제목 검색' : '종목명·티커 검색'} role="combobox" value={query} />
    </label>
    {selectedId && <div className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-[var(--surface-2)] px-3 text-sm"><span className="min-w-0 break-words">{selected ? description(selected) : `${label} 연결됨`}{kind === 'task' && selected?.trigger_text ? ` · ${selected.trigger_text}` : ''}</span><button aria-label={`${label} 연결 해제`} className="min-h-11 shrink-0 rounded-xl px-3" disabled={disabled} onClick={() => { setChosen(null); onChange(null) }} type="button">해제</button></div>}
    {open && <div className="max-h-56 overflow-y-auto rounded-xl border border-[var(--line)]" role="listbox">
      {loading && <p className="p-3 text-sm text-[var(--muted-ink)]">검색 중…</p>}
      {error && <p className="p-3 text-sm text-red-200" role="alert">{error}<button className="ml-2 underline" onClick={() => setQuery((value) => `${value} `)} type="button">다시 시도</button></p>}
      {!loading && !error && items.length === 0 && <p className="p-3 text-sm text-[var(--muted-ink)]">결과가 없습니다.</p>}
      {items.map((item, index) => <button aria-selected={active === index} className={`block min-h-11 w-full px-3 py-2 text-left text-sm ${active === index ? 'bg-[var(--surface-3)]' : ''}`} key={item.id} onClick={() => choose(item)} role="option" type="button">{description(item)}</button>)}
      {offset != null && <button className="min-h-11 w-full border-t border-[var(--line)] px-3 text-left text-sm" disabled={loading} onClick={more} type="button">결과 더 보기</button>}
    </div>}
  </div>
}

export default function ActivityReferences({ disabled = false, instrumentId, instrumentSummary, onInstrumentChange, onTaskChange, supabase, taskId, taskSummary }) {
  return <section className="grid gap-4 border-t border-[var(--line)] pt-4">
    <SearchReference disabled={disabled} kind="instrument" label="관련 종목" onChange={onInstrumentChange} selectedId={instrumentId} selectedSummary={instrumentSummary} supabase={supabase} />
    <SearchReference disabled={disabled} kind="task" label="관련 할 일" onChange={onTaskChange} selectedId={taskId} selectedSummary={taskSummary} supabase={supabase} />
    <p className="type-secondary text-[var(--muted-ink)]">연결은 탐색용입니다. 기록 저장만으로 할 일이 완료되거나 잔고가 바뀌지 않습니다.</p>
  </section>
}
