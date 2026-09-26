import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppHeader from './components/AppHeader'
import AssetsPageView from './features/assets/AssetsPage'
import GuidePageView from './features/guide/GuidePage'
import FeedbackPageView from './features/feedback/FeedbackPage'
import LifecyclePageView from './features/lifecycle/LifecyclePage'
import {
  CenteredMessage as CenteredMessageView,
  GuestUnlockScreen as GuestUnlockScreenView,
  LoginScreen as LoginScreenView,
} from './features/auth/AuthScreens'
import OAuthConsentPage from './features/auth/OAuthConsentPage'
import { useSupabaseSession } from './features/auth/useSupabaseSession'
import PortfolioEditorModals from './features/modals/PortfolioEditorModals'
import SettingsPageView from './features/settings/SettingsPage'
import StrategyPageView from './features/strategy/StrategyPage'
import { buildPortfolioCsv } from './features/portfolio/helpers'
import { createPortfolioActions } from './features/portfolio/actions'
import { createAccessActions } from './features/auth/accessActions'
import {
  createEmptyPortfolioState,
  createOwnerViewContext,
  fetchActiveViewerAccess,
  fetchFriends,
  fetchPortfolioViewers,
  fetchPortfolioState,
  fetchSharedFeatureAccess,
  fetchViewerProfile,
  markSharedPortfolioView,
} from './features/portfolio/data'
import { portfolioMessages } from './features/portfolio/messages'
import { usePortfolioBootstrap } from './features/portfolio/usePortfolioBootstrap'
import { usePortfolioNavigation } from './features/portfolio/usePortfolioNavigation'
import { usePortfolioDerivedData } from './features/portfolio/usePortfolioDerivedData'
import { usePortfolioEditorState } from './features/portfolio/usePortfolioEditorState'
import { writeClipboard } from './lib/clipboard'
import { today } from './lib/portfolioMath'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { createRequestGate } from './lib/requestGate'
import {
  createGuestUnlockDraft,
  createFriendDraft,
  createViewerProfileDraft,
  isViewerSchemaMissingError,
} from './lib/viewerAccess'

