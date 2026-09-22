import { useEffect, useMemo, useState } from 'react'
import ModalActions from '../../components/ModalActions'
import MarkdownContent from '../../components/MarkdownContent'
import ModalShell from '../../components/ModalShell'
import { PencilIcon } from '../../components/icons'
import { createEmptyNewsState, deleteNewsFact, deleteNewsFactAnnotation, fetchNewsState, saveNewsFactAnnotation, updateNewsFact } from './data'

const countries = [['KR', '한국'], ['US', '미국'], ['CN', '중국'], ['JP', '일본'], ['EU', '유럽'], ['GB', '영국']]
const recordCountries = countries.filter(([code]) => code === 'KR' || code === 'US')
const countryLabel = new Map(countries)
const formatDate = (value) => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full' }).format(new Date(value))
const formatTime = (value) => new Intl.DateTimeFormat('ko-KR', { timeStyle: 'short' }).format(new Date(value))

function groupByDate(facts) { const groups = []; for (const fact of facts) { const label = formatDate(fact.created_at); const current = groups.at(-1); if (!current || current.label !== label) groups.push({ label, facts: [fact] }); else current.facts.push(fact) } return groups }

function FactFields({ body, countryCode, onBodyChange, onCountryChange }) { return <div className="grid gap-4"><label className="grid gap-2"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">국가</span><select className="w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 outline-none transition focus:border-[var(--accent)]" onChange={(event) => onCountryChange(event.target.value)} value={countryCode}>{recordCountries.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label><label className="grid gap-2"><span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">팩트</span><textarea className="min-h-48 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 text-sm leading-7 outline-none transition focus:border-[var(--accent)]" onChange={(event) => onBodyChange(event.target.value)} placeholder={'확인한 팩트를 자유롭게 기록하세요. 필요하면 아래 축을 붙여 정리합니다.\n\n• 성장\n• 물가·통화정책\n• 금융여건·시장위험\n• 정책·지정학\n• 기업이익·밸류에이션\n• 필요한 축은 직접 추가'} value={body} /></label></div> }

function RecordEditor({ canEdit, error, fact, onClose, onDelete, onSave, saving }) {
  const initialOpinion = fact.annotations[0]?.body ?? ''
  const [body, setBody] = useState(fact.body)
  const [countryCode, setCountryCode] = useState(fact.country_code)
  const [opinion, setOpinion] = useState(initialOpinion)
  const dirty = body !== fact.body || countryCode !== fact.country_code || opinion !== initialOpinion
  const actions = canEdit ? (requestClose) => (
    <ModalActions
      canDelete
      deleteConfirmMessage="이 팩트와 연결된 의견을 모두 삭제합니다. 계속할까요?"
      deleteLabel="기록 삭제"
      disabled={saving}
      onClose={requestClose}
      onDelete={() => onDelete(fact.id)}
      onSave={() => onSave({ id: fact.id, country_code: countryCode, body, opinion, annotationId: fact.annotations[0]?.id ?? null })}
      saveDisabled={!body.trim()}
      saveLabel={saving ? '저장 중' : '저장'}
    />
  ) : null

  return (
    <ModalShell closeDisabled={saving} dirty={canEdit && dirty} footer={actions} onClose={onClose} title="뉴스 기록 편집">
      <div className="grid gap-4">
        <FactFields body={body} countryCode={countryCode} onBodyChange={setBody} onCountryChange={setCountryCode} />
        <label className="grid gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">의견 · 신호</span>
          <textarea className="min-h-24 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 text-sm leading-6 outline-none transition focus:border-[var(--accent)]" onChange={(event) => setOpinion(event.target.value)} placeholder="이 팩트가 시장과 내 태그에 주는 의미, 감지한 신호를 기록합니다." readOnly={!canEdit} value={opinion} />
        </label>
        {error && <div className="rounded-2xl border border-red-400/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-100">{error}</div>}
      </div>
    </ModalShell>
  )
}

