import { useEffect, useState } from 'react'
import ModalShell from '../../components/ModalShell'
import { fetchPrinciples, savePrinciple } from './data'

const kinds = [
  ['investment', '투자 방향'], ['goal', '목표'], ['horizon', '투자 기간'],
  ['liquidity', '유동성'], ['risk', '위험 허용'], ['trading', '매매 방식'],
  ['operation', '운영 규칙'], ['strategy', '전략 메모'],
]
const kindLabel = Object.fromEntries(kinds)

export default function PrincipleJournal({ supabase }) {
  const [items, setItems] = useState([])
  const [onDate, setOnDate] = useState('')
  const [editing, setEditing] = useState(undefined)
  const [draft, setDraft] = useState({ principleId: null, kind: 'investment', body: '', scope: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refreshFailed, setRefreshFailed] = useState(false)

  useEffect(() => {
    let active = true
    setError('')
    fetchPrinciples(supabase, { onDate: onDate || null }).then((next) => {
      if (active) setItems(next)
    }).catch((cause) => { if (active) setError(cause.message ?? '원칙을 불러오지 못했습니다.') })
    return () => { active = false }
  }, [supabase, onDate])

  async function reload() {
    setItems(await fetchPrinciples(supabase, { onDate: onDate || null }))
    setRefreshFailed(false)
    setError('')
  }

  function open(row = null) {
    setError('')
    setDraft({ principleId: row?.principle_id ?? crypto.randomUUID(), kind: row?.kind ?? 'investment', body: row?.body ?? '', scope: row?.scope ?? '' })
    setEditing(row)
  }

  async function persist(end = false) {
    if (!end && !draft.body.trim()) { setError('내용을 입력해 주세요.'); return }
    setBusy(true)
    setError('')
    try {
      await savePrinciple(supabase, {
        principleId: draft.principleId,
        expectedRowId: editing?.id ?? null,
        ...draft,
        end,
      })
      setEditing(undefined)
    } catch (cause) {
      setError(cause.message ?? '원칙을 저장하지 못했습니다.')
      setBusy(false)
      return
    }
    try {
      await reload()
    } catch (cause) {
      setRefreshFailed(true)
      setError(`원칙은 저장됐지만 목록을 불러오지 못했습니다. ${cause.message ?? ''}`.trim())
    } finally {
      setBusy(false)
    }
  }

  return <section className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">나의 원칙</h2>
        <p className="mt-1 text-sm text-[var(--muted-ink)]">저장한 기준을 하나씩 관리합니다. 변경 전 내용은 날짜를 골라 볼 수 있습니다.</p>
      </div>
      {!onDate && <button className="min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white" onClick={() => open()} type="button">원칙 추가</button>}
    </div>
    <label className="mt-4 flex flex-wrap items-center gap-2 text-sm">지난 원칙 보기
      <input className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3" type="date" value={onDate} onChange={(event) => setOnDate(event.target.value)} />
      {onDate && <button className="min-h-11 rounded-xl border border-[var(--line)] px-3" onClick={() => setOnDate('')} type="button">현재로</button>}
    </label>
    {error && <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-red-300" role="alert"><span>{error}</span>{refreshFailed && <button className="min-h-11 rounded-xl border border-red-400/40 px-3" onClick={() => reload().catch((cause) => setError(cause.message ?? '원칙을 다시 불러오지 못했습니다.'))} type="button">목록 다시 불러오기</button>}</div>}
    <div className="mt-4 grid gap-3">
      {items.length === 0 && !error && <p className="text-sm text-[var(--muted-ink)]">해당 날짜에 적용 중인 원칙이 없습니다.</p>}
      {items.map((row) => <article key={row.principle_id} className="rounded-2xl border border-[var(--line)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong className="text-sm">{kindLabel[row.kind] ?? row.kind}{row.scope ? ` · ${row.scope}` : ''}</strong>
          {!onDate && <button className="min-h-11 rounded-xl border border-[var(--line)] px-3 text-sm" onClick={() => open(row)} type="button">수정</button>}
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{row.body}</p>
        <time className="mt-2 block text-xs text-[var(--muted-ink)]" dateTime={row.effective_at}>적용 {new Date(row.effective_at).toLocaleString()}</time>
      </article>)}
    </div>
    {editing !== undefined && <ModalShell title={editing ? '원칙 수정' : '원칙 추가'} onClose={() => !busy && setEditing(undefined)}>
      <div className="grid gap-4 p-1">
        <label className="grid gap-1 text-sm">분류
          <select className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })}>
            {kinds.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">적용 범위 (선택)
          <input className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3" maxLength={200} value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value })} />
        </label>
        <label className="grid gap-1 text-sm">내용
          <textarea className="min-h-36 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] p-3" maxLength={10000} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          {editing && <button className="min-h-11 rounded-xl border border-red-400/50 px-4 text-sm" disabled={busy} onClick={() => persist(true)} type="button">적용 종료</button>}
          <button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm" disabled={busy} onClick={() => setEditing(undefined)} type="button">취소</button>
          <button className="min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white" disabled={busy} onClick={() => persist()} type="button">{busy ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </ModalShell>}
  </section>
}
