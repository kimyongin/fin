import { useEffect, useMemo, useState } from 'react'
import { allTabs } from '../../constants/portfolio'

const tabIds = new Set(allTabs.map((tab) => tab.id))

function tabFromHash(fallback = 'today') {
  if (typeof window === 'undefined') return fallback
  const hash = window.location.hash.replace(/^#/, '').trim()
  if (hash === 'news') return 'tasks'
  if (hash === 'accounts' || hash === 'instruments' || hash === 'sheet' || hash === 'allocation' || hash === 'tags') return 'overview'
  return tabIds.has(hash) ? hash : fallback
}

function assetViewFromHash() {
  if (typeof window === 'undefined') return 'holdings'
  const hash = window.location.hash.replace(/^#/, '').trim()
  return hash === 'allocation' ? hash : 'holdings'
}

export function usePortfolioNavigation(canEdit, sharedFeatureAccess = null, canSubmitFeedback = canEdit) {
  const [activeTab, setActiveTab] = useState(() => tabFromHash(canEdit ? 'today' : 'overview'))
  const [assetView, setAssetView] = useState(() => assetViewFromHash())

  const tabs = useMemo(() => {
    if (canEdit) return allTabs
    const features = sharedFeatureAccess?.relationshipAccess ? sharedFeatureAccess.features : {}
    const allowedByTab = {
      today: features.briefings,
      overview: features.assets,
      decisions: features.decisions,
      tasks: features.tasks,
      strategy: features.strategy,
      activity: features.activity,
      feedback: canSubmitFeedback,
      settings: false,
      guide: true,
    }
    return allTabs.filter((tab) => Boolean(allowedByTab[tab.id]))
  }, [canEdit, canSubmitFeedback, sharedFeatureAccess])

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#/, '').trim()
      const nextTab = tabFromHash(canEdit ? 'today' : 'overview')
      if (hash === 'accounts' || hash === 'instruments' || hash === 'tags' || hash === 'sheet' || hash === 'overview') {
        setAssetView('holdings')
        if (hash !== 'overview') window.history.replaceState(null, '', '#overview')
      }
      if (hash === 'allocation') setAssetView(hash)
      setActiveTab((current) => (current === nextTab ? current : nextTab))
    }

    window.addEventListener('hashchange', handleHashChange)
    handleHashChange()

    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [canEdit])

  useEffect(() => {
    const nextHash = activeTab === 'overview' && assetView !== 'holdings' ? `#${assetView}` : `#${activeTab}`
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash)
    }
  }, [activeTab, assetView])

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(!canEdit && sharedFeatureAccess === null ? 'overview' : (tabs[0]?.id ?? 'guide'))
    }
  }, [activeTab, canEdit, sharedFeatureAccess, tabs])

  return {
    activeTab,
    assetView,
    setActiveTab,
    setAssetView,
    tabs,
  }
}
