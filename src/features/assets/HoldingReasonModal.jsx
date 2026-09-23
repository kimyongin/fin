import { useState } from 'react'
import ModalShell from '../../components/ModalShell'
import ModalActions from '../../components/ModalActions'

export default function HoldingReasonModal({ accounts, instrument, notes, onClose, onSave, saving }) {
  const [scope, setScope] = useState('all')
  const selectedAccountId = scope === 'all' ? null : Number(scope)
  const selected = notes.find((item) => Number(item.instrument_id) === Number(instrument.id)
    && (item.account_id == null ? selectedAccountId == null : Number(item.account_id) === selectedAccountId))
  const [drafts, setDrafts] = useState({})
  const text = drafts[scope] ?? selected?.note ?? ''
  const dirty = Object.entries(drafts).some(([key, value]) => {
    const accountId = key === 'all' ? null : Number(key)
    const original = notes.find((item) => Number(item.instrument_id) === Number(instrument.id)
      && (item.account_id == null ? accountId == null : Number(item.account_id) === accountId))
    return value !== (original?.note ?? '')
  })

  return <ModalShell closeDisabled={saving} dirty={dirty} footer={(requestClose) => <ModalActions disabled={saving} onClose={requestClose} onSave={() => onSave({ accountId: selectedAccountId, expectedNote: selected?.note ?? null, note: text })} saveLabel={saving ? '저장 중…' : '메모 저장'} />} onClose={onClose} title={`${instrument.display_name} 보유 메모`}>
    <div className="grid gap-4">
      <p className="text-sm leading-6 text-[var(--muted-ink)]">보유 이유를 종목 공통 또는 계좌별 메모로 적습니다. 기존 공개 메모와 구분되어 친구에게 자동 공유되지 않습니다.</p>
      <label className="grid gap-2 text-xs font-semibold text-[var(--muted-ink)]">적용 범위
        <select className="min-h-11 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-3 text-base font-normal text-[var(--ink)] outline-none focus:border-[var(--accent)]" value={scope} onChange={(event) => setScope(event.target.value)}>
          <option value="all">모든 계좌</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}만</option>)}
        </select>
      </label>
      <label className="grid gap-2 text-xs font-semibold text-[var(--muted-ink)]">보유 이유·다음 확인 조건
        <textarea className="min-h-40 w-full min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] p-3 text-base font-normal text-[var(--ink)] outline-none focus:border-[var(--accent)]" maxLength={25000} value={text} onChange={(event) => setDrafts({ ...drafts, [scope]: event.target.value })} />
      </label>
    </div>
  </ModalShell>
}
