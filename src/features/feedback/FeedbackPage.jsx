import { useEffect, useRef, useState } from 'react'

import { createRequestGate } from '../../lib/requestGate'
import { FilterChips, ViewTabs } from '../../components/PageControls'
import { ConfirmDialog } from '../../components/ModalShell'
import {
  deleteMyProductFeedback,
  fetchMyProductFeedback,
  fetchProductFeedbackAdmin,
  submitProductFeedback,
  updateMyProductFeedback,
  updateProductFeedbackAdmin,
} from './data'

const statusLabels = {
  received: '접수됨',
  reviewing: '검토 중',
  planned: '개선 예정',
  resolved: '처리 완료',
  deferred: '보류',
}

const viewOptions = [{ id: 'mine', label: '내 피드백' }, { id: 'triage', label: '전체 접수' }]
const filterOptions = [
  { id: 'all', label: '전체' },
  ...Object.entries(statusLabels).map(([id, label]) => ({ id, label })),
]

function formatMoment(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function FeedbackCard({ item, onDeleted, onSaved, supabase }) {
  const [draft, setDraft] = useState(item.body)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setPending(true); setError('')
    try {
      const updated = await updateMyProductFeedback(supabase, { id: item.id, expectedVersion: item.version, body: draft.trim() })
      onSaved(updated); setEditing(false)
    } catch (cause) { setError(cause.message ?? '피드백을 수정하지 못했습니다. 최신 내용을 다시 확인해 주세요.') }
    finally { setPending(false) }
  }

  async function remove() {
    setPending(true); setError('')
    try {
      await deleteMyProductFeedback(supabase, { id: item.id, expectedVersion: item.version })
      onDeleted(item.id); setConfirmDelete(false)
    } catch (cause) { setError(cause.message ?? '피드백을 삭제하지 못했습니다. 최신 내용을 다시 확인해 주세요.') }
    finally { setPending(false) }
  }

  return (
    <article className="rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
      {confirmDelete && <ConfirmDialog title="피드백 삭제" description={`이 피드백을 삭제할까요?${item.github_issue_url ? ' 연결된 GitHub 이슈는 닫히거나 삭제되지 않습니다.' : ''}`} confirmLabel="피드백 삭제" danger error={error} pending={pending} onCancel={() => { setConfirmDelete(false); setError('') }} onConfirm={remove} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="type-meta rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1">
          {statusLabels[item.status] ?? item.status}
        </span>
        <time className="text-xs text-[var(--muted-ink)]">{formatMoment(item.created_at)}</time>
      </div>
      {editing ? <label className="mt-4 grid gap-2"><span className="type-label">피드백 내용</span><textarea className="type-input min-h-28 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3" maxLength={4000} onChange={(event) => setDraft(event.target.value)} value={draft} /></label>
        : <p className="type-body type-long-body mt-4 whitespace-pre-wrap break-words">{item.body}</p>}
      {item.response && (
        <div className="mt-4 rounded-2xl bg-[var(--surface-2)] p-4">
          <p className="type-label text-[var(--muted-ink)]">처리 답변</p>
          <p className="type-body type-long-body mt-2 whitespace-pre-wrap break-words">{item.response}</p>
        </div>
      )}
      {item.github_issue_url && (
        <a className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent)] underline" href={item.github_issue_url} rel="noreferrer" target="_blank">
          연결된 개발 이슈 보기
        </a>
      )}
      {error && !confirmDelete && <p className="type-secondary mt-3 text-red-300" role="alert">{error}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {editing ? <><button className="min-h-11 rounded-xl border border-[var(--line)] px-4" disabled={pending} onClick={() => { setDraft(item.body); setEditing(false); setError('') }} type="button">취소</button><button className="min-h-11 rounded-xl bg-[var(--accent)] px-4 font-semibold text-white disabled:opacity-50" disabled={pending || !draft.trim() || draft.trim() === item.body} onClick={save} type="button">저장</button></>
          : <><button className="min-h-11 rounded-xl border border-[var(--line)] px-4" onClick={() => { setDraft(item.body); setEditing(true); setError('') }} type="button">수정</button><button className="min-h-11 rounded-xl border border-red-400/40 px-4 text-red-200" onClick={() => { setError(''); setConfirmDelete(true) }} type="button">삭제</button></>}
      </div>
    </article>
  )
}

