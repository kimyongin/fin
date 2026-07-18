import { useEffect, useMemo, useState } from 'react'
import { allTabs } from '../../constants/portfolio'

const tabIds = new Set(allTabs.map((tab) => tab.id))

function tabFromHash() {
  if (typeof window === 'undefined') return 'overview'
  const hash = window.location.hash.replace(/^#/, '').trim()
  if (hash === 'accounts' || hash === 'instruments' || hash === 'sheet') return 'overview'
  return tabIds.has(hash) ? hash : 'overview'
}

function assetViewFromHash() {
  if (typeof window === 'undefined') return 'tags'
  const hash = window.location.hash.replace(/^#/, '').trim()
  return hash === 'accounts' || hash === 'instruments' || hash === 'sheet' ? hash : 'tags'
}

export function usePortfolioNavigation(canEdit) {
  const [activeTab, setActiveTab] = useState(() => tabFromHash())
  const [assetView, setAssetView] = useState(() => assetViewFromHash())

  const tabs = useMemo(
    () => allTabs.filter((tab) => canEdit || tab.id !== 'settings'),
    [canEdit],
  )

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#/, '').trim()
      const nextTab = tabFromHash()
      if (hash === 'accounts' || hash === 'instruments' || hash === 'sheet') {
        setAssetView(hash)
      }
      setActiveTab((current) => (current === nextTab ? current : nextTab))
    }

    window.addEventListener('hashchange', handleHashChange)
    handleHashChange()

    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [])

  useEffect(() => {
    const nextHash = `#${activeTab}`
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash)
    }
  }, [activeTab])

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab('overview')
    }
  }, [activeTab, tabs])

  return {
    activeTab,
    assetView,
    setActiveTab,
    setAssetView,
    tabs,
  }
}
