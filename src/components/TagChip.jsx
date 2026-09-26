const base = 'inline-flex max-w-full min-w-0 items-center rounded-[10px] border border-[var(--line)] px-3 text-left break-words [overflow-wrap:anywhere]'

export default function TagChip({ children, className = '', disabled = false, label, onClick, selected = false }) {
  if (!onClick) return <span className={`${base} type-meta min-h-7 py-1 text-[var(--muted-ink)] ${className}`}>{children}</span>

  return <button aria-label={label} aria-pressed={selected} className={`${base} type-action min-h-11 justify-center py-2 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50 ${selected ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--ink)]' : 'hover:bg-[var(--surface-2)]'} ${className}`} disabled={disabled} onClick={onClick} type="button">{children}</button>
}

export function SingleTagPicker({ disabled = false, onChange, tags = [], value }) {
  return <fieldset className="min-w-0" disabled={disabled}>
    <legend className="sr-only">대표 태그</legend>
    <span aria-hidden="true" className="form-label block">대표 태그</span>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {tags.map((tag) => <TagChip key={tag.id} onClick={() => onChange(String(tag.id))} selected={String(value) === String(tag.id)}>{tag.name}</TagChip>)}
      {value && <button className="type-action min-h-11 rounded-xl px-2 underline disabled:opacity-50" disabled={disabled} onClick={() => onChange('')} type="button">선택 해제</button>}
    </div>
    {tags.length === 0 && <p className="text-sm text-[var(--muted-ink)]">등록된 태그가 없습니다. 배분에서 태그를 추가해 주세요.</p>}
  </fieldset>
}
