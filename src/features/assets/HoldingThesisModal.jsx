import { useMemo, useState } from 'react'
import ModalShell from '../../components/ModalShell'

const inputClass = 'min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]'

function draftFrom(thesis) {
  return {
    reason_text: thesis?.reason_text ?? '',
    horizon_text: thesis?.horizon_text ?? '',
    review_condition_text: thesis?.review_condition_text ?? '',
    next_review_date: thesis?.next_review_date ?? '',
    change_reason: '',
  }
}

export default function HoldingThesisModal({ accounts, instrument, onClose, onSave, saving, theses }) {
  const [scope, setScope] = useState('instrument')
  const scopedThesis = useMemo(() => {
    const accountId = scope === 'instrument' ? null : Number(scope)
    return theses.find((item) => Number(item.instrument_id) === Number(instrument.id)
      && (item.account_id == null ? accountId == null : Number(item.account_id) === accountId)) ?? null
  }, [instrument.id, scope, theses])
  const [drafts, setDrafts] = useState(() => ({ instrument: draftFrom(
    theses.find((item) => Number(item.instrument_id) === Number(instrument.id) && item.account_id == null),
  ) }))
  const draft = drafts[scope] ?? draftFrom(scopedThesis)
  const setDraft = (next) => setDrafts((current) => ({ ...current, [scope]: next }))
  const baseThesis = theses.find((item) => Number(item.instrument_id) === Number(instrument.id) && item.account_id == null)

  return (
    <ModalShell onClose={onClose} title={`${instrument.display_name} 보유 이유`}>
      <div className="grid gap-4">
        <p className="text-sm leading-6 text-[var(--muted-ink)]">종목 메모와 별개인 현재 판단 기준입니다. ChatGPT는 이 기록을 매일 점검의 기준으로 사용합니다.</p>
        <label className="grid gap-1.5">
          <span className="text-xs text-[var(--muted-ink)]">적용 범위</span>
          <select className={inputClass} onChange={(event) => setScope(event.target.value)} value={scope}>
            <option value="instrument">모든 계좌에 적용</option>
            {accounts.map((account) => <option key={account.id} value={String(account.id)}>{account.name}만 다르게</option>)}
          </select>
        </label>
        {scope !== 'instrument' && !scopedThesis && baseThesis && (
          <p className="rounded-xl bg-[var(--surface-2)] px-3 py-2 text-xs leading-5 text-[var(--muted-ink)]">아직 계좌별 기준이 없어 종목 공통 이유가 적용됩니다. 저장하면 이 계좌만 별도로 관리합니다.</p>
        )}
        <label className="grid gap-1.5">
          <span className="text-xs text-[var(--muted-ink)]">왜 보유하는가</span>
          <textarea className={`${inputClass} min-h-28 resize-y`} onChange={(event) => setDraft({ ...draft, reason_text: event.target.value })} placeholder="검증 가능한 핵심 이유를 적어주세요." value={draft.reason_text} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">예상 보유 기간</span><input className={inputClass} onChange={(event) => setDraft({ ...draft, horizon_text: event.target.value })} placeholder="예: 3년 이상" value={draft.horizon_text} /></label>
          <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">다음 점검일</span><input className={inputClass} onChange={(event) => setDraft({ ...draft, next_review_date: event.target.value })} type="date" value={draft.next_review_date} /></label>
        </div>
        <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">다시 판단할 조건</span><textarea className={`${inputClass} min-h-20 resize-y`} onChange={(event) => setDraft({ ...draft, review_condition_text: event.target.value })} placeholder="예: 매출 성장률이 두 분기 연속 둔화하면 재검토" value={draft.review_condition_text} /></label>
        <label className="grid gap-1.5"><span className="text-xs text-[var(--muted-ink)]">변경 이유</span><input className={inputClass} onChange={(event) => setDraft({ ...draft, change_reason: event.target.value })} placeholder="왜 기록하거나 바꾸는지 짧게 적어주세요." value={draft.change_reason} /></label>
        <div className="flex justify-end gap-2">
          <button className="rounded-xl border border-[var(--line)] px-4 py-2 text-sm" onClick={onClose} type="button">취소</button>
          <button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={saving || !draft.reason_text.trim() || !draft.change_reason.trim()} onClick={() => onSave({
            accountId: scope === 'instrument' ? null : Number(scope),
            expectedVersion: scopedThesis?.version ?? null,
            patch: {
              reason_text: draft.reason_text.trim(),
              horizon_text: draft.horizon_text.trim() || null,
              review_condition_text: draft.review_condition_text.trim() || null,
              next_review_date: draft.next_review_date || null,
            },
            changeReason: draft.change_reason.trim(),
          })} type="button">{saving ? '저장 중' : '보유 이유 저장'}</button>
        </div>
      </div>
    </ModalShell>
  )
}
