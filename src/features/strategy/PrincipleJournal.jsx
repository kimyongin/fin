import { useEffect, useRef, useState } from 'react'
import ModalShell from '../../components/ModalShell'
import { PageToolbar } from '../../components/PageControls'
import { createRequestGate } from '../../lib/requestGate'
import { businessDate } from '../../lib/businessDate'
import MarkdownContent from '../../components/MarkdownContent'
import { TimelineDayCard, TimelineEntry } from '../../components/Timeline'
import { fetchPrincipleChanges, fetchPrinciples, savePrinciple } from './data'

const changeLabel = { added: '추가', updated: '수정', ended: '적용 종료' }
const inputClass = 'min-h-11 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 text-base font-normal text-[var(--ink)] outline-none focus:border-[var(--accent)]'
const labelClass = 'grid gap-2 text-xs font-semibold text-[var(--muted-ink)]'

export default function PrincipleJournal({ supabase }) {
  const [items, setItems] = useState([])
  const [changes, setChanges] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loadingCurrent, setLoadingCurrent] = useState(true)
  const [loadingChanges, setLoadingChanges] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [currentError, setCurrentError] = useState('')
  const [changesError, setChangesError] = useState('')
  const [selectedChange, setSelectedChange] = useState(null)
  const [collapsedDays, setCollapsedDays] = useState(new Set())
  const [editing, setEditing] = useState(undefined)
  const [draft, setDraft] = useState({ principleId: null, body: '', changeNote: '' })
  const [initialDraft, setInitialDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const currentGate = useRef(createRequestGate())
  const changesGate = useRef(createRequestGate())
  const dirty = initialDraft !== null && (draft.body !== initialDraft.body || draft.changeNote !== initialDraft.changeNote)

  async function loadCurrent() {
    const request = currentGate.current.begin()
    setLoadingCurrent(true)
    setCurrentError('')
    try {
      const next = await fetchPrinciples(supabase)
      if (request.isCurrent()) setItems(next)
    } catch (cause) {
      if (request.isCurrent()) setCurrentError(cause.message ?? '현재 원칙을 불러오지 못했습니다.')
    } finally {
      if (request.isCurrent()) setLoadingCurrent(false)
    }
  }

  async function loadChanges({ append = false, cursor = null } = {}) {
    const request = changesGate.current.begin()
    if (append) setLoadingMore(true)
    else setLoadingChanges(true)
    setChangesError('')
    try {
      const page = await fetchPrincipleChanges(supabase, { cursor })
      if (!request.isCurrent()) return
      setChanges((existing) => append ? [...existing, ...page.items] : page.items)
      setNextCursor(page.nextCursor)
    } catch (cause) {
      if (request.isCurrent()) setChangesError(cause.message ?? '변경 이력을 불러오지 못했습니다.')
    } finally {
      if (request.isCurrent()) {
        setLoadingChanges(false)
        setLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    loadCurrent()
    loadChanges()
    return () => { currentGate.current.invalidate(); changesGate.current.invalidate() }
  }, [supabase])

  function open(row = null) {
    setFormError('')
    const nextDraft = { principleId: row?.principle_id ?? crypto.randomUUID(), body: row?.body ?? '', changeNote: '' }
    setDraft(nextDraft)
    setInitialDraft(nextDraft)
    setEditing(row)
  }

  async function persist(end = false) {
    if (!end && !draft.body.trim()) { setFormError('내용을 입력해 주세요.'); return }
    setBusy(true)
    setFormError('')
    try {
      await savePrinciple(supabase, {
        principleId: draft.principleId,
        expectedRowId: editing?.id ?? null,
        ...draft,
        end,
      })
      setEditing(undefined)
      await Promise.all([loadCurrent(), loadChanges()])
    } catch (cause) {
      setFormError(cause.message ?? '원칙을 저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const changeDays = []
  for (const change of changes) {
    const day = businessDate(change.effective_at)
    if (changeDays.at(-1)?.date === day) changeDays.at(-1).items.push(change)
    else changeDays.push({ date: day, items: [change] })
  }
  return <section className="grid gap-6">
    <PageToolbar secondary={<button className="min-h-11 rounded-2xl bg-[var(--accent)] px-4 text-sm font-semibold text-white" onClick={() => open()} type="button">원칙 추가</button>} />
    <section className="grid gap-3" aria-label="현재 적용 중인 원칙">
      <h2 className="text-lg font-semibold">현재 적용 중인 원칙</h2>
      {loadingCurrent && <p className="text-sm text-[var(--muted-ink)]">원칙을 불러오는 중입니다.</p>}
      {currentError && <div className="flex flex-wrap items-center gap-2 text-sm text-red-200" role="alert">{currentError}<button className="min-h-11 rounded-2xl border border-red-400/40 px-3" onClick={loadCurrent} type="button">다시 시도</button></div>}
      {!loadingCurrent && !currentError && items.length === 0 && <p className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 text-sm text-[var(--muted-ink)]">현재 적용 중인 원칙이 없습니다.</p>}
      {items.map((row) => <article key={row.principle_id} className="rounded-2xl border border-[var(--line)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">원칙</strong><button className="min-h-11 rounded-2xl border border-[var(--line)] px-3 text-sm" onClick={() => open(row)} type="button">수정</button></div>
        <MarkdownContent className="mt-2 break-words text-sm leading-6" content={row.body} />
        <time className="mt-2 block text-xs text-[var(--muted-ink)]" dateTime={row.effective_at}>적용 {new Date(row.effective_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time>
      </article>)}
    </section>
    <section className="grid gap-3" aria-label="원칙 변경 이력">
      <h2 className="text-lg font-semibold">변경 이력</h2>
      {loadingChanges && <p className="text-sm text-[var(--muted-ink)]">변경 이력을 불러오는 중입니다.</p>}
      {changesError && <div className="flex flex-wrap items-center gap-2 text-sm text-red-200" role="alert">{changesError}<button className="min-h-11 rounded-2xl border border-red-400/40 px-3" onClick={() => loadChanges({ append: changes.length > 0 && Boolean(nextCursor), cursor: nextCursor })} type="button">다시 시도</button></div>}
      {!loadingChanges && !changesError && changes.length === 0 && <p className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 text-sm text-[var(--muted-ink)]">아직 변경 이력이 없습니다.</p>}
      <div className="grid gap-3">
        {changeDays.map((day) => <TimelineDayCard collapsed={collapsedDays.has(day.date)} day={day.date} key={day.date} onToggle={() => setCollapsedDays((current) => { const next = new Set(current); next.has(day.date) ? next.delete(day.date) : next.add(day.date); return next })}>
          <ol className="relative border-l border-[var(--line)] sm:border-l-0">{day.items.map((change) => <TimelineEntry ariaLabel={`당시 원칙 보기: ${change.change_note || changeLabel[change.change_type] || '변경'}`} key={change.id} meta={changeLabel[change.change_type] ?? change.change_type} occurredAt={change.effective_at} onOpen={() => setSelectedChange(change)} title={change.change_note || `원칙 ${changeLabel[change.change_type] ?? change.change_type}`} />)}</ol>
        </TimelineDayCard>)}
      </div>
      {nextCursor && <button className="min-h-11 rounded-2xl border border-[var(--line)] px-4 text-sm font-semibold" disabled={loadingMore} onClick={() => loadChanges({ append: true, cursor: nextCursor })} type="button">{loadingMore ? '불러오는 중' : '이전 변경 더 보기'}</button>}
    </section>
    {editing !== undefined && <ModalShell closeDisabled={busy} dirty={dirty} title={editing ? '원칙 수정' : '원칙 추가'} onClose={() => setEditing(undefined)} footer={(requestClose) => <div className="flex flex-wrap items-center justify-between gap-2">
      {editing && <button className="min-h-11 rounded-2xl border border-red-400/50 px-4 text-sm font-semibold text-red-200" disabled={busy} onClick={() => persist(true)} type="button">적용 종료</button>}
      <div className="ml-auto grid grid-cols-2 gap-2"><button className="min-h-11 rounded-2xl border border-[var(--line)] px-4 text-sm font-semibold" disabled={busy} onClick={requestClose} type="button">닫기</button><button className="min-h-11 rounded-2xl bg-[var(--accent)] px-4 text-sm font-semibold text-white" disabled={busy} onClick={() => persist()} type="button">{busy ? '저장 중…' : '저장'}</button></div>
    </div>}>
      <fieldset className="grid gap-4 border-0 p-1" disabled={busy}>
        {formError && <p className="rounded-2xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-100" role="alert">{formError}</p>}
        <label className={labelClass}>내용 (마크다운)<textarea className={`${inputClass} min-h-64 font-mono`} maxLength={10000} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
        <label className={labelClass}>변경 메모 (선택)<input className={inputClass} maxLength={1000} value={draft.changeNote} onChange={(event) => setDraft({ ...draft, changeNote: event.target.value })} /></label>
      </fieldset>
    </ModalShell>}
    {selectedChange && <ModalShell title="당시 원칙" onClose={() => setSelectedChange(null)} footer={(requestClose) => <button className="min-h-11 rounded-2xl border border-[var(--line)] px-4 text-sm" onClick={requestClose} type="button">닫기</button>}>
      <time className="block text-sm text-[var(--muted-ink)]" dateTime={selectedChange.effective_at}>{new Date(selectedChange.effective_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</time>
      {selectedChange.change_note && <p className="mt-2 text-sm">{selectedChange.change_note}</p>}
      <MarkdownContent className="mt-4 break-words text-sm leading-6" content={selectedChange.body} />
    </ModalShell>}
  </section>
}
