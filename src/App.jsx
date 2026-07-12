import { useCallback, useMemo, useState } from 'react'
import AppHeader from './components/AppHeader'
import AssetsPageView from './features/assets/AssetsPage'
import {
  CenteredMessage as CenteredMessageView,
  GuestUnlockScreen as GuestUnlockScreenView,
  LoginScreen as LoginScreenView,
} from './features/auth/AuthScreens'
import { useAgentControls } from './features/agent/useAgentControls'
import { useSupabaseSession } from './features/auth/useSupabaseSession'
import PortfolioEditorModals from './features/modals/PortfolioEditorModals'
import SettingsPageView from './features/settings/SettingsPage'
import { buildPortfolioCsv } from './features/portfolio/helpers'
import { createPortfolioActions } from './features/portfolio/actions'
import {
  createEmptyPortfolioState,
  createOwnerViewContext,
  fetchActiveViewerAccess,
  fetchPortfolioState,
  fetchViewerProfile,
} from './features/portfolio/data'
import { portfolioMessages } from './features/portfolio/messages'
import { usePortfolioBootstrap } from './features/portfolio/usePortfolioBootstrap'
import { usePortfolioNavigation } from './features/portfolio/usePortfolioNavigation'
import { usePortfolioDerivedData } from './features/portfolio/usePortfolioDerivedData'
import { usePortfolioEditorState } from './features/portfolio/usePortfolioEditorState'
import { writeClipboard } from './lib/clipboard'
import { today } from './lib/portfolioMath'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { SUPABASE_URL } from './lib/config'
import {
  createGuestUnlockDraft,
  createViewerProfileDraft,
  isViewerSchemaMissingError,
} from './lib/viewerAccess'

