import { useEffect, useState } from 'react'

export function useSupabaseSession({ isConfigured, supabase }) {
  const [session, setSession] = useState(null)
  const [authStatus, setAuthStatus] = useState('loading')

  useEffect(() => {
    if (!isConfigured) {
      setAuthStatus('missing-config')
      return
    }

    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setAuthStatus(data.session ? 'signed-in' : 'signed-out')
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession)
      setAuthStatus(nextSession ? 'signed-in' : 'signed-out')
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [isConfigured, supabase])

  return {
    authStatus,
    session,
    setAuthStatus,
    setSession,
  }
}
