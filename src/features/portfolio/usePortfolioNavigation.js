import { useEffect, useMemo, useState } from 'react'
import { allTabs } from '../../constants/portfolio'

const tabIds = new Set(allTabs.map((tab) => tab.id))

function tabFromHash(fallback = 'overview') {
  if (typeof window === 'undefined') return fallback
  const hash = window.location.hash.replace(/^#/, '').trim()
  if (['news', 'today', 'decisions', 'activity'].includes(hash)) return 'tasks'
  if (hash === 'accounts' || hash === 'instruments' || hash === 'sheet' || hash === 'tags') return 'overview'
  return tabIds.has(hash) ? hash : fallback
}

export function usePortfolioNavigation(canEdit, sharedFeatureAccess = null, canSubmitFeedback = canEdit) {
  const [activeTab, setActiveTab] = useState(() => tabFromHash())

  const tabs = useMemo(() => {
    if (canEdit) return allTabs
    const features = sharedFeatureAccess?.relationshipAccess ? sharedFeatureAccess.features : {}
    const allowedByTab = {
      overview: features.assets,
      allocation: features.assets || features.strategy,
      tasks: features.tasks || features.activity,
      strategy: features.strategy,
      feedback: canSubmitFeedback,
      settings: false,
      guide: true,
    }
    return allTabs.filter((tab) => Boolean(allowedByTab[tab.id]))
  }, [canEdit, canSubmitFeedback, sharedFeatureAccess])

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#/, '').trim()
      const nextTab = tabFromHash()
      if (['today', 'news', 'decisions', 'activity'].includes(hash)) window.history.replaceState(null, '', '#tasks')
      if (hash === 'accounts' || hash === 'instruments' || hash === 'tags' || hash === 'sheet' || hash === 'overview') {
        if (hash !== 'overview') window.history.replaceState(null, '', '#overview')
      }
      setActiveTab((current) => (current === nextTab ? current : nextTab))
    }

    window.addEventListener('hashchange', handleHashChange)
    handleHashChange()

    return () => {
      window.removeEventListener('hashchange', handleHashChange)
    }
  }, [canEdit])

  useEffect(() => {
    const nextHash = `#${activeTab}`
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash)
    }
  }, [activeTab])

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(!canEdit && sharedFeatureAccess === null ? 'overview' : (tabs[0]?.id ?? 'guide'))
    }
  }, [activeTab, canEdit, sharedFeatureAccess, tabs])

  return {
    activeTab,
    setActiveTab,
    tabs,
  }
}
