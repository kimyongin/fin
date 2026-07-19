import { useCallback, useMemo, useState } from 'react'
import AppHeader from './components/AppHeader'
import ActivityPageView from './features/activity/ActivityPage'
import AssetsPageView from './features/assets/AssetsPage'
import GuidePageView from './features/guide/GuidePage'
import NewsPageView from './features/news/NewsPage'
import {
  CenteredMessage as CenteredMessageView,
  GuestUnlockScreen as GuestUnlockScreenView,
  LoginScreen as LoginScreenView,
} from './features/auth/AuthScreens'
import { useAgentControls } from './features/agent/useAgentControls'
import { useSupabaseSession } from './features/auth/useSupabaseSession'
import PortfolioEditorModals from './features/modals/PortfolioEditorModals'
import SettingsPageView from './features/settings/SettingsPage'
import StrategyPageView from './features/strategy/StrategyPage'
import { buildPortfolioCsv } from './features/portfolio/helpers'
import { createPortfolioActions } from './features/portfolio/actions'
import {
  createEmptyPortfolioState,
  createOwnerViewContext,
  fetchActiveViewerAccess,
  fetchFriends,
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
  createFriendDraft,
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
  const [friends, setFriends] = useState([])
  const [friendDraft, setFriendDraft] = useState(() => createFriendDraft())
  const [friendError, setFriendError] = useState('')
  const [friendSaving, setFriendSaving] = useState(false)
  const [viewContext, setViewContext] = useState(() => createOwnerViewContext())
  const [accountTagFilter, setAccountTagFilter] = useState('all')
  const [instrumentTagFilter, setInstrumentTagFilter] = useState('all')
  const [spreadsheetSaving, setSpreadsheetSaving] = useState(false)
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
    ownerUserId: viewContext.mode === 'shared' ? viewContext.ownerUserId : null,
    session,
    supabase,
  })

  const refreshState = useCallback(async (ownerUserId = null) => {
    setLoadError('')
    setState(await fetchPortfolioState(supabase, ownerUserId))
  }, [])

  const loadFriends = useCallback(async () => {
    try {
      const nextFriends = await fetchFriends(supabase)
      setFriends(nextFriends)
      return nextFriends
    } catch (error) {
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
        setFriends([])
        return []
      }
      throw error
    }
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
    guestUnlockSaving,
    loadActiveViewerAccess,
    loadFriends,
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

  const handlePortfolioChange = useCallback(async (ownerUserId) => {
    if (ownerUserId === 'owner') {
      setViewContext(createOwnerViewContext(session.user.id))
      setActiveTab('overview')
      await refreshState()
      return
    }

    const friend = friends.find((item) => item.owner_user_id === ownerUserId)
    if (!friend) return

    setViewContext({
      mode: 'shared',
      ownerUserId: friend.owner_user_id,
      ownerPublicName: friend.owner_public_name ?? '',
    })
    setActiveTab('overview')
    await refreshState(friend.owner_user_id)
  }, [friends, refreshState, session?.user?.id, setActiveTab])

  const handleAddFriend = useCallback(async () => {
    setFriendSaving(true)
    setFriendError('')
    try {
      const { data, error } = await supabase.rpc('add_friend', {
        input_public_name: friendDraft.public_name.trim(),
        input_viewer_password: friendDraft.viewer_password,
      })
      if (error) throw error

      const friend = Array.isArray(data) ? data[0] : data
      const nextFriends = await loadFriends()
      setFriendDraft(createFriendDraft())
      if (friend?.owner_user_id && nextFriends.some((item) => item.owner_user_id === friend.owner_user_id)) {
        await handlePortfolioChange(friend.owner_user_id)
      }
    } catch (error) {
      setFriendError(error.message ?? '친구를 추가하지 못했습니다.')
    } finally {
      setFriendSaving(false)
    }
  }, [friendDraft, handlePortfolioChange, loadFriends])

  const handleRemoveFriend = useCallback(async (ownerUserId) => {
    setFriendSaving(true)
    setFriendError('')
    try {
      const { error } = await supabase.rpc('remove_friend', { input_owner_user_id: ownerUserId })
      if (error) throw error
      await loadFriends()
      if (viewContext.ownerUserId === ownerUserId) {
        setViewContext(createOwnerViewContext(session.user.id))
        setActiveTab('overview')
        await refreshState()
      }
    } catch (error) {
      setFriendError(error.message ?? '친구를 해제하지 못했습니다.')
    } finally {
      setFriendSaving(false)
    }
  }, [loadFriends, refreshState, session?.user?.id, setActiveTab, viewContext.ownerUserId])

  const latestPriceByTicker = useMemo(() => {
    return new Map(state.prices.map((row) => [row.ticker, row]))
  }, [state.prices])

  const {
    accountById,
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

  const handleSpreadsheetSave = useCallback(async (rows) => {
    if (!canEdit) throw new Error('읽기 전용 포트폴리오에서는 수정할 수 없습니다.')
    setSpreadsheetSaving(true)
    try {
      const { data, error } = await supabase.rpc('app_bulk_save_portfolio_rows', {
        input_rows: rows.map((row) => ({
          account_name: row.account_name.trim(),
          broker: row.broker.trim(),
          ticker: row.ticker.trim().toUpperCase(),
          display_name: row.display_name.trim(),
          currency: row.currency,
          instrument_type: row.instrument_type,
          quantity: row.quantity === '' ? null : Number(row.quantity),
          avg_price: row.avg_price === '' ? null : Number(row.avg_price),
          purchase_amount: row.purchase_amount === '' ? null : Number(row.purchase_amount),
          valuation_amount: row.valuation_amount === '' ? null : Number(row.valuation_amount),
          tag_id: row.tag_id || null,
          note: row.note.trim(),
        })),
      })
      if (error) throw error
      await refreshState()
      return Array.isArray(data) ? data[0] : data
    } finally {
      setSpreadsheetSaving(false)
    }
  }, [canEdit, refreshState])

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
    handleDeleteTag,
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

  

  const pageTitle = activeTab === 'overview' ? 'Portfolio' : activeTab === 'strategy' ? 'Strategy' : activeTab === 'news' ? 'News' : activeTab === 'activity' ? 'Activity' : activeTab === 'guide' ? 'Guide' : 'Settings'

  return (
    <main className="min-h-screen px-4 py-5 text-[var(--ink)] sm:px-6">
      <div className="mx-auto max-w-6xl">
        <AppHeader
          activeTab={activeTab}
          copied={activeTab === 'overview' ? copied : false}
          copyLabel="CSV 복사"
          copySuccessLabel="CSV를 복사했어요"
          friends={friends}
          onCopy={activeTab === 'overview' ? handleCopyCsv : undefined}
          onPortfolioChange={!isAnonymousSession && friends.length > 0 ? handlePortfolioChange : undefined}
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
            onSpreadsheetSave={handleSpreadsheetSave}
            spreadsheetSaving={spreadsheetSaving}
            sheetAccounts={state.accounts}
            sheetInstruments={state.instruments}
            holdings={state.holdings}
            instrumentTags={state.instrumentTags}
            tagCards={tagCards}
            tagMapByTicker={tagMapByTicker}
            tags={state.tags}
            totalValue={totalValue}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsPageView
            agentMcpEndpoint={`${SUPABASE_URL}/functions/v1/portfolio-mcp`}
            agentTokenError={agentTokenError}
            agentTokenSaving={agentTokenSaving}
            agentTokens={agentTokens}
            agentTokensLoading={agentTokensLoading}
            issuedAgentToken={issuedAgentToken}
            friendDraft={friendDraft}
            friendError={friendError}
            friendSaving={friendSaving}
            friends={friends}
            onAddFriend={handleAddFriend}
            onCreateTag={() => openTagModal()}
            onEditTag={(tag) => openTagModal(tag)}
            onFriendChange={(field, value) => {
              setFriendError('')
              setFriendDraft((current) => ({ ...current, [field]: value }))
            }}
            onRemoveFriend={handleRemoveFriend}
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
        {activeTab === 'strategy' && (
          <StrategyPageView
            canEdit={canEdit}
            ownerUserId={viewContext.mode === 'shared' ? viewContext.ownerUserId : null}
            supabase={supabase}
            tagCards={tagCards}
            tags={state.tags}
            totalValue={totalValue}
          />
        )}
        {activeTab === 'news' && (
          <NewsPageView
            canEdit={canEdit}
            ownerUserId={viewContext.mode === 'shared' ? viewContext.ownerUserId : null}
            supabase={supabase}
          />
        )}
        {activeTab === 'activity' && (
          <ActivityPageView
            actions={agentActions}
            error={agentActionsError}
            loading={agentActionsLoading}
            onRefresh={loadAgentActions}
          />
        )}
        {activeTab === 'guide' && <GuidePageView />}

        <PortfolioEditorModals
          {...editor}
          accounts={state.accounts}
          instruments={state.instruments}
          onDeleteAccount={handleDeleteAccount}
          onDeleteHolding={handleDeleteHolding}
          onDeleteInstrument={handleDeleteInstrument}
          onDeleteTag={handleDeleteTag}
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
