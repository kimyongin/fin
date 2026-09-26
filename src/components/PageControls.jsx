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

// Shared presentation only; each page owns its filters and calculations.
export const pagePanelClass = 'rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-soft)] sm:p-6'
export const pagePanelFilterClass = 'grid gap-3 border-t border-[var(--line)] pt-4'
export const pagePanelActionClass = 'type-action min-h-11 rounded-xl px-3 text-left hover:bg-[var(--surface-2)] disabled:opacity-50'

function PageActionMenu({ title, children }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    function onKeyDown(event) {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return <div className="page-panel__actions" ref={rootRef}>
    <button aria-expanded={open} aria-label={`${title} 작업 메뉴`} className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-xl hover:bg-[var(--surface-2)]" onClick={() => setOpen((value) => !value)} ref={triggerRef} type="button"><span className="h-0.5 w-4 rounded-full bg-current" /><span className="h-0.5 w-4 rounded-full bg-current" /><span className="h-0.5 w-4 rounded-full bg-current" /></button>
    <div aria-label={`${title} 작업`} className="page-panel__menu grid min-w-40 gap-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] p-2 shadow-2xl" hidden={!open} onClickCapture={(event) => {
      if (!rootRef.current?.contains(event.target) || !event.target.closest('button')) return
      setOpen(false)
      triggerRef.current?.focus()
    }} role="group">{children}</div>
  </div>
}

export function PagePanel({ title, actions, supporting, metric, status, children, className = '', ariaLabel }) {
  return <section aria-label={ariaLabel} className={`${pagePanelClass} page-panel ${className}`}>
    <div className="page-panel__header">
      <div className="page-panel__heading"><h2 className="type-section-title">{title}</h2>{status && <span className="type-secondary text-[var(--muted-ink)]">{status}</span>}</div>
      {actions && <PageActionMenu title={title}>{actions}</PageActionMenu>}
    </div>
    {supporting && <div className="page-panel__supporting type-secondary text-[var(--muted-ink)]">{supporting}</div>}
    {metric && <div className="page-panel__metric">{metric}</div>}
    {children && <div className="page-panel__body">{children}</div>}
  </section>
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
            className={`type-action min-h-11 min-w-0 whitespace-nowrap rounded-xl px-3 transition ${selected ? 'bg-[var(--accent)] text-white shadow-[0_6px_16px_rgba(219,106,33,0.35)]' : 'text-[var(--muted-ink)] hover:text-[var(--ink)]'}`}
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
            className={`type-action min-h-11 rounded-full px-4 transition ${selected ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'border border-[var(--line)] text-[var(--muted-ink)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'}`}
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
    <div className="grid gap-3 sm:flex sm:items-center sm:justify-between">
      <div className="min-w-0">{children}</div>
      {secondary && <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{secondary}</div>}
    </div>
  )
}
import { useEffect, useRef, useState } from 'react'
