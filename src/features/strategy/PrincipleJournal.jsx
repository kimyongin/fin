import { useEffect, useRef, useState } from 'react'
import ModalShell, { ConfirmDialog } from '../../components/ModalShell'
import { createRequestGate } from '../../lib/requestGate'
import { businessDate } from '../../lib/businessDate'
import MarkdownContent from '../../components/MarkdownContent'
import { PagePanel, pagePanelActionClass } from '../../components/PageControls'
import { TimelineDayCard, TimelineEntry } from '../../components/Timeline'
import { correctPrincipleRow, deletePrincipleRow, fetchPrincipleChanges, fetchPrinciples, savePrinciple } from './data'

const changeLabel = { added: '추가', updated: '수정', ended: '적용 종료' }
const inputClass = 'form-control'
const labelClass = 'form-field form-label'
const formatDateTime = (value) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })

export default function PrincipleJournal({ canEdit = true, onSharedViewReady, ownerUserId = null, supabase }) {
  const [items, setItems] = useState([])
  const [changes, setChanges] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loadingCurrent, setLoadingCurrent] = useState(true)
  const [loadingChanges, setLoadingChanges] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [currentError, setCurrentError] = useState('')
  const [changesError, setChangesError] = useState('')
  const [selectedChange, setSelectedChange] = useState(null)
  const [correcting, setCorrecting] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
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
      const next = await fetchPrinciples(supabase, { ownerUserId })
      if (request.isCurrent()) {
        setItems(next)
        if (ownerUserId) onSharedViewReady?.(ownerUserId)
      }
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
      const page = await fetchPrincipleChanges(supabase, { cursor, ownerUserId })
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

  async function persist() {
    if (!draft.body.trim()) { setFormError('내용을 입력해 주세요.'); return }
    setBusy(true)
    setFormError('')
    try {
      await savePrinciple(supabase, {
        principleId: draft.principleId,
        expectedRowId: editing?.id ?? null,
        expectedBody: editing?.body ?? null,
        expectedChangeNote: editing?.change_note ?? null,
        ...draft,
        body: draft.body,
      })
      setEditing(undefined)
      await Promise.all([loadCurrent(), loadChanges()])
    } catch (cause) {
      setFormError(cause.message ?? '원칙을 저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function persistCorrection() {
    if (!correcting?.body.trim()) { setFormError('내용을 입력해 주세요.'); return }
    setBusy(true)
    setFormError('')
    try {
      await correctPrincipleRow(supabase, {
        rowId: correcting.row.id,
        expectedBody: correcting.row.body,
        expectedChangeNote: correcting.row.change_note,
        body: correcting.body,
        changeNote: correcting.changeNote,
      })
      setCorrecting(null)
      await Promise.all([loadCurrent(), loadChanges()])
    } catch (cause) {
      setFormError(cause.message ?? '이력 정정에 실패했습니다.')
    } finally { setBusy(false) }
  }

  async function removeChange() {
    if (!selectedChange || !changes[0]) return
    setBusy(true)
    setFormError('')
    try {
      await deletePrincipleRow(supabase, {
        rowId: selectedChange.id,
        expectedBody: selectedChange.body,
        expectedChangeNote: selectedChange.change_note,
        expectedCurrentRowId: changes[0].id,
      })
      setConfirmDelete(false)
      setSelectedChange(null)
      await Promise.all([loadCurrent(), loadChanges()])
    } catch (cause) {
      setFormError(cause.message ?? '이력을 삭제하지 못했습니다.')
    } finally { setBusy(false) }
  }

  const changeDays = []
  for (const change of changes) {
    const day = businessDate(change.effective_at)
    if (changeDays.at(-1)?.date === day) changeDays.at(-1).items.push(change)
    else changeDays.push({ date: day, items: [change] })
  }
  return <section className="grid gap-5">
    <PagePanel ariaLabel="현재 원칙" title="현재 원칙" status={!canEdit ? '공유 · 읽기 전용' : null} actions={canEdit && !loadingCurrent && !currentError && <button className={pagePanelActionClass} onClick={() => open(items[0] ?? null)} type="button">{items.length ? '수정' : '원칙 작성'}</button>} supporting={items.length > 0 && <time dateTime={items[0].effective_at}>적용 {formatDateTime(items[0].effective_at)}</time>}>
      {loadingCurrent && <p className="text-sm text-[var(--muted-ink)]">원칙을 불러오는 중입니다.</p>}
      {currentError && <div className="flex flex-wrap items-center gap-2 text-sm text-red-200" role="alert">{currentError}<button className="min-h-11 rounded-2xl border border-red-400/40 px-3" onClick={loadCurrent} type="button">다시 시도</button></div>}
      {!loadingCurrent && !currentError && items.length === 0 && <div className="grid justify-items-start gap-3">
        <p className="text-sm text-[var(--muted-ink)]">현재 원칙이 없습니다. 하나의 문서에 투자 기준을 자유롭게 적어 주세요.</p>
      </div>}
      {items.map((row) => <article key={row.principle_id}>
        <MarkdownContent className="break-words" content={row.body} />
      </article>)}
    </PagePanel>
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
    {canEdit && editing !== undefined && <ModalShell closeDisabled={busy} dirty={dirty} title={editing ? '원칙 수정' : '원칙 작성'} onClose={() => setEditing(undefined)} footer={(requestClose) => <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="ml-auto grid grid-cols-2 gap-2"><button className="min-h-11 rounded-2xl border border-[var(--line)] px-4 text-sm font-semibold" disabled={busy} onClick={requestClose} type="button">닫기</button><button className="min-h-11 rounded-2xl bg-[var(--accent)] px-4 text-sm font-semibold text-white" disabled={busy} onClick={() => persist()} type="button">{busy ? '저장 중…' : '저장'}</button></div>
    </div>}>
      <fieldset className="grid gap-4 border-0 p-1" disabled={busy}>
        {formError && <p className="rounded-2xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-100" role="alert">{formError}</p>}
        <label className={labelClass}>내용 (마크다운)<textarea className={`${inputClass} min-h-64`} maxLength={10000} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
        <label className={labelClass}>변경 메모 (선택)<input className={inputClass} maxLength={1000} value={draft.changeNote} onChange={(event) => setDraft({ ...draft, changeNote: event.target.value })} /></label>
      </fieldset>
    </ModalShell>}
    {selectedChange && <ModalShell title={formatDateTime(selectedChange.effective_at)} onClose={() => { setSelectedChange(null); setFormError('') }} footer={(requestClose) => <div className="flex flex-wrap justify-end gap-2">
      {canEdit && <button className="type-action min-h-11 rounded-2xl border border-red-400/40 px-4 text-red-200" onClick={() => { setFormError(''); setConfirmDelete(true) }} type="button">이력 삭제</button>}
      {canEdit && <button className="type-action min-h-11 rounded-2xl border border-[var(--line)] px-4" onClick={() => { setCorrecting({ row: selectedChange, body: selectedChange.body, changeNote: selectedChange.change_note ?? '' }); setSelectedChange(null); setFormError('') }} type="button">잘못된 내용 정정</button>}
      <button className="type-action min-h-11 rounded-2xl border border-[var(--line)] px-4" onClick={requestClose} type="button">닫기</button>
    </div>}>
      {selectedChange.change_note && <p className="type-body type-long-body">{selectedChange.change_note}</p>}
      <MarkdownContent className="mt-4 break-words" content={selectedChange.body} />
    </ModalShell>}
    {canEdit && correcting && <ModalShell closeDisabled={busy} dirty={correcting.body !== correcting.row.body || correcting.changeNote !== (correcting.row.change_note ?? '')} title="원칙 이력 정정" onClose={() => setCorrecting(null)} footer={(requestClose) => <div className="flex justify-end gap-2">
      <button className="type-action min-h-11 rounded-2xl border border-[var(--line)] px-4" disabled={busy} onClick={requestClose} type="button">닫기</button>
      <button className="type-action min-h-11 rounded-2xl bg-[var(--accent)] px-4 text-white" disabled={busy} onClick={persistCorrection} type="button">{busy ? '저장 중…' : '정정 저장'}</button>
    </div>}>
      <div className="grid gap-4 p-1">
        <p className="type-secondary text-[var(--muted-ink)]">{formatDateTime(correcting.row.effective_at)}에 저장된 내용만 바로잡습니다. 원칙이 실제로 바뀐 경우에는 현재 원칙의 수정으로 새 이력을 남겨 주세요.</p>
        {formError && <p className="type-secondary rounded-xl border border-red-400/40 p-3 text-red-100" role="alert">{formError}</p>}
        <label className={labelClass}>내용 (마크다운)<textarea className={`${inputClass} min-h-64`} disabled={busy} maxLength={10000} value={correcting.body} onChange={(event) => setCorrecting({ ...correcting, body: event.target.value })} /></label>
        <label className={labelClass}>변경 메모 (선택)<input className={inputClass} disabled={busy} maxLength={1000} value={correcting.changeNote} onChange={(event) => setCorrecting({ ...correcting, changeNote: event.target.value })} /></label>
      </div>
    </ModalShell>}
    {confirmDelete && selectedChange && <ConfirmDialog title="원칙 이력 삭제" description={selectedChange.id === changes[0]?.id
      ? `선택한 ${formatDateTime(selectedChange.effective_at)} 원칙을 삭제하면 ${changes[1]?.ended ? '이전 기록이 적용 종료 상태라 현재 원칙이 비게 됩니다.' : changes.length > 1 || nextCursor ? '이전 원칙이 다시 현재 원칙이 됩니다.' : '현재 원칙이 비게 됩니다.'}`
      : `${formatDateTime(selectedChange.effective_at)}에 저장된 이력만 삭제합니다. 현재 원칙은 유지됩니다.`}
      confirmLabel="이력 삭제" danger pending={busy} error={formError} onCancel={() => { setConfirmDelete(false); setFormError('') }} onConfirm={removeChange} />}
  </section>
}
