import { DocumentIcon, PencilIcon } from './icons'

export const listItemActionClass = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-transparent text-[var(--muted-ink)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]'

export default function ListItemAction({ className = '', kind, label, onClick, ...props }) {
  return <button {...props} aria-label={label} className={`${listItemActionClass} ${className}`} onClick={onClick} title={kind === 'edit' ? '편집' : '읽기'} type="button">
    {kind === 'edit' ? <PencilIcon className="h-5 w-5" /> : <DocumentIcon />}
  </button>
}

export function ListItemActions({ className = '', editLabel, onEdit, onRead, readLabel }) {
  return <span className={`inline-flex shrink-0 items-center ${className}`}>
    <ListItemAction className={onEdit ? '[&>svg]:translate-x-1.5' : ''} kind="read" label={readLabel} onClick={onRead} />
    {onEdit && <ListItemAction className="[&>svg]:-translate-x-1.5" kind="edit" label={editLabel} onClick={onEdit} />}
  </span>
}
