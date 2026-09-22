import { useState } from 'react'
import ModalShell from '../../components/ModalShell'

export default function HoldingReasonModal({ accounts, instrument, notes, onClose, onSave, saving }) {
  const [scope, setScope] = useState('all')
  const selectedAccountId = scope === 'all' ? null : Number(scope)
  const selected = notes.find((item) => Number(item.instrument_id) === Number(instrument.id)
    && (item.account_id == null ? selectedAccountId == null : Number(item.account_id) === selectedAccountId))
  const [drafts, setDrafts] = useState({})
  const text = drafts[scope] ?? selected?.note ?? ''

  return <ModalShell onClose={onClose} title={`${instrument.display_name} 보유 메모`}>
    <div className="grid gap-4">
      <p className="text-sm leading-6 text-[var(--muted-ink)]">보유 이유를 종목 공통 또는 계좌별 메모로 적습니다. 기존 공개 메모와 구분되어 친구에게 자동 공유되지 않습니다.</p>
      <label className="grid gap-1.5 text-sm">적용 범위
        <select className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3" value={scope} onChange={(event) => setScope(event.target.value)}>
          <option value="all">모든 계좌</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}만</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm">보유 이유·다음 확인 조건
        <textarea className="min-h-40 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] p-3" maxLength={25000} value={text} onChange={(event) => setDrafts({ ...drafts, [scope]: event.target.value })} />
      </label>
      <div className="flex justify-end gap-2">
        <button className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm" disabled={saving} onClick={onClose} type="button">취소</button>
        <button className="min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-white" disabled={saving} onClick={() => onSave({ accountId: selectedAccountId, expectedNote: selected?.note ?? null, note: text })} type="button">{saving ? '저장 중…' : '메모 저장'}</button>
      </div>
    </div>
  </ModalShell>
}
