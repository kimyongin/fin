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
  async function toggleGrant(featureKey) {
    setSaving(true); setError('')
    const next = !policy.grants[featureKey]
    try {
      const { data, error: nextError } = await supabase.rpc('app_update_sharing_policy', {
        input_expected_version: policy.version,
        input_grants: { [featureKey]: next },
      })
      if (nextError) throw nextError
      setPolicy(data)
    } catch (nextError) { setError(nextError.message ?? '공유 범위를 저장하지 못했습니다.') }
    finally { setSaving(false) }
  }
  if (!policy && !error) return <p className="text-sm text-[var(--muted-ink)]">공유 범위를 불러오는 중입니다.</p>
  return <div className="grid gap-3">
    <label className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
      <div><p className="text-sm font-semibold text-[var(--ink)]">활동 공유</p><p className="mt-1 text-sm leading-6 text-[var(--muted-ink)]">켜면 기존 및 앞으로 작성하는 기록의 제목·날짜·본문·태그를 친구에게 보여줍니다. 예전 공유 허용은 새 범위로 승계되지 않아 직접 다시 켜야 합니다. 보유 이유와 증권사 확인 메모는 포함하지 않습니다.</p></div>
      <button aria-label="활동 공유" aria-pressed={Boolean(policy?.grants?.activity)} className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border transition ${policy?.grants?.activity ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--line)] bg-[var(--surface-3)]'}`} disabled={disabled || saving || !policy} onClick={() => toggleGrant('activity')} type="button"><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${policy?.grants?.activity ? 'left-6' : 'left-1'}`} /></button>
    </label>
    <label className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
      <div><p className="text-sm font-semibold text-[var(--ink)]">할 일 공유</p><p className="mt-1 text-sm leading-6 text-[var(--muted-ink)]">앞으로 할 일의 제목과 일정을 친구에게 보여줍니다. 활동 공유만으로 할 일 상세를 볼 수는 없습니다.</p></div>
      <button aria-label="할 일 공유" aria-pressed={Boolean(policy?.grants?.tasks)} className={`relative inline-flex h-7 w-12 shrink-0 rounded-full border transition ${policy?.grants?.tasks ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--line)] bg-[var(--surface-3)]'}`} disabled={disabled || saving || !policy} onClick={() => toggleGrant('tasks')} type="button"><span aria-hidden="true" className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${policy?.grants?.tasks ? 'left-6' : 'left-1'}`} /></button>
    </label>
    {error && <p className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</p>}
  </div>
}