function authRedirectTo() {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

function App() {
  const [loginMode, setLoginMode] = useState('owner')
  const [copied, setCopied] = useState(false)
  const editor = usePortfolioEditorState()
  const [viewerProfileSchemaReady, setViewerProfileSchemaReady] = useState(true)
  const [viewerProfileSaving, setViewerProfileSaving] = useState(false)
  const [viewerProfileError, setViewerProfileError] = useState('')
  const [viewerProfileMessage, setViewerProfileMessage] = useState('')
  const [viewerProfile, setViewerProfile] = useState(() => createViewerProfileDraft())
  const [viewerProfileDraft, setViewerProfileDraft] = useState(() => createViewerProfileDraft())
  const [guestUnlockDraft, setGuestUnlockDraft] = useState(() => createGuestUnlockDraft())
  const [guestUnlockSaving, setGuestUnlockSaving] = useState(false)
  const [guestUnlockError, setGuestUnlockError] = useState('')
  const [viewContext, setViewContext] = useState(() => createOwnerViewContext())
  const [accountTagFilter, setAccountTagFilter] = useState('all')
  const [instrumentTagFilter, setInstrumentTagFilter] = useState('all')
  const [state, setState] = useState(() => createEmptyPortfolioState())
  const [loadError, setLoadError] = useState('')
  const { authStatus, session, setAuthStatus, setSession } = useSupabaseSession({
    isConfigured: isSupabaseConfigured,
    supabase,
  })
  const isAnonymousSession = Boolean(session?.user?.is_anonymous)
  const canEdit = viewContext.mode === 'owner' && !isAnonymousSession
  const { activeTab, assetView, setActiveTab, setAssetView, tabs } = usePortfolioNavigation(canEdit)
  const {
    actions: agentActions,
    actionsError: agentActionsError,
    actionsLoading: agentActionsLoading,
    createToken: handleCreateAgentToken,
    dismissIssuedToken: handleDismissIssuedAgentToken,
    issuedToken: issuedAgentToken,
    loadActions: loadAgentActions,
    revokeToken: handleRevokeAgentToken,
    tokenError: agentTokenError,
    tokenSaving: agentTokenSaving,
    tokens: agentTokens,
    tokensLoading: agentTokensLoading,
  } = useAgentControls({
    activeTab,
    isAnonymousSession,
    isSchemaMissingError: isViewerSchemaMissingError,
    session,
    supabase,
  })

  const refreshState = useCallback(async () => {
    setLoadError('')
    setState(await fetchPortfolioState(supabase))
  }, [])

  const loadActiveViewerAccess = useCallback(async () => {
    try {
      return await fetchActiveViewerAccess(supabase)
    } catch (error) {
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
        return null
      }
      throw error
    }
  }, [])

  const loadViewerProfile = useCallback(async () => {
    setViewerProfileError('')
    setViewerProfileMessage('')

    try {
      const nextProfile = createViewerProfileDraft(await fetchViewerProfile(supabase))
      setViewerProfileSchemaReady(true)
      setViewerProfile(nextProfile)
      setViewerProfileDraft(nextProfile)
    } catch (error) {
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
        setViewerProfile(createViewerProfileDraft())
        setViewerProfileDraft(createViewerProfileDraft())
        return
      }
      throw error
    }
  }, [])

  usePortfolioBootstrap({
    createViewerProfileDraft,
    loadActiveViewerAccess,
    loadViewerProfile,
    refreshState,
    session,
    setGuestUnlockError,
    setLoadError,
    setState,
    setViewContext,
    setViewerProfile,
    setViewerProfileDraft,
  })

  const latestPriceByTicker = useMemo(() => {
    return new Map(state.prices.map((row) => [row.ticker, row]))
  }, [state.prices])

  const {
    accountById,
    chartGradient,
    computedPositions,
    filteredAccountCards,
    filteredInstrumentRows,
    holdingsByAccountId,
    holdingsByTicker,
    tagCards,
    tagMapByTicker,
    totalValue,
  } = usePortfolioDerivedData({
    accountTagFilter,
    instrumentTagFilter,
    latestPriceByTicker,
    state,
  })

  async function handleCopyCsv() {
    await writeClipboard(buildPortfolioCsv(computedPositions, accountById))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: authRedirectTo(),
      },
    })
  }

  const {
    handleDeleteAccount,
    handleDeleteHolding,
    handleDeleteInstrument,
    handleGuestUnlock,
    handleLookupHoldingTicker,
    handleSaveAccount,
    handleSaveHolding,
    handleSaveInstrument,
    handleSaveTag,
    handleSaveViewerProfile,
    handleSyncPrices,
    openAccount: openAccountModal,
    openHolding: openHoldingModal,
    openInstrument: openInstrumentModal,
    openTag: openTagModal,
    signOut,
  } = createPortfolioActions({
    canEdit,
    createGuestUnlockDraft,
    createViewerProfileDraft,
    ...editor,
    guestUnlockDraft,
    holdingsByAccountId,
    holdingsByTicker,
    latestPriceByTicker,
    loadActiveViewerAccess,
    refreshState,
    session,
    setAuthStatus,
    setGuestUnlockDraft,
    setGuestUnlockError,
    setGuestUnlockSaving,
    setSession,
    setViewContext,
    setViewerProfile,
    setViewerProfileDraft,
    setViewerProfileError,
    setViewerProfileMessage,
    setViewerProfileSaving,
    setViewerProfileSchemaReady,
    state,
    supabase,
    tagMapByTicker,
    today,
    viewerProfile,
    viewerProfileDraft,
  })

  if (authStatus === 'loading') {
    return (
      <CenteredMessageView
        title={portfolioMessages.loadingTitle}
        body={portfolioMessages.loadingBody}
      />
    )
  }

  if (authStatus === 'missing-config') {
    return (
      <CenteredMessageView
        title={portfolioMessages.missingConfigTitle}
        body={portfolioMessages.missingConfigBody}
      />
    )
  }

  if (!session) {
    return (
      <LoginScreenView
        guestUnlockDraft={guestUnlockDraft}
        guestUnlockError={guestUnlockError}
        guestUnlockSaving={guestUnlockSaving}
        loginMode={loginMode}
        onGuestUnlock={handleGuestUnlock}
        onGuestUnlockChange={(field, value) => {
          setGuestUnlockError('')
          setGuestUnlockDraft((current) => ({ ...current, [field]: value }))
        }}
        onLoginModeChange={setLoginMode}
        onSignInWithGoogle={signInWithGoogle}
      />
    )
  }

  if (isAnonymousSession && viewContext.mode === 'guest') {
    return (
      <GuestUnlockScreenView
        guestUnlockDraft={guestUnlockDraft}
        guestUnlockError={guestUnlockError}
        guestUnlockSaving={guestUnlockSaving}
        onExit={signOut}
        onGuestUnlock={handleGuestUnlock}
        onGuestUnlockChange={(field, value) => {
          setGuestUnlockError('')
          setGuestUnlockDraft((current) => ({ ...current, [field]: value }))
        }}
      />
    )
  }

  

  const pageTitle = activeTab === 'overview' ? 'Portfolio' : 'Settings'

  return (
    <main className="min-h-screen px-4 py-5 text-[var(--ink)] sm:px-6">
      <div className="mx-auto max-w-6xl">
        <AppHeader
          activeTab={activeTab}
          copied={activeTab === 'overview' ? copied : false}
          copyLabel="CSV 복사"
          copySuccessLabel="CSV를 복사했어요"
          onCopy={activeTab === 'overview' ? handleCopyCsv : undefined}
          onSignOut={signOut}
          onTabChange={setActiveTab}
          pageTitle={pageTitle}
          portfolioLabel="Portfolio"
          sharedPortfolioViewLabel={portfolioMessages.sharedPortfolioView}
          sharedViewLabel={portfolioMessages.sharedView}
          signOutLabel={portfolioMessages.logout}
          tabs={tabs}
          viewContext={viewContext}
        />

        {loadError && (
          <div className="mt-6 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
            {loadError}
          </div>
        )}

        {activeTab === 'overview' && (
          <AssetsPageView
            accountTagFilter={accountTagFilter}
            accountById={accountById}
            accounts={filteredAccountCards}
            assetView={assetView}
            canEdit={canEdit}
            holdingsByAccountId={holdingsByAccountId}
            holdingsByTicker={holdingsByTicker}
            instrumentTagFilter={instrumentTagFilter}
            instruments={filteredInstrumentRows}
            onAssetViewChange={setAssetView}
            onCreateAccount={() => openAccountModal()}
            onCreateHolding={(ticker) => openHoldingModal({ ticker })}
            onCreateInstrument={() => openInstrumentModal()}
            onCreateHoldingForAccount={(accountId) => openHoldingModal({ accountId })}
            onEditAccount={(account) => openAccountModal(account)}
            onEditHolding={(holding) => openHoldingModal({ holding })}
            onEditInstrument={(instrument) => openInstrumentModal(instrument)}
            onAccountTagFilterChange={setAccountTagFilter}
            onInstrumentTagFilterChange={setInstrumentTagFilter}
            pieGradient={chartGradient}
            tagCards={tagCards}
            tagMapByTicker={tagMapByTicker}
            tags={state.tags}
            totalValue={totalValue}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsPageView
            agentActions={agentActions}
            agentActionsError={agentActionsError}
            agentActionsLoading={agentActionsLoading}
            agentMcpEndpoint={`${SUPABASE_URL}/functions/v1/portfolio-mcp`}
            agentTokenError={agentTokenError}
            agentTokenSaving={agentTokenSaving}
            agentTokens={agentTokens}
            agentTokensLoading={agentTokensLoading}
            issuedAgentToken={issuedAgentToken}
            onCreateTag={() => openTagModal()}
            onEditTag={(tag) => openTagModal(tag)}
            onAgentActionsRefresh={loadAgentActions}
            onAgentTokenCreate={handleCreateAgentToken}
            onAgentTokenDismiss={handleDismissIssuedAgentToken}
            onAgentTokenRevoke={handleRevokeAgentToken}
            onSyncPrices={handleSyncPrices}
            onViewerProfileChange={(field, value) => {
              setViewerProfileError('')
              setViewerProfileMessage('')
              setViewerProfileDraft((current) => ({ ...current, [field]: value }))
            }}
            onViewerProfileSave={handleSaveViewerProfile}
            syncingPrices={editor.syncingPrices}
            syncMessage={editor.syncMessage}
            tags={state.tags}
            viewerProfile={viewerProfile}
            viewerProfileDraft={viewerProfileDraft}
            viewerProfileError={viewerProfileError}
            viewerProfileMessage={viewerProfileMessage}
            viewerProfileSaving={viewerProfileSaving}
            viewerProfileSchemaReady={viewerProfileSchemaReady}
          />
        )}

        <PortfolioEditorModals
          {...editor}
          accounts={state.accounts}
          instruments={state.instruments}
          onDeleteAccount={handleDeleteAccount}
          onDeleteHolding={handleDeleteHolding}
          onDeleteInstrument={handleDeleteInstrument}
          onLookupHoldingTicker={handleLookupHoldingTicker}
          onSaveAccount={handleSaveAccount}
          onSaveHolding={handleSaveHolding}
          onSaveInstrument={handleSaveInstrument}
          onSaveTag={handleSaveTag}
          tags={state.tags}
        />
      </div>
    </main>
  )
}

export default App
