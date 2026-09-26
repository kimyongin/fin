import { useEffect, useRef, useState } from 'react'
import { profileAvatar } from '../lib/profileAvatar'

const primaryIds = ['overview', 'allocation', 'tasks', 'strategy']
const secondaryIds = ['settings', 'guide', 'feedback']

export default function AppHeader({ activeTab, friends = [], onPortfolioChange, onSignOut, onTabChange, ownerAvatarKey, pageTitle, signOutLabel, tabs, viewContext }) {
  const [open, setOpen] = useState(null)
  const navRef = useRef(null)
  const profileRef = useRef(null)
  const menuRef = useRef(null)
  const inPortfolio = primaryIds.includes(activeTab)
  const selectedFriend = inPortfolio && viewContext.mode === 'shared' ? friends.find((friend) => friend.owner_user_id === viewContext.ownerUserId) : null
  const selectedName = viewContext.mode === 'shared' ? (selectedFriend?.owner_public_name || viewContext.ownerPublicName || '이름 없는 친구') : '나'
  const selectedAvatar = profileAvatar(inPortfolio && viewContext.mode === 'shared' ? (selectedFriend?.owner_avatar_key || viewContext.ownerAvatarKey) : ownerAvatarKey)
  const showSelfBadge = viewContext.mode === 'owner'

  useEffect(() => {
    if (!open) return
    function onPointerDown(event) { if (!navRef.current?.contains(event.target)) setOpen(null) }
    function onKeyDown(event) {
      if (event.key !== 'Escape') return
      setOpen(null)
      ;(open === 'profile' ? profileRef : menuRef).current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function selectPortfolio(id) {
    setOpen(null)
    onPortfolioChange?.(id)
    requestAnimationFrame(() => profileRef.current?.focus())
  }

  return <nav aria-label="주요 메뉴" className="fixed bottom-0 left-1/2 z-50 w-full max-w-6xl -translate-x-1/2 border-t border-[var(--line)] bg-[var(--surface-3)] px-2 pt-2 shadow-2xl xl:rounded-t-2xl xl:border-x" ref={navRef} style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
    {open === 'profile' && <div aria-label="포트폴리오 선택" className="absolute bottom-[calc(100%+0.5rem)] left-2 max-h-[min(60vh,24rem)] min-w-48 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] p-2 shadow-2xl" role="group">
      {[{ id: 'owner', name: '나', avatar: ownerAvatarKey }, ...friends.map((friend) => ({ id: friend.owner_user_id, name: friend.owner_public_name || '이름 없는 친구', avatar: friend.owner_avatar_key }))].map((item) => {
        const selected = (viewContext.mode === 'owner' && item.id === 'owner') || viewContext.ownerUserId === item.id
        return <button aria-current={selected ? 'true' : undefined} className="type-action flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-[var(--surface-2)]" key={item.id} onClick={() => selectPortfolio(item.id)} type="button"><span aria-hidden="true" className="text-xl">{profileAvatar(item.avatar).symbol}</span><span className="min-w-0 flex-1 truncate">{item.name}</span>{selected && <span aria-label="선택됨">✓</span>}</button>
      })}
      {friends.length > 0 && <p className="type-secondary border-t border-[var(--line)] px-3 pt-2 text-[var(--muted-ink)]">내 공개 이름과 최근 열람 시각이 상대방에게 표시됩니다.</p>}
    </div>}
    {open === 'menu' && <div aria-label="보조 메뉴" className="absolute bottom-[calc(100%+0.5rem)] right-2 grid min-w-40 gap-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] p-2 shadow-2xl" role="group">
      {secondaryIds.map((id) => tabs.find((tab) => tab.id === id)).filter(Boolean).map((tab) => <button aria-current={activeTab === tab.id ? 'page' : undefined} className="type-action min-h-11 rounded-xl px-3 text-left hover:bg-[var(--surface-2)]" key={tab.id} onClick={() => { setOpen(null); onTabChange(tab.id) }} type="button">{tab.label}</button>)}
      <button className="type-action min-h-11 rounded-xl px-3 text-left hover:bg-[var(--surface-2)]" onClick={onSignOut} type="button">{signOutLabel}</button>
    </div>}
    <div className="grid items-center gap-1" style={{ gridTemplateColumns: '44px repeat(4, minmax(0, 1fr)) 44px' }}>
      <button aria-expanded={open === 'profile'} aria-label={inPortfolio ? `현재 ${selectedName}의 포트폴리오, 전환하기` : '내 프로필'} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--surface-2)] disabled:opacity-70" disabled={!inPortfolio || !onPortfolioChange} onClick={() => setOpen((current) => current === 'profile' ? null : 'profile')} ref={profileRef} type="button"><span aria-hidden="true" className="relative flex h-8 w-8 items-center justify-center rounded-full border border-[var(--muted-ink)]"><span style={{ fontSize: '1.25rem', lineHeight: 1 }}>{selectedAvatar.symbol}</span>{showSelfBadge && <span className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-[var(--surface-3)] bg-[var(--accent)] text-xs leading-none text-[var(--surface-3)]" data-testid="self-profile-badge">나</span>}</span></button>
      {primaryIds.map((id) => {
        const tab = tabs.find((item) => item.id === id)
        return tab ? <button aria-current={activeTab === id ? 'page' : undefined} className={`type-action min-h-11 min-w-0 rounded-xl px-0.5 text-center ${activeTab === id ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted-ink)] hover:bg-[var(--surface-2)]'}`} key={id} onClick={() => { setOpen(null); onTabChange(id) }} type="button">{tab.label}</button> : <span aria-hidden="true" key={id} />
      })}
      <button aria-expanded={open === 'menu'} aria-label="메뉴 열기" className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-xl hover:bg-[var(--surface-2)]" onClick={() => setOpen((current) => current === 'menu' ? null : 'menu')} ref={menuRef} type="button"><span className="h-0.5 w-4 rounded-full bg-current" /><span className="h-0.5 w-4 rounded-full bg-current" /><span className="h-0.5 w-4 rounded-full bg-current" /></button>
    </div>
    <span className="sr-only">현재 화면: {pageTitle}</span>
  </nav>
}
