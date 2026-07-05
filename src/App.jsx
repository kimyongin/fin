import { useCallback, useEffect, useMemo, useState } from 'react'
import AppHeader from './components/AppHeader'
import AssetsPageView from './features/assets/AssetsPage'
import {
  CenteredMessage as CenteredMessageView,
  GuestUnlockScreen as GuestUnlockScreenView,
  LoginScreen as LoginScreenView,
} from './features/auth/AuthScreens'
import { useSupabaseSession } from './features/auth/useSupabaseSession'
import {
  AccountEditorModal as AccountEditorModalView,
  HoldingEditorModal as HoldingEditorModalView,
  InstrumentEditorModal as InstrumentEditorModalView,
  TagEditorModal as TagEditorModalView,
} from './features/modals/EditorModals'
import SettingsPageView from './features/settings/SettingsPage'
import { buildPortfolioMarkdown } from './features/portfolio/helpers'
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
import { writeClipboard } from './lib/clipboard'
import { normalizeTickerInput, today } from './lib/portfolioMath'
import { isSupabaseConfigured, supabase } from './lib/supabase'
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
  const [accountModal, setAccountModal] = useState(null)
  const [accountSaving, setAccountSaving] = useState(false)
  const [accountError, setAccountError] = useState('')
  const [instrumentModal, setInstrumentModal] = useState(null)
  const [instrumentSaving, setInstrumentSaving] = useState(false)
  const [instrumentError, setInstrumentError] = useState('')
  const [holdingModal, setHoldingModal] = useState(null)
  const [holdingSaving, setHoldingSaving] = useState(false)
  const [holdingError, setHoldingError] = useState('')
  const [holdingLookupSaving, setHoldingLookupSaving] = useState(false)
  const [holdingLookupError, setHoldingLookupError] = useState('')
  const [holdingLookupResult, setHoldingLookupResult] = useState(null)
  const [tagModal, setTagModal] = useState(null)
  const [tagSaving, setTagSaving] = useState(false)
  const [tagError, setTagError] = useState('')
  const [syncingPrices, setSyncingPrices] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
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

  async function handleCopyMarkdown() {
    await writeClipboard(buildPortfolioMarkdown(tagCards, totalValue))
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
    accountModal,
    canEdit,
    createGuestUnlockDraft,
    createViewerProfileDraft,
    guestUnlockDraft,
    holdingLookupResult,
    holdingModal,
    holdingsByAccountId,
    holdingsByTicker,
    instrumentModal,
    latestPriceByTicker,
    loadActiveViewerAccess,
    refreshState,
    session,
    setAccountError,
    setAccountModal,
    setAccountSaving,
    setAuthStatus,
    setGuestUnlockDraft,
    setGuestUnlockError,
    setGuestUnlockSaving,
    setHoldingError,
    setHoldingLookupError,
    setHoldingLookupResult,
    setHoldingLookupSaving,
    setHoldingModal,
    setHoldingSaving,
    setInstrumentError,
    setInstrumentModal,
    setInstrumentSaving,
    setSession,
    setSyncMessage,
    setSyncingPrices,
    setTagError,
    setTagModal,
    setTagSaving,
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
    tagModal,
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
          copyLabel="마크다운 복사"
          onCopy={activeTab === 'overview' ? handleCopyMarkdown : undefined}
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
            onCreateTag={() => openTagModal()}
            onEditTag={(tag) => openTagModal(tag)}
            onSyncPrices={handleSyncPrices}
            onViewerProfileChange={(field, value) => {
              setViewerProfileError('')
              setViewerProfileMessage('')
              setViewerProfileDraft((current) => ({ ...current, [field]: value }))
            }}
            onViewerProfileSave={handleSaveViewerProfile}
            syncingPrices={syncingPrices}
            syncMessage={syncMessage}
            tags={state.tags}
            viewerProfile={viewerProfile}
            viewerProfileDraft={viewerProfileDraft}
            viewerProfileError={viewerProfileError}
            viewerProfileMessage={viewerProfileMessage}
            viewerProfileSaving={viewerProfileSaving}
            viewerProfileSchemaReady={viewerProfileSchemaReady}
          />
        )}

        {accountModal && (
          <AccountEditorModalView
            accountError={accountError}
            accountSaving={accountSaving}
            draft={accountModal}
            onChange={(field, value) => {
              setAccountError('')
              setAccountModal((current) => ({ ...current, [field]: value }))
            }}
            onClose={() => {
              if (!accountSaving) {
                setAccountError('')
                setAccountModal(null)
              }
            }}
            onDelete={handleDeleteAccount}
            onSave={handleSaveAccount}
          />
        )}

        {instrumentModal && (
          <InstrumentEditorModalView
            accounts={state.accounts}
            draft={instrumentModal}
            instrumentError={instrumentError}
            instrumentSaving={instrumentSaving}
            onChange={(field, value) => {
              setInstrumentError('')
              setInstrumentModal((current) => ({ ...current, [field]: value }))
            }}
            onClose={() => {
              if (!instrumentSaving) {
                setInstrumentError('')
                setInstrumentModal(null)
              }
            }}
            onDelete={handleDeleteInstrument}
            onSave={handleSaveInstrument}
            tags={state.tags}
          />
        )}

        {holdingModal && (
          <HoldingEditorModalView
            accounts={state.accounts}
            draft={holdingModal}
            holdingError={holdingError}
            holdingLookupError={holdingLookupError}
            holdingLookupResult={holdingLookupResult}
            holdingLookupSaving={holdingLookupSaving}
            holdingSaving={holdingSaving}
            instruments={state.instruments.filter((item) => item.instrument_type !== 'fx')}
            onChange={(field, value) => {
              setHoldingError('')
              setHoldingLookupError('')
              if (field === 'ticker') {
                setHoldingLookupResult((current) =>
                  current?.ticker === normalizeTickerInput(value) ? current : null,
                )
              }
              setHoldingModal((current) => ({ ...current, [field]: value }))
            }}
            onClose={() => {
              if (!holdingSaving) {
                setHoldingError('')
                setHoldingLookupError('')
                setHoldingLookupResult(null)
                setHoldingModal(null)
              }
            }}
            onLookupTicker={handleLookupHoldingTicker}
            onDelete={handleDeleteHolding}
            onSave={handleSaveHolding}
          />
        )}

        {tagModal && (
          <TagEditorModalView
            draft={tagModal}
            onChange={(field, value) => {
              setTagError('')
              setTagModal((current) => ({ ...current, [field]: value }))
            }}
            onClose={() => {
              if (!tagSaving) {
                setTagError('')
                setTagModal(null)
              }
            }}
            onSave={handleSaveTag}
            tagError={tagError}
            tagSaving={tagSaving}
          />
        )}
      </div>
    </main>
  )
}

export default App
