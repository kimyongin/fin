import { useCallback, useEffect, useState } from 'react'
import { sha256Hex } from '../../lib/viewerAccess'
import {
  createAgentToken,
  fetchAgentTokens,
  fetchRecentAgentActions,
  revokeAgentToken,
} from './data'

function generateAgentToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const encoded = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `fin_agent_${encoded}`
}

export function useAgentControls({
  activeTab,
  isAnonymousSession,
  isSchemaMissingError,
  ownerUserId,
  session,
  supabase,
}) {
  const [actions, setActions] = useState([])
  const [actionsLoading, setActionsLoading] = useState(false)
  const [actionsError, setActionsError] = useState('')
  const [tokens, setTokens] = useState([])
  const [tokensLoading, setTokensLoading] = useState(false)
  const [tokenSaving, setTokenSaving] = useState(false)
  const [tokenError, setTokenError] = useState('')
  const [issuedToken, setIssuedToken] = useState('')

  const loadActions = useCallback(async () => {
    if (!session || (isAnonymousSession && !ownerUserId)) {
      setActions([])
      setActionsError('')
      return
    }

    setActionsLoading(true)
    setActionsError('')
    try {
      setActions(await fetchRecentAgentActions(supabase, 30, ownerUserId))
    } catch (error) {
      if (isSchemaMissingError(error)) {
        setActions([])
        return
      }
      setActionsError(error.message ?? 'Agent activity could not be loaded.')
    } finally {
      setActionsLoading(false)
    }
  }, [isAnonymousSession, isSchemaMissingError, ownerUserId, session, supabase])

  const loadTokens = useCallback(async () => {
    if (!session || isAnonymousSession) {
      setTokens([])
      setTokenError('')
      return
    }

    setTokensLoading(true)
    setTokenError('')
    try {
      setTokens(await fetchAgentTokens(supabase))
    } catch (error) {
      setTokenError(error.message ?? 'Agent tokens could not be loaded.')
    } finally {
      setTokensLoading(false)
    }
  }, [isAnonymousSession, session, supabase])

  useEffect(() => {
    if (activeTab === 'activity') loadActions()
    if (activeTab === 'settings') loadTokens()
  }, [activeTab, loadActions, loadTokens])

  const createToken = useCallback(async () => {
    if (!session || isAnonymousSession) return

    setTokenSaving(true)
    setTokenError('')
    setIssuedToken('')

    try {
      const token = generateAgentToken()
      await createAgentToken(supabase, {
        name: 'Codex agent',
        tokenHash: await sha256Hex(token),
        tokenPrefix: `${token.slice(0, 18)}...`,
      })
      setIssuedToken(token)
      await loadTokens()
    } catch (error) {
      setTokenError(error.message ?? 'Agent token could not be issued.')
    } finally {
      setTokenSaving(false)
    }
  }, [isAnonymousSession, loadTokens, session, supabase])

  const revokeToken = useCallback(async (tokenId) => {
    setTokenSaving(true)
    setTokenError('')

    try {
      await revokeAgentToken(supabase, tokenId)
      await loadTokens()
    } catch (error) {
      setTokenError(error.message ?? 'Agent token could not be revoked.')
    } finally {
      setTokenSaving(false)
    }
  }, [loadTokens, supabase])

  return {
    actions,
    actionsError,
    actionsLoading,
    createToken,
    dismissIssuedToken: () => setIssuedToken(''),
    issuedToken,
    loadActions,
    revokeToken,
    tokenError,
    tokenSaving,
    tokens,
    tokensLoading,
  }
}