function AdminFeedbackCard({ item, onSaved, supabase }) {
  const [status, setStatus] = useState(item.status)
  const [response, setResponse] = useState(item.response ?? '')
  const [githubIssueUrl, setGithubIssueUrl] = useState(item.github_issue_url ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setStatus(item.status)
    setResponse(item.response ?? '')
    setGithubIssueUrl(item.github_issue_url ?? '')
    setError('')
  }, [item])

  async function save() {
    setSaving(true)
    setError('')
    try {
      const updated = await updateProductFeedbackAdmin(supabase, {
        id: item.id,
        expectedVersion: item.version,
        status,
        response: response.trim(),
        githubIssueUrl: githubIssueUrl.trim(),
      })
      onSaved(updated)
    } catch (saveError) {
      setError(saveError.message ?? '처리 결과를 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="rounded-[24px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-ink)]">
        <span>{item.source === 'mcp' ? 'ChatGPT' : '앱'} · {item.context?.page_key || '화면 정보 없음'}</span>
        <time>{formatMoment(item.created_at)}</time>
      </div>
      <p className="type-body type-long-body mt-4 whitespace-pre-wrap break-words">{item.body}</p>
      <div className="mt-5 grid gap-4">
        <label className="grid gap-2 text-sm font-semibold">
          상태
          <select className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 font-normal" onChange={(event) => setStatus(event.target.value)} value={status}>
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          사용자에게 보일 답변
          <textarea className="min-h-24 resize-y rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 font-normal leading-6" maxLength={4000} onChange={(event) => setResponse(event.target.value)} value={response} />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          GitHub 이슈 주소 (선택)
          <input className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 font-normal" onChange={(event) => setGithubIssueUrl(event.target.value)} placeholder="https://github.com/owner/repo/issues/123" type="url" value={githubIssueUrl} />
        </label>
        {error && <p className="rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button className="min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={saving} onClick={save} type="button">
          {saving ? '저장 중…' : '처리 결과 저장'}
        </button>
      </div>
    </article>
  )
}

export default function FeedbackPage({ context = {}, supabase }) {
  const [body, setBody] = useState('')
  const [items, setItems] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [view, setView] = useState('mine')
  const [adminFilter, setAdminFilter] = useState('all')
  const listGate = useRef(createRequestGate())

  async function load({ append = false, cursor = null } = {}) {
    const request = listGate.current.begin()
    append ? setLoadingMore(true) : setLoading(true)
    setError('')
    try {
      const page = view === 'triage'
        ? await fetchProductFeedbackAdmin(supabase, { cursor, status: adminFilter === 'all' ? null : adminFilter })
        : await fetchMyProductFeedback(supabase, { cursor })
      if (!request.isCurrent()) return
      setItems((current) => append ? [...current, ...page.items] : page.items)
      setNextCursor(page.nextCursor)
      if (view === 'mine') setIsAdmin(page.isAdmin)
    } catch (loadError) {
      if (request.isCurrent()) setError(loadError.message ?? '피드백을 불러오지 못했습니다.')
    } finally {
      if (request.isCurrent()) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }

  useEffect(() => {
    load()
    return () => listGate.current.invalidate()
  }, [view, adminFilter])

  async function handleSubmit(event) {
    event.preventDefault()
    const normalizedBody = body.trim()
    if (!normalizedBody) {
      setError('피드백 내용을 입력해 주세요.')
      return
    }

    const signature = JSON.stringify({ body: normalizedBody, context })
    const nextAttempt = attempt?.signature === signature
      ? attempt
      : { signature, idempotencyKey: crypto.randomUUID() }
    setAttempt(nextAttempt)
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await submitProductFeedback(supabase, {
        body: normalizedBody,
        context,
        idempotencyKey: nextAttempt.idempotencyKey,
      })
      setBody('')
      setAttempt(null)
      setMessage('피드백을 접수했습니다.')
      await load()
    } catch (saveError) {
      setError(saveError.message ?? '피드백을 접수하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="grid gap-5">
      <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)] sm:p-6">
        <p className="type-meta text-[var(--accent)]">Product feedback</p>
        <h2 className="type-page-title mt-3">사용하면서 불편했던 점을 남겨주세요</h2>
        <p className="type-body type-long-body mt-3 max-w-3xl text-[var(--muted-ink)]">
          투자 판단이나 점검할 일이 아니라, Portfolio 앱 자체의 문제·개선 아이디어를 기록하는 곳입니다. 생각나는 그대로 적어도 됩니다.
        </p>
        <form className="mt-5 grid gap-3" onSubmit={handleSubmit}>
          <label className="type-label" htmlFor="product-feedback-body">피드백</label>
          <textarea
            className="type-input min-h-32 w-full resize-y rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 outline-none focus:border-[var(--accent)]"
            id="product-feedback-body"
            maxLength={4000}
            onChange={(event) => {
              setBody(event.target.value)
              setError('')
              setMessage('')
            }}
            placeholder="예: 모바일에서 자산 필터가 너무 길어서 종목을 찾기 어려워요."
            value={body}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="type-meta type-number text-[var(--muted-ink)]">{body.length.toLocaleString()} / 4,000</span>
            <button className="min-h-11 rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-white disabled:opacity-60" disabled={saving} type="submit">
              {saving ? '접수 중…' : '피드백 등록'}
            </button>
          </div>
          {error && <p className="type-secondary rounded-2xl border border-red-300 bg-red-50 p-3 text-red-700">{error}</p>}
          {message && <p className="type-secondary rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-emerald-800">{message}</p>}
        </form>
      </article>

      <section className="grid gap-3">
        <div className="grid gap-3">
          {isAdmin && <ViewTabs ariaLabel="피드백 보기" idBase="feedback-view" onChange={setView} options={viewOptions} value={view} />}
          <div>
            <h2 className="type-section-title">{view === 'triage' ? '전체 접수' : '내가 남긴 피드백'}</h2>
            <p className="type-secondary mt-1 text-[var(--muted-ink)]">{view === 'triage' ? '접수 상태, 공개 답변과 연결된 개발 이슈를 관리합니다.' : '접수 상태와 운영자의 답변을 여기서 확인할 수 있습니다.'}</p>
          </div>
          {view === 'triage' && <FilterChips ariaLabel="피드백 상태" onChange={setAdminFilter} options={filterOptions} value={adminFilter} />}
        </div>
        {loading ? (
          <p className="rounded-2xl border border-[var(--line)] p-5 text-sm text-[var(--muted-ink)]">피드백을 불러오는 중입니다.</p>
        ) : items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted-ink)]">아직 남긴 피드백이 없습니다.</p>
        ) : (
          <div className="grid gap-3">{items.map((item) => view === 'triage'
            ? <AdminFeedbackCard item={item} key={item.id} onSaved={(updated) => setItems((current) => current.map((entry) => entry.id === updated.id ? updated : entry))} supabase={supabase} />
            : <FeedbackCard item={item} key={item.id} onDeleted={(id) => setItems((current) => current.filter((entry) => entry.id !== id))} onSaved={(updated) => setItems((current) => current.map((entry) => entry.id === updated.id ? updated : entry))} supabase={supabase} />)}</div>
        )}
        {nextCursor && (
          <button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold disabled:opacity-60" disabled={loadingMore} onClick={() => load({ append: true, cursor: nextCursor })} type="button">
            {loadingMore ? '불러오는 중…' : '더 보기'}
          </button>
        )}
      </section>
    </section>
  )
}