function authRedirectTo() {
  const currentUrl = new URL(window.location.href)
  if (currentUrl.searchParams.has('authorization_id')) {
    currentUrl.hash = ''
    return currentUrl.toString()
  }
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

function App() {
  const authorizationId = new URLSearchParams(window.location.search).get('authorization_id')
  const [loginMode, setLoginMode] = useState('owner')
  const [copied, setCopied] = useState(false)
  const editor = usePortfolioEditorState()
  const [viewerProfileSchemaReady, setViewerProfileSchemaReady] = useState(true)
  const [viewerProfileSaving, setViewerProfileSaving] = useState(false)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [viewerProfileLoaded, setViewerProfileLoaded] = useState(false)
  const [viewerProfileError, setViewerProfileError] = useState('')
  const [viewerProfileErrorTarget, setViewerProfileErrorTarget] = useState('sharing')
  const [viewerProfileMessage, setViewerProfileMessage] = useState('')
  const [viewerProfile, setViewerProfile] = useState(() => createViewerProfileDraft())
  const [viewerProfileDraft, setViewerProfileDraft] = useState(() => createViewerProfileDraft())
  const [guestUnlockDraft, setGuestUnlockDraft] = useState(() => createGuestUnlockDraft())
  const [guestUnlockSaving, setGuestUnlockSaving] = useState(false)
  const [guestUnlockError, setGuestUnlockError] = useState('')
  const [friends, setFriends] = useState([])
  const [portfolioViewers, setPortfolioViewers] = useState([])
  const [portfolioViewersNextOffset, setPortfolioViewersNextOffset] = useState(null)
  const [portfolioViewersError, setPortfolioViewersError] = useState('')
  const [portfolioViewersLoading, setPortfolioViewersLoading] = useState(false)
  const [loadedOwnerUserId, setLoadedOwnerUserId] = useState(null)
  const markedViewEntryRef = useRef(null)
  const readySharedPageRef = useRef(null)
  const currentViewRef = useRef(null)
  const [friendDraft, setFriendDraft] = useState(() => createFriendDraft())
  const [friendError, setFriendError] = useState('')
  const [friendSaving, setFriendSaving] = useState(false)
  const [viewContext, setViewContext] = useState(() => createOwnerViewContext())
  const [sharedFeatureAccess, setSharedFeatureAccess] = useState(null)
  const [assetAccountId, setAssetAccountId] = useState('all')
  const [assetQuery, setAssetQuery] = useState('')
  const [registeredTicker, setRegisteredTicker] = useState(null)
  const [sheetDirty, setSheetDirty] = useState(false)
  const [spreadsheetSaving, setSpreadsheetSaving] = useState(false)
  const [state, setState] = useState(() => createEmptyPortfolioState())
  const [loadError, setLoadError] = useState('')
  const [lifecycleSelection, setLifecycleSelection] = useState(null)
  const { authStatus, session, setAuthStatus, setSession } = useSupabaseSession({
    isConfigured: isSupabaseConfigured,
    supabase,
  })
  const isAnonymousSession = Boolean(session?.user?.is_anonymous)
  const portfolioRequestGate = useRef(createRequestGate())
  const profileWriteRef = useRef(false)
  const avatarWriteRef = useRef(false)
  const sessionUserId = session?.user?.id ?? null
  const sessionUserIdRef = useRef(sessionUserId)
  sessionUserIdRef.current = sessionUserId
  const canEdit = viewContext.mode === 'owner' && !isAnonymousSession
  const { activeTab, setActiveTab, tabs } = usePortfolioNavigation(canEdit, sharedFeatureAccess, !isAnonymousSession)
  const sharedEntryKey = viewContext.mode === 'shared' ? `${viewContext.ownerUserId}:${activeTab}` : null
  if (readySharedPageRef.current?.key !== sharedEntryKey) readySharedPageRef.current = null
  currentViewRef.current = { activeTab, isAnonymousSession, loadedOwnerUserId, mode: viewContext.mode, ownerUserId: viewContext.ownerUserId }
  const [feedbackSourcePage, setFeedbackSourcePage] = useState('')

  const handleTabChange = useCallback((nextTab) => {
    if (sheetDirty && nextTab !== activeTab && !window.confirm('저장하지 않은 표 변경을 버리고 이동할까요?')) return
    if (nextTab === 'feedback' && activeTab !== 'feedback') {
      setFeedbackSourcePage(activeTab)
    }
    setActiveTab(nextTab)
  }, [activeTab, setActiveTab, sheetDirty])
  const refreshState = useCallback(async (ownerUserId = null) => {
    const request = portfolioRequestGate.current.begin()
    const requestedByUserId = sessionUserIdRef.current
    setLoadError('')
    const nextState = await fetchPortfolioState(supabase, ownerUserId)
    if (!request.isCurrent() || sessionUserIdRef.current !== requestedByUserId) return false
    setState(nextState)
    setLoadedOwnerUserId(ownerUserId)
    return nextState
  }, [])

  useEffect(() => {
    portfolioRequestGate.current.invalidate()
    if (!sessionUserId) {
      setState(createEmptyPortfolioState())
      setLoadedOwnerUserId(null)
    }
  }, [sessionUserId])

  const loadPortfolioViewers = useCallback(async (offset = 0) => {
    setPortfolioViewersLoading(true)
    setPortfolioViewersError('')
    try {
      const page = await fetchPortfolioViewers(supabase, offset)
      setPortfolioViewers((current) => offset === 0 ? page.items : [...current, ...page.items])
      setPortfolioViewersNextOffset(page.nextOffset)
    } catch (error) {
      setPortfolioViewersError(error.message ?? '공유받는 친구를 불러오지 못했습니다.')
    } finally {
      setPortfolioViewersLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'settings' && sessionUserId && !isAnonymousSession) loadPortfolioViewers()
  }, [activeTab, isAnonymousSession, loadPortfolioViewers, sessionUserId])

  const signalSharedViewReady = useCallback((ownerUserId, tab) => {
    const current = currentViewRef.current
    if (!ownerUserId || current?.mode !== 'shared' || current.ownerUserId !== ownerUserId
      || current.activeTab !== tab || current.isAnonymousSession) return
    const entryKey = `${ownerUserId}:${tab}`
    readySharedPageRef.current = { key: entryKey }
    if (current.loadedOwnerUserId !== ownerUserId) return
    if (markedViewEntryRef.current === entryKey) return
    window.requestAnimationFrame(() => {
      const latest = currentViewRef.current
      if (latest?.mode !== 'shared' || latest.ownerUserId !== ownerUserId
        || latest.activeTab !== tab || latest.isAnonymousSession || latest.loadedOwnerUserId !== ownerUserId
        || markedViewEntryRef.current === entryKey) return
      markedViewEntryRef.current = entryKey
      markSharedPortfolioView(supabase, ownerUserId).catch(() => { /* Reading remains available when the signal fails. */ })
    })
  }, [])

  useEffect(() => {
    if (viewContext.mode !== 'shared') {
      markedViewEntryRef.current = null
      return
    }
    if (activeTab === 'overview' && loadedOwnerUserId === viewContext.ownerUserId) {
      signalSharedViewReady(viewContext.ownerUserId, 'overview')
    } else if (loadedOwnerUserId === viewContext.ownerUserId
      && readySharedPageRef.current?.key === sharedEntryKey) {
      signalSharedViewReady(viewContext.ownerUserId, activeTab)
    }
  }, [activeTab, loadedOwnerUserId, sharedEntryKey, signalSharedViewReady, viewContext.mode, viewContext.ownerUserId])

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

  const loadViewerProfile = useCallback(async (preserveDraft = false) => {
    setViewerProfileError('')
    setViewerProfileMessage('')
    setViewerProfileLoaded(false)

    try {
      const nextProfile = createViewerProfileDraft(await fetchViewerProfile(supabase))
      setViewerProfileSchemaReady(true)
      setViewerProfile(nextProfile)
      setViewerProfileDraft((current) => preserveDraft
        ? { ...current, avatar_key: nextProfile.avatar_key, viewer_password_updated_at: nextProfile.viewer_password_updated_at }
        : nextProfile)
      setViewerProfileLoaded(true)
    } catch (error) {
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
        setViewerProfile(createViewerProfileDraft())
        setViewerProfileDraft(createViewerProfileDraft())
        return
      }
      setViewerProfileErrorTarget('sharing')
      setViewerProfileError(error.message ?? '공유 설정을 불러오지 못했습니다.')
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

  useEffect(() => {
    let active = true
    if (viewContext.mode !== 'shared' || !viewContext.ownerUserId) {
      setSharedFeatureAccess(null)
      return () => { active = false }
    }

    setSharedFeatureAccess(null)
    fetchSharedFeatureAccess(supabase, viewContext.ownerUserId)
      .then((access) => { if (active) setSharedFeatureAccess(access) })
      .catch((error) => {
        if (!active) return
        setSharedFeatureAccess(null)
        setLoadError(error.message ?? '공유 범위를 불러오지 못했습니다.')
      })
    return () => { active = false }
  }, [viewContext.mode, viewContext.ownerUserId])

  const handlePortfolioChange = useCallback(async (ownerUserId) => {
    if (sheetDirty && !window.confirm('저장하지 않은 표 변경을 버리고 이동할까요?')) return
    portfolioRequestGate.current.invalidate()
    setLoadedOwnerUserId(null)
    setState(createEmptyPortfolioState())
    setLoadError('')
    setLifecycleSelection(null)
    setAssetAccountId('all')
    setAssetQuery('')
    editor.setAccountModal(null)
    editor.setHoldingModal(null)
    editor.setInstrumentModal(null)
    if (ownerUserId === 'owner') {
      setViewContext(createOwnerViewContext(session.user.id))
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
    await refreshState(friend.owner_user_id)
  }, [editor, friends, refreshState, session?.user?.id, sheetDirty])

  const handleAvatarSelect = useCallback(async (avatarKey) => {
    if (avatarWriteRef.current || !viewerProfileLoaded || !viewerProfileSchemaReady || avatarKey === viewerProfile.avatar_key) return
    avatarWriteRef.current = true
    const previousAvatarKey = viewerProfile.avatar_key
    setAvatarSaving(true)
    setAvatarError('')
    setViewerProfile((current) => ({ ...current, avatar_key: avatarKey }))
    setViewerProfileDraft((current) => ({ ...current, avatar_key: avatarKey }))
    try {
      const { data, error } = await supabase.rpc('app_set_profile_avatar', { input_avatar_key: avatarKey })
      if (error) throw error
      setViewerProfile((current) => ({ ...current, avatar_key: data }))
      setViewerProfileDraft((current) => ({ ...current, avatar_key: data }))
    } catch (error) {
      setViewerProfile((current) => ({ ...current, avatar_key: previousAvatarKey }))
      setViewerProfileDraft((current) => ({ ...current, avatar_key: previousAvatarKey }))
      setAvatarError(error.message ?? '아이콘을 저장하지 못했습니다.')
    } finally {
      avatarWriteRef.current = false
      setAvatarSaving(false)
    }
  }, [viewerProfile.avatar_key, viewerProfileLoaded, viewerProfileSchemaReady])

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
        portfolioRequestGate.current.invalidate()
        setLoadedOwnerUserId(null)
        setState(createEmptyPortfolioState())
        setViewContext({ mode: 'shared', ownerUserId: friend.owner_user_id, ownerPublicName: friend.owner_public_name ?? '' })
        setActiveTab('overview')
        await refreshState(friend.owner_user_id)
      }
    } catch (error) {
      setFriendError(error.message ?? '친구를 추가하지 못했습니다.')
    } finally {
      setFriendSaving(false)
    }
  }, [friendDraft, loadFriends, refreshState, setActiveTab])

  const handleRemoveFriend = useCallback(async (ownerUserId) => {
    setFriendSaving(true)
    setFriendError('')
    try {
      const { error } = await supabase.rpc('remove_friend', { input_owner_user_id: ownerUserId })
      if (error) throw error
      await loadFriends()
      if (viewContext.ownerUserId === ownerUserId) {
        setAssetAccountId('all')
        setAssetQuery('')
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
    instrumentRows,
    holdingsByAccountId,
    holdingsByTicker,
    tagCards,
    tagMapByTicker,
    totalValue,
    valuationQuality,
  } = usePortfolioDerivedData({
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
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: authRedirectTo(),
        skipBrowserRedirect: true,
      },
    })
    if (error) throw error
    if (!data?.url) throw new Error('Google 로그인 주소를 받지 못했습니다.')
    window.location.assign(data.url)
  }

  const {
    handleDeleteAccount,
    handleDeleteHolding,
    handleDeleteInstrument,
    handleLookupInstrumentTicker,
    handleLookupHoldingTicker,
    handleSaveAccount,
    handleSaveHolding,
    handleSaveInstrument,
    handleSyncPrices,
    openAccount: openAccountModal,
    openHolding: openHoldingModal,
    openInstrument: openInstrumentModal,
  } = createPortfolioActions({
    canEdit,
    ...editor,
    holdingsByAccountId,
    holdingsByTicker,
    latestPriceByTicker,
    refreshState,
    setLoadError,
    state,
    supabase,
    tagMapByTicker,
    today,
    onInstrumentSaved: (ticker) => {
      setAssetAccountId('all')
      setAssetQuery('')
      setRegisteredTicker(ticker)
    },
  })

  const { handleGuestUnlock, handleSaveViewerProfile, signOut } = createAccessActions({
    canEdit, createGuestUnlockDraft, createViewerProfileDraft, guestUnlockDraft, refreshState, session,
    setAuthStatus, setGuestUnlockDraft, setGuestUnlockError, setGuestUnlockSaving, setSession,
    setViewContext, setViewerProfile, setViewerProfileDraft, setViewerProfileError,
    setViewerProfileErrorTarget, setViewerProfileLoaded, setViewerProfileMessage,
    setViewerProfileSaving, setViewerProfileSchemaReady, profileWriteRef,
    supabase, viewerProfile, viewerProfileDraft,
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

  if (authorizationId) {
    return (
      <OAuthConsentPage
        authorizationId={authorizationId}
        onSignIn={signInWithGoogle}
        session={session}
        supabase={supabase}
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

  

  const pageTitle = activeTab === 'overview' ? '자산' : activeTab === 'allocation' ? '배분' : activeTab === 'tasks' ? '활동' : activeTab === 'strategy' ? '원칙' : activeTab === 'feedback' ? '피드백' : activeTab === 'guide' ? '가이드' : '설정'

  return (
    <main className="min-h-screen px-4 pb-24 pt-5 text-[var(--ink)] sm:px-6">
      <div className="mx-auto max-w-6xl">
        <h1 className="sr-only">{pageTitle}</h1>
        <AppHeader
          activeTab={activeTab}
          friends={friends}
          onPortfolioChange={!isAnonymousSession ? handlePortfolioChange : undefined}
          onSignOut={signOut}
          onTabChange={handleTabChange}
          pageTitle={pageTitle}
          ownerAvatarKey={viewerProfile.avatar_key}
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

        {activeTab === 'tasks' && (
          <LifecyclePageView
            canViewTimeline={canEdit || Boolean(sharedFeatureAccess?.features?.tasks || sharedFeatureAccess?.features?.activity)}
            initialSelection={lifecycleSelection}
            mode={activeTab}
            onModeChange={setActiveTab}
            onSharedViewReady={(ownerUserId) => signalSharedViewReady(ownerUserId, 'tasks')}
            onSelectionHandled={() => setLifecycleSelection(null)}
            ownerUserId={viewContext.mode === 'shared' ? viewContext.ownerUserId : null}
            supabase={supabase}
          />
        )}

        {activeTab === 'overview' && (
          <AssetsPageView
            key={viewContext.ownerUserId}
            shared={viewContext.mode === 'shared'}
            accountById={accountById}
            accounts={state.accounts}
            selectedAccountId={assetAccountId}
            onSelectedAccountIdChange={setAssetAccountId}
            query={assetQuery}
            onQueryChange={setAssetQuery}
            canEdit={canEdit}
            csvCopied={copied}
            holdingsByTicker={holdingsByTicker}
            instruments={instrumentRows}
            latestPriceByTicker={latestPriceByTicker}
            onCopyCsv={handleCopyCsv}
            onCreateAccount={() => openAccountModal()}
            onCreateInstrument={() => openInstrumentModal()}
            registeredTicker={registeredTicker}
            onRegisteredTickerHandled={() => setRegisteredTicker(null)}
            onEditAccount={(account) => openAccountModal(account)}
            onEditHolding={(holding) => openHoldingModal({ holding })}
            onEditInstrument={(instrument) => openInstrumentModal(instrument)}
            onSpreadsheetSave={handleSpreadsheetSave}
            onSheetDirtyChange={setSheetDirty}
            onSyncPrices={handleSyncPrices}
            syncingPrices={editor.syncingPrices}
            syncMessage={editor.syncMessage}
            spreadsheetSaving={spreadsheetSaving}
            sheetAccounts={state.accounts}
            sheetInstruments={state.instruments}
            holdings={state.holdings}
            computedPositions={computedPositions}
            instrumentTags={state.instrumentTags}
            tagMapByTicker={tagMapByTicker}
            tags={state.tags}
            supabase={supabase}
            onTradeSaved={() => refreshState()}
          />
        )}
        {activeTab === 'allocation' && (
          <StrategyPageView
            canEdit={canEdit}
            csvCopied={copied}
            onCopyCsv={handleCopyCsv}
            onRefreshTags={async () => {
              const latest = await refreshState()
              if (!latest) throw new Error('태그 목록을 새로고침하지 못했습니다.')
              return latest.tags
            }}
            onSyncPrices={handleSyncPrices}
            ownerUserId={viewContext.mode === 'shared' ? viewContext.ownerUserId : null}
            section="allocation"
            onSharedViewReady={(ownerUserId) => signalSharedViewReady(ownerUserId, 'allocation')}
            showStrategy={canEdit || Boolean(sharedFeatureAccess?.features?.strategy)}
            showAssets={canEdit || Boolean(sharedFeatureAccess?.features?.assets)}
            supabase={supabase}
            tagCards={tagCards}
            tags={state.tags}
            syncingPrices={editor.syncingPrices}
            syncMessage={editor.syncMessage}
            totalValue={totalValue}
            valuationQuality={valuationQuality}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsPageView
            friendDraft={friendDraft}
            friendError={friendError}
            friendSaving={friendSaving}
            friends={friends}
            portfolioViewers={portfolioViewers}
            portfolioViewersError={portfolioViewersError}
            portfolioViewersLoading={portfolioViewersLoading}
            portfolioViewersNextOffset={portfolioViewersNextOffset}
            onPortfolioViewersReload={() => loadPortfolioViewers()}
            onPortfolioViewersMore={() => loadPortfolioViewers(portfolioViewersNextOffset)}
            onAddFriend={handleAddFriend}
            onFriendChange={(field, value) => {
              setFriendError('')
              setFriendDraft((current) => ({ ...current, [field]: value }))
            }}
            onRemoveFriend={handleRemoveFriend}
            onViewFriend={handlePortfolioChange}
            onViewerProfileChange={(field, value) => {
              setViewerProfileError('')
              setViewerProfileMessage('')
              setViewerProfileDraft((current) => ({ ...current, [field]: value }))
            }}
            onViewerProfileSave={handleSaveViewerProfile}
            onViewerProfileReload={loadViewerProfile}
            onAvatarSelect={handleAvatarSelect}
            avatarSaving={avatarSaving}
            avatarError={avatarError}
            viewerProfile={viewerProfile}
            viewerProfileDraft={viewerProfileDraft}
            viewerProfileError={viewerProfileError}
            viewerProfileErrorTarget={viewerProfileErrorTarget}
            viewerProfileLoaded={viewerProfileLoaded}
            viewerProfileMessage={viewerProfileMessage}
            viewerProfileSaving={viewerProfileSaving}
            viewerProfileSchemaReady={viewerProfileSchemaReady}
          />
        )}
        {activeTab === 'strategy' && (
          <StrategyPageView
            canEdit={canEdit}
            ownerUserId={viewContext.mode === 'shared' ? viewContext.ownerUserId : null}
            section="principles"
            onSharedViewReady={(ownerUserId) => signalSharedViewReady(ownerUserId, 'strategy')}
            supabase={supabase}
            tagCards={tagCards}
            tags={state.tags}
            totalValue={totalValue}
            valuationQuality={valuationQuality}
          />
        )}
        {activeTab === 'feedback' && (
          <FeedbackPageView
            context={feedbackSourcePage ? { page_key: feedbackSourcePage } : {}}
            supabase={supabase}
          />
        )}
        {activeTab === 'guide' && <GuidePageView onNavigate={setActiveTab} />}

        <PortfolioEditorModals
          {...editor}
          accounts={state.accounts}
          instruments={state.instruments}
          onDeleteAccount={handleDeleteAccount}
          onDeleteHolding={handleDeleteHolding}
          onDeleteInstrument={handleDeleteInstrument}
          onLookupHoldingTicker={handleLookupHoldingTicker}
          onLookupInstrumentTicker={handleLookupInstrumentTicker}
          onSaveAccount={handleSaveAccount}
          onSaveHolding={handleSaveHolding}
          onSaveInstrument={handleSaveInstrument}
          tags={state.tags}
        />
      </div>
    </main>
  )
}

export default App
