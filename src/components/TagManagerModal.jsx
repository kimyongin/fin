import { useRef, useState } from 'react'

import ModalShell, { ConfirmDialog } from './ModalShell'
import TagChip from './TagChip'

const inputClass = 'form-control'

function emptyDraft(tags, showSortOrder) {
  return { name: '', sort_order: showSortOrder ? String(Math.max(-1, ...tags.map((tag) => Number(tag.sort_order) || 0)) + 1) : '' }
}

function draftFor(tag) {
  return { name: tag.name, sort_order: String(tag.sort_order ?? '') }
}

export default function TagManagerModal({ deleteImpact, historyGuardRef, onClose, onDelete, onRefresh, onSave, showSearch = true, showSortOrder = false, tags, title }) {
  const [items, setItems] = useState(tags)
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => emptyDraft(tags, showSortOrder))
  const [query, setQuery] = useState('')
  const [pendingMove, setPendingMove] = useState(undefined)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [success, setSuccess] = useState('')
  const attempt = useRef(null)
  const nameInput = useRef(null)
  const selected = items.find((tag) => String(tag.id) === String(selectedId)) ?? null
  const baseline = selected ? draftFor(selected) : emptyDraft(items, showSortOrder)
  const dirty = draft.name !== baseline.name || (showSortOrder && draft.sort_order !== baseline.sort_order)
  const filtered = showSearch ? items.filter((tag) => tag.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : items

  function move(nextId) {
    if (dirty) { setPendingMove(nextId); return }
    applyMove(nextId)
  }

  function applyMove(nextId) {
    const next = items.find((tag) => String(tag.id) === String(nextId)) ?? null
    setSelectedId(next?.id ?? null)
    setEditing(true)
    setDraft(next ? draftFor(next) : emptyDraft(items, showSortOrder))
    setPendingMove(undefined)
    setError('')
    setSuccess('')
    attempt.current = null
    requestAnimationFrame(() => nameInput.current?.focus())
  }

  async function refresh() {
    setRefreshError('')
    try {
      const latest = await onRefresh()
      setItems(latest)
      return latest
    } catch {
      setRefreshError('변경은 반영됐지만 최신 목록을 불러오지 못했습니다. 목록만 다시 불러와 주세요.')
      return null
    }
  }

  async function save() {
    const name = draft.name.trim()
    if (!name) { setError('태그명을 입력해 주세요.'); return }
    if (showSortOrder && (!/^-?\d+$/.test(draft.sort_order) || Number(draft.sort_order) < 0)) {
      setError('정렬 순서는 0 이상의 정수로 입력해 주세요.'); return
    }
    const fingerprint = JSON.stringify({ selectedId, draft })
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() }
    setBusy(true); setError('')
    try {
      const saved = await onSave({ ...selected, name, sort_order: showSortOrder ? Number(draft.sort_order) : undefined }, attempt.current.key)
      attempt.current = null
      setItems((current) => selected ? current.map((tag) => String(tag.id) === String(saved.id) ? saved : tag) : [...current, saved])
      setSelectedId(saved.id)
      setEditing(true)
      setDraft(draftFor(saved))
      setSuccess(selected ? '저장됨' : '추가됨')
      await refresh()
    } catch (cause) { setError(cause.message ?? '태그를 저장하지 못했습니다.') }
    finally { setBusy(false) }
  }

  async function remove() {
    if (!selected) return
    const fingerprint = JSON.stringify({ id: selected.id, version: selected.version })
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() }
    setBusy(true); setError('')
    try {
      await onDelete(selected, attempt.current.key)
      attempt.current = null
      const remaining = items.filter((tag) => String(tag.id) !== String(selected.id))
      setItems(remaining)
      setSelectedId(null)
      setEditing(false)
      setDraft(emptyDraft(remaining, showSortOrder))
      setSuccess('')
      setConfirmDelete(false)
      await refresh()
    } catch (cause) { setError(cause.message ?? '태그를 삭제하지 못했습니다.') }
    finally { setBusy(false) }
  }

  return <ModalShell closeDisabled={busy} dirty={dirty} footer={(requestClose) => <div className="flex justify-end gap-2"><button className="min-h-11 rounded-2xl border border-[var(--line)] px-4 text-sm" disabled={busy} onClick={requestClose} type="button">닫기</button>{editing && <button className="min-h-11 rounded-2xl bg-[var(--accent)] px-4 text-sm font-semibold text-white" disabled={busy || !draft.name.trim() || (selected && !dirty)} onClick={save} type="button">{busy ? '처리 중…' : selected ? '저장' : '추가'}</button>}</div>} historyGuardRef={historyGuardRef} onClose={onClose} title={title}>
    <div className="grid gap-5">
      {showSearch && <label className="form-field"><span className="form-label">태그 검색</span><input className={inputClass} onChange={(event) => setQuery(event.target.value)} value={query} /></label>}
      <div className="grid gap-2">
        <p className="type-label text-[var(--muted-ink)]">편집할 태그</p>
        <p className="type-secondary text-[var(--muted-ink)]">태그를 누르면 이름을 수정할 수 있습니다.</p>
        <div aria-label="태그 목록" className="flex flex-wrap gap-2" role="group">
          {items.length === 0 && <p className="text-sm text-[var(--muted-ink)]">등록된 태그가 없습니다.</p>}
          {showSearch && items.length > 0 && filtered.length === 0 && <p className="text-sm text-[var(--muted-ink)]">검색 결과가 없습니다.</p>}
          {filtered.map((tag) => <TagChip key={tag.id} label={`${tag.name} 편집`} onClick={() => move(tag.id)} selected={String(selectedId) === String(tag.id)}>{tag.name}</TagChip>)}
        </div>
      </div>
      <button className="min-h-11 justify-self-start rounded-2xl border border-[var(--line)] px-4 text-sm font-semibold" disabled={busy} onClick={() => move(null)} type="button">+ 새 태그</button>
      {editing && <div className="grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
        <h3 className="type-item-title break-words">{selected ? `태그 수정 · ${selected.name}` : '새 태그 추가'}</h3>
        <label className="form-field"><span className="form-label">태그명</span><input className={inputClass} maxLength={50} onChange={(event) => { setSuccess(''); setDraft({ ...draft, name: event.target.value }) }} ref={nameInput} value={draft.name} /></label>
        {showSortOrder && <label className="form-field"><span className="form-label">정렬 순서</span><input className={inputClass} min="0" onChange={(event) => { setSuccess(''); setDraft({ ...draft, sort_order: event.target.value }) }} type="number" value={draft.sort_order} /></label>}
        {selected && <button className="min-h-11 justify-self-start rounded-2xl border border-red-400/40 px-4 text-sm text-red-200" disabled={busy} onClick={() => { setError(''); setConfirmDelete(true) }} type="button">태그 삭제</button>}
        {success && <p className="text-sm text-emerald-300" role="status">{success}</p>}
        {error && !confirmDelete && <p className="text-sm text-red-200" role="alert">{error}</p>}
      </div>}
      {refreshError && <div className="flex flex-wrap items-center gap-2 text-sm text-amber-200" role="alert"><span>{refreshError}</span><button className="min-h-11 rounded-xl border border-[var(--line)] px-3" onClick={refresh} type="button">목록 다시 불러오기</button></div>}
    </div>
    {pendingMove !== undefined && <ConfirmDialog cancelLabel="계속 편집" confirmLabel="변경 버리기" danger description="저장하지 않은 태그 변경을 버리고 이동할까요?" onCancel={() => setPendingMove(undefined)} onConfirm={() => applyMove(pendingMove)} title="변경 버리기" />}
    {confirmDelete && <ConfirmDialog cancelLabel="계속 편집" confirmLabel="태그 삭제" danger description={`${selected?.name} 태그를 삭제합니다. ${deleteImpact}${dirty ? ' 저장하지 않은 입력도 버려집니다.' : ''}`} error={error} onCancel={() => { setConfirmDelete(false); setError('') }} onConfirm={remove} pending={busy} title="태그 삭제" />}
  </ModalShell>
}
