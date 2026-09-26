import { useRef } from 'react'
import { editableInstrumentTypeOptions } from '../../constants/portfolio'
import ModalActions from '../../components/ModalActions'
import ModalShell from '../../components/ModalShell'
import { SingleTagPicker } from '../../components/TagChip'
import ReadOnlyField from '../../components/ReadOnlyField'

const inputClass = 'form-control'

function useDraftDirty(draft, fields) {
  const initial = useRef(null)
  if (!initial.current) initial.current = Object.fromEntries(fields.map((field) => [field, String(draft[field] ?? '')]))
  return fields.some((field) => String(draft[field] ?? '') !== initial.current[field])
}

export function AccountEditorModal({
  accountError,
  accountSaving,
  draft,
  onChange,
  onClose,
  onDelete,
  onSave,
}) {
  const dirty = useDraftDirty(draft, ['name', 'broker', 'note'])
  const actions = (requestClose) => (
    <ModalActions
      canDelete={!!draft.id}
      dirty={dirty}
      deleteError={accountError}
      deleteConfirmMessage="계좌를 삭제하면 이 계좌 정보가 사라집니다. 계속할까요?"
      deleteLabel="계좌 삭제"
      disabled={accountSaving}
      onClose={requestClose}
      onDelete={onDelete}
      onSave={onSave}
      saveLabel={accountSaving ? '저장 중' : '저장'}
    />
  )
  return (
    <ModalShell closeDisabled={accountSaving} dirty={dirty} footer={actions} onClose={onClose} title={draft.id ? draft.name || '계좌 수정' : '계좌 추가'}>
      <div className="grid gap-4">
        <label className="form-field">
          <span className="form-label">
            계좌명
          </span>
          <input
            className={inputClass}
            onChange={(event) => onChange('name', event.target.value)}
            value={draft.name}
          />
        </label>

        <label className="form-field">
          <span className="form-label">
            증권사
          </span>
          <input
            className={inputClass}
            onChange={(event) => onChange('broker', event.target.value)}
            value={draft.broker}
          />
        </label>

        <label className="form-field">
          <span className="form-label">
            메모
          </span>
          <textarea
            className={inputClass}
            onChange={(event) => onChange('note', event.target.value)}
            value={draft.note}
          />
        </label>

        {accountError && (
          <div className="rounded-2xl border border-red-400/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-100">
            {accountError}
          </div>
        )}

      </div>
    </ModalShell>
  )
}

export function InstrumentEditorModal({
  draft,
  instrumentError,
  instrumentLookupError,
  instrumentLookupResult,
  instrumentLookupSaving,
  instrumentSaving,
  onChange,
  onClose,
  onDelete,
  onLookup,
  onSave,
  tags,
}) {
  const dirty = useDraftDirty(draft, [
    'ticker',
    'display_name',
    'currency',
    'instrument_type',
    'tag_id',
    'note',
  ])
  const actions = (requestClose) => (
    <ModalActions
      canDelete={!!draft.id}
      dirty={dirty}
      deleteError={instrumentError}
      deleteConfirmMessage="종목과 연결된 태그, 가격 이력이 함께 삭제됩니다. 계속할까요?"
      deleteLabel="종목 삭제"
      disabled={instrumentSaving}
      onClose={requestClose}
      onDelete={onDelete}
      onSave={onSave}
      saveLabel={instrumentSaving ? '저장 중' : draft.id ? '저장' : '등록'}
    />
  )
  return (
    <ModalShell closeDisabled={instrumentSaving} dirty={dirty} footer={actions} onClose={onClose} title={draft.id ? '종목 수정' : '종목 추가'}>
      <div className="grid gap-4">
        {draft.instrument_type === 'market' ? draft.id ? <ReadOnlyField label="티커" value={draft.ticker} /> : <div className="form-field">
          <label className="form-label" htmlFor="instrument-ticker">티커</label>
          <div className="flex gap-2">
            <input
              className={inputClass}
              disabled={instrumentLookupSaving}
              id="instrument-ticker"
              onChange={(event) => onChange('ticker', event.target.value.trim().toUpperCase())}
              value={draft.ticker}
            />
            {!draft.id && <button className="type-action min-h-11 shrink-0 rounded-2xl border border-[var(--line)] px-4" disabled={instrumentLookupSaving || instrumentSaving} onClick={onLookup} type="button">{instrumentLookupSaving ? '조회 중' : '조회'}</button>}
          </div>
        </div> : <p className="type-secondary text-[var(--muted-ink)]">평가형 투자와 현금성 자산의 내부 식별자는 자동으로 생성됩니다.</p>}

        {!draft.id && instrumentLookupResult?.ticker === draft.ticker && <p className="type-secondary text-[var(--muted-ink)]">조회 결과 · {instrumentLookupResult.display_name} · {instrumentLookupResult.currency}</p>}
        {instrumentLookupError && <p role="alert" className="type-secondary text-red-200">{instrumentLookupError}</p>}

        <label className="form-field">
          <span className="form-label">
            종목명
          </span>
          <input
            className={inputClass}
            onChange={(event) => onChange('display_name', event.target.value)}
            value={draft.display_name}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="form-field">
            <span className="form-label">
              통화
            </span>
            <select
              className={inputClass}
              onChange={(event) => onChange('currency', event.target.value)}
              value={draft.currency}
            >
              {['KRW', 'USD', 'JPY'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span className="form-label">
              종류
            </span>
            <select
              className={inputClass}
              onChange={(event) => onChange('instrument_type', event.target.value)}
              value={draft.instrument_type}
            >
              {editableInstrumentTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <SingleTagPicker onChange={(value) => onChange('tag_id', value)} tags={tags} value={draft.tag_id} />

        <label className="form-field">
          <span className="form-label">
            메모
          </span>
          <textarea
            className={inputClass}
            onChange={(event) => onChange('note', event.target.value)}
            value={draft.note}
          />
        </label>

        {instrumentError && (
          <div className="rounded-2xl border border-red-400/40 bg-red-500/10 px-3 py-2.5 text-sm text-red-100">
            {instrumentError}
          </div>
        )}
      </div>
    </ModalShell>
  )
}
