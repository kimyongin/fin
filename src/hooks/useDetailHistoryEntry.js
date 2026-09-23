import { useEffect, useRef } from 'react'

const stateKey = 'portfolioDetailSurface'

export function useDetailHistoryEntry(isOpen, onDismiss) {
  const marker = useRef(crypto.randomUUID())
  const openRef = useRef(false)
  const skipGuard = useRef(false)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    function handlePopState(event) {
      if (!openRef.current || event.state?.[stateKey] === marker.current) return
      if (!skipGuard.current && dismissRef.current(false) === false) {
        window.history.pushState({ ...(window.history.state ?? {}), [stateKey]: marker.current }, '', window.location.href)
        return
      }
      if (skipGuard.current) dismissRef.current(true)
      skipGuard.current = false
      openRef.current = false
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      if (window.history.state?.[stateKey] === marker.current) {
        const { [stateKey]: _removed, ...rest } = window.history.state
        window.history.replaceState(rest, '', window.location.href)
      }
    }
  }, [])

  useEffect(() => {
    if (isOpen && !openRef.current) {
      window.history.pushState({ ...(window.history.state ?? {}), [stateKey]: marker.current }, '', window.location.href)
      openRef.current = true
      return
    }
    if (!isOpen && openRef.current) {
      openRef.current = false
      if (window.history.state?.[stateKey] === marker.current) window.history.back()
    }
  }, [isOpen])

  return function requestClose() {
    if (window.history.state?.[stateKey] === marker.current) {
      skipGuard.current = true
      window.history.back()
      return
    }
    openRef.current = false
    dismissRef.current()
  }
}
