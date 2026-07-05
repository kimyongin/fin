import { useEffect, useMemo, useRef, useState } from 'react'
import AssetsPageView from './features/assets/AssetsPage'
import {
  CenteredMessage as CenteredMessageView,
  GuestUnlockScreen as GuestUnlockScreenView,
  LoginScreen as LoginScreenView,
} from './features/auth/AuthScreens'
import {
  AccountEditorModal as AccountEditorModalView,
  HoldingEditorModal as HoldingEditorModalView,
  InstrumentEditorModal as InstrumentEditorModalView,
  TagEditorModal as TagEditorModalView,
} from './features/modals/EditorModals'
import SettingsPageView from './features/settings/SettingsPage'
import {
  buildPortfolioMarkdown,
  createAccountModalDraft,
  createHoldingLookupResult,
  createHoldingModalDraft,
  createInstrumentModalDraft,
  createTagModalDraft,
} from './features/portfolio/helpers'
import {
  createEmptyPortfolioState,
  createOwnerViewContext,
  fetchActiveViewerAccess,
  fetchPortfolioState,
  fetchViewerProfile,
} from './features/portfolio/data'
import { usePortfolioDerivedData } from './features/portfolio/usePortfolioDerivedData'
import { allTabs, assetViewOptions } from './constants/portfolio'
import { writeClipboard } from './lib/clipboard'
import { formatKrw } from './lib/format'
import {
  normalizeTickerInput,
  today,
} from './lib/portfolioMath'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import {
  createGuestUnlockDraft,
  createViewerProfileDraft,
  formatFunctionInvokeError,
  formatSupabaseError,
  isViewerSchemaMissingError,
  sha256Hex,
} from './lib/viewerAccess'

const tabIds = new Set(allTabs.map((tab) => tab.id))

function authRedirectTo() {
  return `${window.location.origin}${import.meta.env.BASE_URL}`
}

