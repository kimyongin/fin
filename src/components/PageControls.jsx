function moveTabFocus(event, options, onChange) {
  const currentIndex = options.findIndex((option) => option.id === event.currentTarget.dataset.value)
  if (currentIndex < 0) return

  let nextIndex = null
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % options.length
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + options.length) % options.length
  if (event.key === 'Home') nextIndex = 0
  if (event.key === 'End') nextIndex = options.length - 1
  if (nextIndex == null) return

  event.preventDefault()
  const nextOption = options[nextIndex]
  onChange(nextOption.id)
  event.currentTarget.parentElement?.querySelector(`[data-value="${nextOption.id}"]`)?.focus()
}

export function ViewTabs({ ariaLabel, className = '', idBase, onChange, options, panelId, value }) {
  return (
    <div aria-label={ariaLabel} className={`inline-grid w-full rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-1 sm:w-auto ${className}`} role="tablist">
      {options.map((option) => {
        const selected = value === option.id
        return (
          <button
            aria-controls={panelId}
            aria-selected={selected}
            className={`min-h-11 min-w-0 whitespace-nowrap rounded-xl px-3 text-xs font-semibold transition sm:text-sm ${selected ? 'bg-[var(--accent)] text-white shadow-[0_6px_16px_rgba(219,106,33,0.35)]' : 'text-[var(--muted-ink)] hover:text-[var(--ink)]'}`}
            data-value={option.id}
            id={`${idBase}-${option.id}`}
            key={option.id}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => moveTabFocus(event, options, onChange)}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function FilterChips({ ariaLabel, onChange, options, value }) {
  return (
    <div aria-label={ariaLabel} className="flex min-h-11 flex-wrap items-center gap-2" role="group">
      {options.map((option) => {
        const selected = value === option.id
        return (
          <button
            aria-pressed={selected}
            className={`min-h-11 rounded-full px-4 text-sm font-semibold transition ${selected ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'border border-[var(--line)] text-[var(--muted-ink)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'}`}
            key={option.id}
            onClick={() => onChange(option.id)}
            type="button"
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function PageToolbar({ children, secondary }) {
  return (
    <div className="grid gap-3 border-b border-[var(--line)] pb-4 sm:flex sm:items-center sm:justify-between">
      <div className="min-w-0">{children}</div>
      {secondary && <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">{secondary}</div>}
    </div>
  )
}
