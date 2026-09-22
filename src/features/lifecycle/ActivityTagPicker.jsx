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
    <legend className="text-xs text-[var(--muted-ink)]">활동 태그</legend>
    {tags.length > 0 && <div className="flex flex-wrap gap-2">{tags.map((tag) => <label className={`flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm ${selectedIds.includes(tag.id) ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--line)]'}`} key={tag.id}><input checked={selectedIds.includes(tag.id)} onChange={() => toggle(tag.id)} type="checkbox" />{tag.name}</label>)}</div>}
    <div className="flex gap-2"><input className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm" maxLength={50} onChange={(event) => setNewName(event.target.value)} placeholder="새 태그" value={newName} /><button className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-50" disabled={!newName.trim()} onClick={createTag} type="button">추가</button></div>
    {tags.length > 0 && <details><summary className="cursor-pointer py-2 text-xs text-[var(--muted-ink)]">태그 이름·삭제 관리</summary><div className="grid gap-2">{tags.map((tag) => <div className="flex gap-2" key={tag.id}><input className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm" onChange={(event) => setEditing({ ...editing, [tag.id]: event.target.value })} value={editing[tag.id] ?? tag.name} /><button className="rounded-xl border border-[var(--line)] px-3 text-xs" onClick={() => renameTag(tag)} type="button">변경</button><button className="rounded-xl border border-red-400/40 px-3 text-xs text-red-100" onClick={() => removeTag(tag)} type="button">삭제</button></div>)}</div></details>}
    {error && <p className="text-xs text-red-200">{error}</p>}
  </fieldset>
}