function tabFromHash() {
  if (typeof window === 'undefined') return 'overview'
  const hash = window.location.hash.replace(/^#/, '').trim()
  if (hash === 'accounts' || hash === 'instruments') return 'overview'
  return tabIds.has(hash) ? hash : 'overview'
}

function assetViewFromHash() {
  if (typeof window === 'undefined') return 'tags'
  const hash = window.location.hash.replace(/^#/, '').trim()
  return hash === 'accounts' || hash === 'instruments' ? hash : 'tags'
}

function App() {
  const [session, setSession] = useState(null)
  const [authStatus, setAuthStatus] = useState('loading')
  const [activeTab, setActiveTab] = useState(() => tabFromHash())
  const [assetView, setAssetView] = useState(() => assetViewFromHash())
  const [loginMode, setLoginMode] = useState('owner')
  const [menuOpen, setMenuOpen] = useState(false)
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
  const menuRef = useRef(null)
  const isAnonymousSession = Boolean(session?.user?.is_anonymous)
  const canEdit = viewContext.mode === 'owner' && !isAnonymousSession
  const tabs = useMemo(
    () => allTabs.filter((tab) => canEdit || tab.id !== 'settings'),
    [canEdit],
  )

  useEffect(() => {
    if (!isSupabaseConfigured) {
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
  }, [])

  useEffect(() => {
    if (!menuOpen) return

    function handleClick(event) {
      if (!menuRef.current?.contains(event.target)) {
        setMenuOpen(false)
      }
    }

    function handleKeydown(event) {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeydown)
    }
  }, [menuOpen])

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#/, '').trim()
      const nextTab = tabFromHash()
      if (hash === 'accounts' || hash === 'instruments') {
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

  async function refreshState() {
    setLoadError('')
    setState(await fetchPortfolioState(supabase))
  }

  async function loadActiveViewerAccess() {
    try {
      return await fetchActiveViewerAccess(supabase)
    } catch (error) {
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
        return null
      }
      throw error
    }
  }

  async function loadViewerProfile() {
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
  }

  useEffect(() => {
    if (!session) {
      setViewContext(createOwnerViewContext())
      setState(createEmptyPortfolioState())
      setViewerProfile(createViewerProfileDraft())
      setViewerProfileDraft(createViewerProfileDraft())
      return
    }

    let cancelled = false

    async function bootstrapSession() {
      setLoadError('')

      if (session.user?.is_anonymous) {
        setViewerProfile(createViewerProfileDraft())
        setViewerProfileDraft(createViewerProfileDraft())
        const access = await loadActiveViewerAccess()
        if (cancelled) return

        if (!access?.owner_user_id) {
          setGuestUnlockError('')
          setViewContext({ mode: 'guest', ownerUserId: null, ownerPublicName: '' })
          setState(createEmptyPortfolioState())
          return
        }

        setViewContext({
          mode: 'shared',
          ownerUserId: access.owner_user_id,
          ownerPublicName: access.owner_public_name ?? '',
        })
        await refreshState()
        return
      }

      setViewContext(createOwnerViewContext(session.user.id))
      await Promise.all([refreshState(), loadViewerProfile()])
    }

    bootstrapSession().catch((error) => {
      if (!cancelled) {
        setLoadError(error.message ?? String(error))
      }
    })

    return () => {
      cancelled = true
    }
  }, [session])

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
    instrumentRows,
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

  function openAccountModal(account = null) {
    if (!canEdit) return
    setAccountError('')
    setAccountModal(createAccountModalDraft(account))
  }

  function openInstrumentModal(instrument = null) {
    if (!canEdit) return
    const latestPrice = instrument?.ticker ? latestPriceByTicker.get(instrument.ticker) : null
    const tagId = instrument?.ticker ? tagMapByTicker.get(instrument.ticker)?.id ?? '' : ''
    setInstrumentError('')
    setInstrumentModal(createInstrumentModalDraft({ instrument, latestPrice, tagId }))
  }

  function openHoldingModal({ holding = null, accountId = null, ticker = '' } = {}) {
    if (!canEdit) return
    setHoldingError('')
    setHoldingLookupError('')
    const { draft, lookupResult } = createHoldingModalDraft({
      accountId,
      holding,
      instruments: state.instruments,
      latestPriceByTicker,
      ticker,
    })
    setHoldingLookupResult(lookupResult)
    setHoldingModal(draft)
  }

  function openTagModal(tag = null) {
    if (!canEdit) return
    setTagError('')
    setTagModal(createTagModalDraft({ nextSortOrder: state.tags.length, tag }))
  }

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: authRedirectTo(),
      },
    })
  }

  async function signOut() {
    setGuestUnlockError('')
    setGuestUnlockDraft(createGuestUnlockDraft())
    setViewContext({
      mode: 'owner',
      ownerUserId: null,
      ownerPublicName: '',
    })
    await supabase.auth.signOut()
  }

  async function handleGuestUnlock() {
    setGuestUnlockSaving(true)
    setGuestUnlockError('')

    try {
      let nextSession = session

      if (!nextSession) {
        const { data, error } = await supabase.auth.signInAnonymously()
        if (error) throw error
        nextSession = data.session
        setSession(data.session ?? null)
        setAuthStatus(data.session ? 'signed-in' : 'signed-out')
      }

      if (!nextSession) {
        throw new Error('공유 보기를 시작할 수 없습니다. 로그인 세션을 준비한 뒤 다시 시도해 주세요.')
      }

      const { data, error } = await supabase.rpc('unlock_viewer_access', {
        input_public_name: guestUnlockDraft.public_name,
        input_viewer_password: guestUnlockDraft.viewer_password,
      })

      if (error) throw error

      const access = Array.isArray(data) ? data[0] : data
      setViewContext({
        mode: 'shared',
        ownerUserId: access?.owner_user_id ?? null,
        ownerPublicName: access?.owner_public_name ?? guestUnlockDraft.public_name.trim(),
      })
      await refreshState()
      setGuestUnlockDraft(createGuestUnlockDraft())
    } catch (error) {
      if (error.code === 'anonymous_provider_disabled') {
        setGuestUnlockError(
          '공유 보기에 필요한 익명 로그인 설정이 비활성화되어 있습니다. Supabase Auth의 anonymous sign-ins 설정을 확인해 주세요.',
        )
      } else {
        setGuestUnlockError(formatSupabaseError(error, '공유 보기를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.'))
      }
    } finally {
      setGuestUnlockSaving(false)
    }
  }

  async function handleSaveAccount() {
    if (!canEdit) return
    if (!accountModal) return

    const payload = {
      name: accountModal.name.trim(),
      broker: accountModal.broker.trim() || null,
      note: accountModal.note.trim() || null,
      is_active: true,
    }

    if (!payload.name) {
      setAccountError('계좌 이름을 입력해 주세요.')
      return
    }

    setAccountSaving(true)
    setAccountError('')
    const query = accountModal.id
      ? supabase.from('accounts').update(payload).eq('id', accountModal.id)
      : supabase.from('accounts').insert(payload)
    const { error } = await query
    setAccountSaving(false)

    if (error) {
      setAccountError(error.message)
      return
    }

    await refreshState()
    setAccountModal(null)
  }

  async function handleDeleteAccount() {
    if (!canEdit) return
    if (!accountModal?.id) return

    const holdingCount = holdingsByAccountId.get(accountModal.id)?.length ?? 0
    if (holdingCount > 0) {
      setAccountError('이 계좌에 연결된 보유 항목이 있어 삭제할 수 없습니다. 보유를 먼저 정리해 주세요.')
      return
    }

    setAccountSaving(true)
    setAccountError('')
    const { error } = await supabase.from('accounts').delete().eq('id', accountModal.id)
    setAccountSaving(false)

    if (error) {
      setAccountError(error.message)
      return
    }

    await refreshState()
    setAccountModal(null)
  }

  async function handleSaveInstrument() {
    if (!canEdit) return
    if (!instrumentModal) return
    const linkedAccountId = Number(instrumentModal.linked_account_id)
    const shouldOpenHoldingAfterSave = !instrumentModal.id && Number.isFinite(linkedAccountId) && linkedAccountId > 0

    const tickerValue = instrumentModal.ticker.trim()
    const payload = {
      ticker: tickerValue,
      display_name: instrumentModal.display_name.trim(),
      currency: instrumentModal.currency,
      instrument_type: instrumentModal.instrument_type,
      price_source: 'yfinance',
    }

    if (!payload.ticker || !payload.display_name) {
      setInstrumentError('티커와 종목명을 모두 입력해 주세요.')
      return
    }

    setInstrumentSaving(true)
    setInstrumentError('')
    const query = instrumentModal.id
      ? supabase.from('instruments').update(payload).eq('id', instrumentModal.id)
      : supabase.from('instruments').insert(payload)
    const { error } = await query

    if (error) {
      setInstrumentSaving(false)
      setInstrumentError(error.message)
      return
    }

    const priceValue = Number(instrumentModal.price)
    if (Number.isFinite(priceValue) && priceValue > 0) {
      const { error: priceError } = await supabase
        .from('holding_prices_daily')
        .upsert(
          {
            ticker: tickerValue,
            price_date: instrumentModal.price_date || today(),
            close_price: priceValue,
            source: 'manual',
          },
          { onConflict: 'user_id,ticker,price_date' },
        )
      if (priceError) {
        setInstrumentSaving(false)
        setInstrumentError(priceError.message)
        return
      }
    }

    const { error: deleteTagError } = await supabase
      .from('instrument_tags')
      .delete()
      .eq('ticker', tickerValue)
    if (deleteTagError) {
      setInstrumentSaving(false)
      setInstrumentError(deleteTagError.message)
      return
    }

    const tagId = Number(instrumentModal.tag_id)
    if (Number.isFinite(tagId) && tagId > 0) {
      const { error: tagError } = await supabase.from('instrument_tags').insert({
        ticker: tickerValue,
        tag_id: tagId,
      })
      if (tagError) {
        setInstrumentSaving(false)
        setInstrumentError(tagError.message)
        return
      }
    }

    setInstrumentSaving(false)
    await refreshState()
    setInstrumentModal(null)
    if (shouldOpenHoldingAfterSave) {
      openHoldingModal({ accountId: linkedAccountId, ticker: tickerValue })
    }
  }

  async function handleDeleteInstrument() {
    if (!canEdit) return
    if (!instrumentModal?.id || !instrumentModal?.ticker) return

    const holdingCount = holdingsByTicker.get(instrumentModal.ticker)?.length ?? 0
    if (holdingCount > 0) {
      setInstrumentError('이 종목에 연결된 보유 항목이 있어 삭제할 수 없습니다. 보유를 먼저 정리해 주세요.')
      return
    }

    setInstrumentSaving(true)
    setInstrumentError('')
    const { error: tagError } = await supabase
      .from('instrument_tags')
      .delete()
      .eq('ticker', instrumentModal.ticker)
    if (tagError) {
      setInstrumentSaving(false)
      setInstrumentError(tagError.message)
      return
    }

    const { error: priceError } = await supabase
      .from('holding_prices_daily')
      .delete()
      .eq('ticker', instrumentModal.ticker)
    if (priceError) {
      setInstrumentSaving(false)
      setInstrumentError(priceError.message)
      return
    }

    const { error } = await supabase.from('instruments').delete().eq('id', instrumentModal.id)
    setInstrumentSaving(false)
    if (error) {
      setInstrumentError(error.message)
      return
    }

    await refreshState()
    setInstrumentModal(null)
  }

  async function handleLookupHoldingTicker() {
    if (!canEdit) return
    if (!holdingModal) return

    const ticker = normalizeTickerInput(holdingModal.ticker)
    if (!ticker) {
      setHoldingLookupResult(null)
      setHoldingLookupError('조회할 티커를 먼저 입력해 주세요.')
      return
    }

    const existingInstrument = state.instruments.find((item) => item.ticker === ticker) ?? null
    const existingLatestPrice = latestPriceByTicker.get(ticker)
    if (existingInstrument) {
      setHoldingLookupError('')
      setHoldingLookupResult(
        createHoldingLookupResult({
          instrument: existingInstrument,
          latestPrice: existingLatestPrice,
          ticker,
        }),
      )
      setHoldingModal((current) => (current ? { ...current, ticker } : current))
      return
    }

    setHoldingLookupSaving(true)
    setHoldingLookupError('')
    setHoldingLookupResult(null)

    try {
      const { data, error } = await supabase.functions.invoke('lookup-ticker', {
        body: { ticker },
      })
      if (error) throw error
      if (!data?.ticker) {
        throw new Error('티커 조회 결과가 올바르지 않습니다. 잠시 후 다시 시도해 주세요.')
      }

      await refreshState()
      setHoldingLookupResult(data)
      setHoldingModal((current) => (current ? { ...current, ticker } : current))
    } catch (error) {
      setHoldingLookupError(await formatFunctionInvokeError(error, '티커 조회에 실패했습니다.'))
    } finally {
      setHoldingLookupSaving(false)
    }
  }

  async function handleSaveHolding() {
    if (!canEdit) return
    if (!holdingModal) return

    const normalizedTicker = normalizeTickerInput(holdingModal.ticker)
    const payload = {
      account_id: Number(holdingModal.account_id),
      ticker: normalizedTicker,
      quantity: Number(holdingModal.quantity),
      avg_price: Number(holdingModal.avg_price),
      note: holdingModal.note.trim() || null,
    }

    if (
      !payload.account_id ||
      !payload.ticker ||
      !Number.isFinite(payload.quantity) ||
      !Number.isFinite(payload.avg_price)
    ) {
      setHoldingError('계좌, 티커, 수량, 평균 단가를 모두 입력해 주세요.')
      return
    }

    setHoldingSaving(true)
    setHoldingError('')
    try {
      const existingInstrument = state.instruments.find((item) => item.ticker === normalizedTicker) ?? null
      if (!existingInstrument) {
        if (!holdingLookupResult || holdingLookupResult.ticker !== normalizedTicker) {
          throw new Error('신규 티커는 먼저 조회해서 종목 정보를 확인한 뒤 저장해 주세요.')
        }
        await refreshState()
      }

      const query = holdingModal.id
        ? supabase.from('holdings').update(payload).eq('id', holdingModal.id)
        : supabase.from('holdings').upsert(payload, { onConflict: 'account_id,ticker' })
      const { error } = await query
      if (error) throw error

      await refreshState()
      setHoldingModal(null)
      setHoldingLookupResult(null)
      setHoldingLookupError('')
    } catch (error) {
      setHoldingError(error.message ?? '보유 저장에 실패했습니다.')
    } finally {
      setHoldingSaving(false)
    }
  }

  async function handleDeleteHolding() {
    if (!canEdit) return
    if (!holdingModal?.id) return
    setHoldingSaving(true)
    setHoldingError('')
    const { error } = await supabase.from('holdings').delete().eq('id', holdingModal.id)
    setHoldingSaving(false)

    if (error) {
      setHoldingError(error.message)
      return
    }

    await refreshState()
    setHoldingModal(null)
  }

  async function handleSaveTag() {
    if (!canEdit) return
    if (!tagModal) return

    const payload = {
      name: tagModal.name.trim(),
      color: tagModal.color,
      sort_order: Number(tagModal.sort_order) || 0,
    }
    if (!payload.name) {
      setTagError('태그 이름을 입력해 주세요.')
      return
    }

    setTagSaving(true)
    setTagError('')
    const query = tagModal.id
      ? supabase.from('tags').update(payload).eq('id', tagModal.id)
      : supabase.from('tags').insert(payload)
    const { error } = await query
    setTagSaving(false)
    if (error) {
      setTagError(error.message)
      return
    }

    await refreshState()
    setTagModal(null)
  }

  async function handleSyncPrices() {
    if (!canEdit) return
    setSyncingPrices(true)
    setSyncMessage('')
    try {
      const { error } = await supabase.functions.invoke('sync-prices', { body: {} })
      if (error) throw error
      await refreshState()
      setSyncMessage('가격 동기화가 완료되었습니다.')
    } catch (error) {
      setSyncMessage(error.message ?? '가격 동기화에 실패했습니다.')
    } finally {
      setSyncingPrices(false)
    }
  }

  async function handleSaveViewerProfile() {
    if (!canEdit) return
    setViewerProfileSaving(true)
    setViewerProfileError('')
    setViewerProfileMessage('')

    try {
      const trimmedPublicName = viewerProfileDraft.public_name.trim()
      const trimmedPassword = viewerProfileDraft.viewer_password.trim()

      if (viewerProfileDraft.sharing_enabled && !trimmedPublicName) {
        throw new Error('공유 보기를 활성화하려면 공개 이름을 입력해 주세요.')
      }

      if (trimmedPassword && trimmedPassword.length < 4) {
        throw new Error('비밀번호는 4자 이상이어야 합니다.')
      }

      if (
        viewerProfileDraft.sharing_enabled &&
        !trimmedPassword &&
        !viewerProfile.viewer_password_updated_at
      ) {
        throw new Error('공유 보기를 처음 활성화할 때는 비밀번호를 반드시 입력해 주세요.')
      }

      const payload = {
        user_id: session.user.id,
        public_name: trimmedPublicName || null,
        public_name_normalized: trimmedPublicName ? trimmedPublicName.toLowerCase() : null,
        sharing_enabled: Boolean(viewerProfileDraft.sharing_enabled),
      }

      if (trimmedPassword) {
        payload.viewer_password_hash = await sha256Hex(trimmedPassword)
        payload.viewer_password_updated_at = new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'user_id' })
        .select('public_name, sharing_enabled, viewer_password_updated_at')
        .limit(1)

      if (error) throw error

      const nextProfile = createViewerProfileDraft(Array.isArray(data) ? data[0] : data)
      setViewerProfileSchemaReady(true)
      setViewerProfile(nextProfile)
      setViewerProfileDraft(nextProfile)
      setViewerProfileMessage(
        viewerProfileDraft.viewer_password
          ? '공유 보기 설정이 저장되었습니다. 비밀번호도 함께 업데이트되었습니다.'
          : '공유 보기 설정이 저장되었습니다.',
      )
    } catch (error) {
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
        setViewerProfileError(
          formatSupabaseError(error, '공유 보기 설정을 저장하는 중 데이터베이스 오류가 발생했습니다.'),
        )
      } else {
        setViewerProfileError(error.message ?? '공유 보기 설정을 저장하지 못했습니다.')
      }
    } finally {
      setViewerProfileSaving(false)
    }
  }

  if (authStatus === 'loading') {
    return <CenteredMessageView title="Loading" body="Preparing portfolio data." />
  }

  if (authStatus === 'missing-config') {
    return (
      <CenteredMessageView
        title="Supabase configuration required"
        body="Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
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
        <header className="relative mb-6" ref={menuRef}>
          <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] pb-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
                {viewContext.mode === 'shared' ? 'Shared View' : 'Portfolio'}
              </p>
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold">{pageTitle}</h1>
                {viewContext.mode === 'shared' && (
                  <p className="mt-1 text-sm text-[var(--muted-ink)]">
                    {(viewContext.ownerPublicName || 'Shared') + ' portfolio view'}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                aria-expanded={menuOpen}
                aria-label="Open menu"
                className="inline-flex h-12 w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink)]"
                onClick={() => setMenuOpen((open) => !open)}
                type="button"
              >
                <span className="h-0.5 w-4 rounded-full bg-current" />
                <span className="h-0.5 w-4 rounded-full bg-current" />
                <span className="h-0.5 w-4 rounded-full bg-current" />
              </button>
            </div>
          </div>
          {menuOpen && (
            <nav className="absolute right-0 top-[calc(100%+10px)] z-10 grid min-w-40 gap-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-3)] p-1.5 shadow-2xl shadow-black/40 backdrop-blur">
              {tabs.map((tab) => (
                <button
                  className={`rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                    activeTab === tab.id
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--muted-ink)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'
                  }`}
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id)
                    setMenuOpen(false)
                  }}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
              <button
                className="rounded-xl px-3 py-2.5 text-left text-sm font-medium text-[var(--muted-ink)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                onClick={signOut}
                type="button"
              >
                로그아웃
              </button>
            </nav>
          )}
        </header>

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
            copied={copied}
            holdingsByAccountId={holdingsByAccountId}
            holdingsByTicker={holdingsByTicker}
            instrumentTagFilter={instrumentTagFilter}
            instruments={filteredInstrumentRows}
            onAssetViewChange={setAssetView}
            onCopy={handleCopyMarkdown}
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