function TimelineFact({ canEdit, fact, onEdit }) { return <li className="relative grid gap-3 py-4 pl-5 first:pt-0 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-5 sm:pl-0"><span aria-hidden="true" className="absolute left-0 top-6 h-2.5 w-2.5 rounded-full bg-emerald-400 sm:left-[6.18rem]" /><time className="text-xs text-[var(--muted-ink)] sm:pt-1">{formatTime(fact.created_at)}</time><article className="min-w-0"><div className="flex flex-wrap items-center justify-between gap-3"><span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--muted-ink)]">{countryLabel.get(fact.country_code) ?? fact.country_code}</span>{canEdit && <button aria-label="뉴스 기록 편집" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]" onClick={() => onEdit(fact)} type="button"><PencilIcon /></button>}</div><MarkdownContent className="mt-3 text-sm leading-7 text-[var(--ink)]" content={fact.body} />{fact.annotations[0] && <MarkdownContent className="mt-3 border-l-2 border-[var(--line)] pl-3 text-sm leading-6 text-[var(--muted-ink)]" content={fact.annotations[0].body} />}</article></li> }

export default function NewsPage({ canEdit, ownerUserId = null, supabase }) {
  const [state, setState] = useState(createEmptyNewsState()); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [editingFact, setEditingFact] = useState(null); const [saving, setSaving] = useState(false); const [countryFilter, setCountryFilter] = useState('all')
  async function load() { setLoading(true); setError(''); try { setState(await fetchNewsState(supabase, ownerUserId)) } catch (nextError) { setError(nextError.message ?? '뉴스 기록을 불러오지 못했습니다.') } finally { setLoading(false) } }
  useEffect(() => { load() }, [ownerUserId, supabase]); const groups = useMemo(() => groupByDate(state.facts.filter((fact) => countryFilter === 'all' || fact.country_code === countryFilter)), [countryFilter, state.facts])
  async function run(task, fallback) { setSaving(true); setError(''); try { await task(); await load(); return true } catch (nextError) { setError(nextError.message ?? fallback); return false } finally { setSaving(false) } }
  const saveEdit = async (draft) => { const saved = await run(async () => { await updateNewsFact(supabase, draft); if (draft.opinion.trim()) await saveNewsFactAnnotation(supabase, { fact_id: draft.id, signal: 'observe', body: draft.opinion }); else if (draft.annotationId) await deleteNewsFactAnnotation(supabase, draft.annotationId) }, '기록을 저장하지 못했습니다.'); if (saved) setEditingFact(null) }
  const deleteFact = async (factId) => { if (await run(() => deleteNewsFact(supabase, factId), '기록을 삭제하지 못했습니다.')) setEditingFact(null) }
  return <section className="grid gap-5"><p className="text-sm text-[var(--muted-ink)]">이전 자료 기록입니다. 새 조사는 활동에서 기록하세요. 이 기록은 이관 전까지 여기서 정정할 수 있습니다.</p><div className="flex flex-wrap items-center justify-between gap-3"><select aria-label="뉴스 국가 필터" className="min-h-11 min-w-28 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.03)] px-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]" onChange={(event) => setCountryFilter(event.target.value)} value={countryFilter}><option value="all">전체</option><option value="KR">한국</option><option value="US">미국</option></select></div>{error && !editingFact && <p className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</p>}{loading ? <p className="text-sm text-[var(--muted-ink)]">뉴스 기록을 불러오는 중입니다.</p> : groups.length === 0 ? <p className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] px-4 py-8 text-center text-sm text-[var(--muted-ink)]">{countryFilter === 'all' ? '뉴스 기록이 없습니다.' : `${countryLabel.get(countryFilter)} 뉴스 기록이 없습니다.`}</p> : <article className="rounded-[28px] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-soft)]"><div className="grid gap-7">{groups.map((group) => <section key={group.label}><h2 className="border-b border-[var(--line)] pb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted-ink)]">{group.label}</h2><ol className="relative mt-4 border-l border-[var(--line)] sm:border-l-0">{group.facts.map((fact) => <TimelineFact canEdit={canEdit} fact={fact} key={fact.id} onEdit={setEditingFact} />)}</ol></section>)}</div></article>}{editingFact && <RecordEditor canEdit={canEdit} error={error} fact={state.facts.find((fact) => fact.id === editingFact.id) ?? editingFact} onClose={() => { setEditingFact(null); setError('') }} onDelete={deleteFact} onSave={saveEdit} saving={saving} />}</section>
}
