export const listItemActionClass = 'list-item-text-action'

export default function ListItemAction({ className = '', kind, label, onClick, ...props }) {
  return <button {...props} aria-label={label} className={`${listItemActionClass} ${className}`} onClick={onClick} type="button">
    {kind === 'edit' ? '편집' : '보기'}
  </button>
}

export function ListItemActions({ className = '', editLabel, onEdit, onRead, readLabel }) {
  return <span className={`list-item-actions ${className}`}>
    <ListItemAction kind="read" label={readLabel} onClick={onRead} />
    {onEdit && <><span aria-hidden="true" className="list-item-actions__separator">·</span><ListItemAction kind="edit" label={editLabel} onClick={onEdit} /></>}
  </span>
}
