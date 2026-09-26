import { useState } from 'react'
import { ConfirmDialog } from './ModalShell'

export default function ModalActions({
  canDelete,
  deleteConfirmMessage = '삭제하면 되돌릴 수 없습니다. 계속할까요?',
  deleteError,
  deleteLabel,
  disabled,
  dirty = false,
  onClose,
  onDelete,
  onSave,
  saveDisabled = false,
  saveLabel,
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <>
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-between">
      <div className="sm:flex-1">
        {canDelete && (
          <button
            className="type-action min-h-11 w-full rounded-2xl border border-red-200 px-4 text-red-400 transition hover:bg-red-950/20 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            disabled={disabled}
            onClick={() => setConfirmingDelete(true)}
            type="button"
          >
            {deleteLabel}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:grid-cols-none">
        <button
          className="type-action min-h-11 rounded-2xl border border-[var(--line)] px-4 text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onClick={onClose}
          type="button"
        >
          닫기
        </button>
        <button
          className="type-action min-h-11 rounded-2xl bg-[var(--accent)] px-4 text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || saveDisabled}
          onClick={onSave}
          type="button"
        >
          {saveLabel}
        </button>
      </div>
    </div>
    {confirmingDelete && <ConfirmDialog title="삭제 확인" description={`${dirty ? '저장하지 않은 변경은 버려집니다. ' : ''}${deleteConfirmMessage}`} error={deleteError} confirmLabel={deleteLabel} danger pending={disabled} onCancel={() => setConfirmingDelete(false)} onConfirm={onDelete} />}
    </>
  )
}
