import { useEffect, useState } from 'react'

export default function SharingPolicyPanel({ disabled = false, supabase }) {
  const [policy, setPolicy] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    supabase.rpc('app_get_sharing_policy').then(({ data, error: nextError }) => {
      if (!active) return
      if (nextError) setError(nextError.message)
      else setPolicy(data)
    })
    return () => { active = false }
  }, [supabase])
  const reviewsEnabled = Boolean(policy?.grants?.briefings && policy?.grants?.decisions && policy?.grants?.tasks)
  async function toggleReviews() {
    setSaving(true); setError('')
    const next = !reviewsEnabled
    try {
      const { data, error: nextError } = await supabase.rpc('app_update_sharing_policy', {
        input_expected_version: policy.version,
        input_grants: { briefings: next, decisions: next, tasks: next },
      })
      if (nextError) throw nextError
      setPolicy(data)
    } catch (nextError) { setError(nextError.message ?? '공유 범위를 저장하지 못했습니다.') }
    finally { setSaving(false) }
  }
  if (!policy && !error) return <p className="text-sm text-[var(--muted-ink)]">공유 범위를 불러오는 중입니다.</p>
  return <div className="grid gap-3">
    <label className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
      <div><p className="text-sm font-semibold text-[var(--ink)]">투자 점검 기록도 공유</p><p className="mt-1 text-sm leading-6 text-[var(--muted-ink)]">저장된 브리핑·판단·할 일의 읽기 권한을 함께 설정합니다. 개인 투자 기준, 보유 이유와 내부 근거는 포함하지 않습니다.</p></div>
      <button aria-label="투자 점검 기록도 공유" aria-pressed={reviewsEnabled} className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border transition ${reviewsEnabled ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--line)] bg-[var(--surface-3)]'}`} disabled={disabled || saving || !policy} onClick={toggleReviews} type="button"><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${reviewsEnabled ? 'left-6' : 'left-1'}`} /></button>
    </label>
    <p className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-xs leading-5 text-[var(--muted-ink)]">내부적으로는 자산·전략·뉴스·활동·브리핑·판단·할 일·개인 기준·보유 이유·근거를 각각 분리해 저장합니다. 지금 화면은 자주 쓰는 묶음만 간단히 제공합니다.</p>
    {error && <p className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</p>}
  </div>
}
