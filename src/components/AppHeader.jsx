import { useEffect, useRef, useState } from 'react'

import { CopyIcon } from './icons'

function AppHeader({
  activeTab,
  pageTitle,
  portfolioLabel = 'Portfolio',
  copyLabel,
  copySuccessLabel = '복사했어요',
  copied,
  friends = [],
  onCopy,
  onPortfolioChange,
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
    <header className="relative z-[60] mb-6" ref={menuRef}>
      <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{pageTitle}</h1>
          {onPortfolioChange && (
            <select
              aria-label="포트폴리오 전환"
              className="max-w-48 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]"
              onChange={(event) => onPortfolioChange(event.target.value)}
              value={viewContext.mode === 'owner' ? 'owner' : viewContext.ownerUserId}
            >
              <option value="owner">내 포트폴리오</option>
              {friends.map((friend) => (
                <option key={friend.owner_user_id} value={friend.owner_user_id}>
                  {friend.owner_public_name || '이름 없는 친구'}
                </option>
              ))}
            </select>
          )}
          {viewContext.mode === 'shared' && (
            <p className="min-w-0 text-sm text-[var(--muted-ink)]">
              {(viewContext.ownerPublicName || sharedViewLabel) + ' ' + sharedPortfolioViewLabel}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onCopy && (
            <div className="relative">
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
              <div
                aria-live="polite"
                className={`pointer-events-none absolute right-0 top-[calc(100%+0.5rem)] whitespace-nowrap rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-xs font-medium text-[var(--ink)] shadow-lg transition ${
                  copied ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
                }`}
                role="status"
              >
                {copySuccessLabel}
              </div>
            </div>
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
