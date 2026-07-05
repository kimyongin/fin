import { useState } from 'react'

export default function ModalActions({
  canDelete,
  deleteConfirmMessage = '삭제하면 되돌릴 수 없습니다. 계속할까요?',
  deleteLabel,
  disabled,
  onClose,
  onDelete,
  onSave,
  saveLabel,
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  if (confirmingDelete) {
    return (
      <div className="grid gap-3 rounded-2xl border border-red-300/50 bg-red-950/20 p-4">
        <div className="grid gap-1">
          <div className="text-sm font-semibold text-red-200">삭제 확인</div>
          <p className="text-sm leading-6 text-red-100/80">{deleteConfirmMessage}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button
            className="rounded-2xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={() => setConfirmingDelete(false)}
            type="button"
          >
            취소
          </button>
          <button
            className="rounded-2xl border border-red-300 bg-red-500/15 px-4 py-2.5 text-sm font-semibold text-red-100 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onClick={onDelete}
            type="button"
          >
            {deleteLabel}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap sm:justify-between">
      <div className="sm:flex-1">
        {canDelete && (
          <button
            className="w-full rounded-2xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-400 transition hover:bg-red-950/20 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
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
          className="rounded-2xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onClick={onClose}
          type="button"
        >
          닫기
        </button>
        <button
          className="rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onClick={onSave}
          type="button"
        >
          {saveLabel}
        </button>
      </div>
    </div>
  )
}
