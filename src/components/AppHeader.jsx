import { useEffect, useRef, useState } from 'react'

import { CopyIcon } from './icons'

function AppHeader({
  activeTab,
  pageTitle,
  portfolioLabel = 'Portfolio',
  copyLabel,
  copied,
  onCopy,
  sharedPortfolioViewLabel,
  sharedViewLabel,
  signOutLabel,
  tabs,
  viewContext,
  onSignOut,
  onTabChange,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return

    function handleClick(event) {
      if (!menuRef.current?.contains(event.target)) {
        setMenuOpen(false)
      }
    }

    function handleKeydown(event) {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeydown)
    }
  }, [menuOpen])

  return (
    <header className="relative mb-6" ref={menuRef}>
      <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{pageTitle}</h1>
          {viewContext.mode === 'shared' && (
            <p className="min-w-0 text-sm text-[var(--muted-ink)]">
              {(viewContext.ownerPublicName || sharedViewLabel) + ' ' + sharedPortfolioViewLabel}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onCopy && (
            <button
              aria-label={copyLabel}
              className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border transition ${
                copied
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                  : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--muted-ink)] hover:text-[var(--ink)]'
              }`}
              onClick={onCopy}
              title={copyLabel}
              type="button"
            >
              <CopyIcon />
            </button>
          )}
          <button
            aria-expanded={menuOpen}
            aria-label="Open menu"
            className="inline-flex h-12 w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink)]"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <span className="h-0.5 w-4 rounded-full bg-current" />
            <span className="h-0.5 w-4 rounded-full bg-current" />
            <span className="h-0.5 w-4 rounded-full bg-current" />
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav className="absolute right-0 top-[calc(100%+10px)] z-10 grid min-w-40 gap-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] p-1.5 shadow-2xl shadow-black/40 backdrop-blur">
          {tabs.map((tab) => (
            <button
              className={`rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                activeTab === tab.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--muted-ink)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'
              }`}
              key={tab.id}
              onClick={() => {
                onTabChange(tab.id)
                setMenuOpen(false)
              }}
              type="button"
            >
              {tab.label}
            </button>
          ))}
          <button
            className="rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            onClick={onSignOut}
            type="button"
          >
            {signOutLabel}
          </button>
        </nav>
      )}
    </header>
  )
}

export default AppHeader
