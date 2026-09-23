import { useState } from 'react'

import { deleteActivityTag, saveActivityTag } from './data'

export default function ActivityTagPicker({ disabled = false, onChange, onTagsChanged, selectedIds = [], supabase, tags = [] }) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function toggle(id) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id])
  }

  async function createTag() {
    setBusy(true); setError('')
    try {
      const saved = await saveActivityTag(supabase, { name: newName, idempotencyKey: crypto.randomUUID() })
      setNewName('')
      onTagsChanged([...tags, saved], [...selectedIds, saved.id])
    } catch (nextError) { setError(nextError.message ?? '태그를 만들지 못했습니다.') }
    finally { setBusy(false) }
  }

  async function renameTag(tag) {
    const name = (editing[tag.id] ?? tag.name).trim()
    if (!name || name === tag.name) return
    setBusy(true); setError('')
    try {
      const saved = await saveActivityTag(supabase, { ...tag, name, idempotencyKey: crypto.randomUUID() })
      onTagsChanged(tags.map((item) => item.id === saved.id ? saved : item), selectedIds)
      setEditing((current) => ({ ...current, [tag.id]: saved.name }))
    } catch (nextError) { setError(nextError.message ?? '태그 이름을 바꾸지 못했습니다.') }
    finally { setBusy(false) }
  }

  async function removeTag(tag) {
    setBusy(true); setError('')
    try {
      await deleteActivityTag(supabase, { ...tag, idempotencyKey: crypto.randomUUID() })
      onTagsChanged(tags.filter((item) => item.id !== tag.id), selectedIds.filter((id) => id !== tag.id))
    } catch (nextError) { setError(nextError.message ?? '태그를 삭제하지 못했습니다.') }
    finally { setBusy(false) }
  }

  return <fieldset className="grid gap-2" disabled={disabled || busy}>
    <legend className="text-xs font-semibold text-[var(--muted-ink)]">활동 태그</legend>
    {tags.length > 0 && <div className="flex flex-wrap gap-2">{tags.map((tag) => <label className={`flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm ${selectedIds.includes(tag.id) ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--line)]'}`} key={tag.id}><input checked={selectedIds.includes(tag.id)} onChange={() => toggle(tag.id)} type="checkbox" />{tag.name}</label>)}</div>}
    <div className="flex gap-2"><input aria-label="새 활동 태그 이름" className="min-h-11 min-w-0 flex-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 text-base outline-none focus:border-[var(--accent)]" maxLength={50} onChange={(event) => setNewName(event.target.value)} placeholder="새 태그" value={newName} /><button className="min-h-11 rounded-2xl border border-[var(--line)] px-3 text-sm disabled:opacity-50" disabled={!newName.trim()} onClick={createTag} type="button">추가</button></div>
    {tags.length > 0 && <details><summary className="min-h-11 cursor-pointer py-3 text-xs text-[var(--muted-ink)]">태그 이름·삭제 관리</summary><div className="grid gap-2">{tags.map((tag) => <div className="flex gap-2" key={tag.id}><input aria-label={`${tag.name} 이름 변경`} className="min-h-11 min-w-0 flex-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 text-base outline-none focus:border-[var(--accent)]" onChange={(event) => setEditing({ ...editing, [tag.id]: event.target.value })} value={editing[tag.id] ?? tag.name} /><button className="min-h-11 rounded-2xl border border-[var(--line)] px-3 text-sm" onClick={() => renameTag(tag)} type="button">변경</button><button className="min-h-11 rounded-2xl border border-red-400/40 px-3 text-sm text-red-100" onClick={() => removeTag(tag)} type="button">삭제</button></div>)}</div></details>}
    {error && <p className="text-xs text-red-200">{error}</p>}
  </fieldset>
}
