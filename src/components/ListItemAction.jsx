import { DocumentIcon, PencilIcon } from './icons'

export const listItemActionClass = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted-ink)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]'

export default function ListItemAction({ kind, label, onClick, ...props }) {
  return <button {...props} aria-label={label} className={listItemActionClass} onClick={onClick} title={kind === 'edit' ? '편집' : '읽기'} type="button">
    {kind === 'edit' ? <PencilIcon className="h-5 w-5" /> : <DocumentIcon />}
  </button>
}
