import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGuestUnlockDraft, createViewerProfileDraft } from '../../lib/viewerAccess'
import { createPortfolioActions } from './actions'

function createSupabaseMock() {
  return {
    auth: {
      signOut: vi.fn(async () => ({})),
      signInAnonymously: vi.fn(async () => ({ data: { session: { user: { id: 'anon' } } }, error: null })),
    },
    functions: {
      invoke: vi.fn(async () => ({ data: null, error: null })),
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  }
}

function createParams(overrides = {}) {
  const supabase = overrides.supabase ?? createSupabaseMock()

  return {
    accountModal: null,
    canEdit: true,
    createGuestUnlockDraft,
    createViewerProfileDraft,
    guestUnlockDraft: createGuestUnlockDraft(),
    holdingLookupResult: null,
    holdingModal: null,
    holdingsByAccountId: new Map(),
    holdingsByTicker: new Map(),
    instrumentModal: null,
    latestPriceByTicker: new Map(),
    loadActiveViewerAccess: vi.fn(async () => null),
    refreshState: vi.fn(async () => {}),
    session: { user: { id: 'user-1' } },
    setAccountError: vi.fn(),
    setAccountModal: vi.fn(),
    setAccountSaving: vi.fn(),
    setAuthStatus: vi.fn(),
    setGuestUnlockDraft: vi.fn(),
    setGuestUnlockError: vi.fn(),
    setGuestUnlockSaving: vi.fn(),
    setHoldingError: vi.fn(),
    setHoldingLookupError: vi.fn(),
    setHoldingLookupResult: vi.fn(),
    setHoldingLookupSaving: vi.fn(),
    setHoldingModal: vi.fn(),
    setHoldingSaving: vi.fn(),
    setInstrumentError: vi.fn(),
    setInstrumentModal: vi.fn(),
    setInstrumentSaving: vi.fn(),
    setSession: vi.fn(),
    setSyncMessage: vi.fn(),
    setSyncingPrices: vi.fn(),
    setTagError: vi.fn(),
    setTagModal: vi.fn(),
    setTagSaving: vi.fn(),
    setViewContext: vi.fn(),
    setViewerProfile: vi.fn(),
    setViewerProfileDraft: vi.fn(),
    setViewerProfileError: vi.fn(),
    setViewerProfileMessage: vi.fn(),
    setViewerProfileSaving: vi.fn(),
    setViewerProfileSchemaReady: vi.fn(),
    state: { accounts: [], holdings: [], instruments: [], tags: [] },
    supabase,
    tagMapByTicker: new Map(),
    tagModal: null,
    today: () => '2026-07-12',
    viewerProfile: createViewerProfileDraft(),
    viewerProfileDraft: createViewerProfileDraft(),
    ...overrides,
  }
}

describe('createPortfolioActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('saves an account through the app_save_account RPC', async () => {
    const params = createParams({
      accountModal: { id: null, name: '  ISA  ', broker: '  broker  ', note: '  memo  ' },
    })
    const actions = createPortfolioActions(params)

    await actions.handleSaveAccount()

    expect(params.supabase.rpc).toHaveBeenCalledWith('app_save_account', {
      input_account_id: null,
      input_name: 'ISA',
      input_broker: 'broker',
      input_note: 'memo',
      input_source: 'user',
      input_request: null,
    })
    expect(params.refreshState).toHaveBeenCalledOnce()
    expect(params.setAccountModal).toHaveBeenCalledWith(null)
    expect(params.setAccountSaving.mock.calls.map(([value]) => value)).toEqual([true, false])
  })

  it('does not save an account without a name', async () => {
    const params = createParams({
      accountModal: { id: null, name: ' ', broker: '', note: '' },
    })
    const actions = createPortfolioActions(params)

    await actions.handleSaveAccount()

    expect(params.supabase.rpc).not.toHaveBeenCalled()
    expect(params.setAccountError).toHaveBeenCalledWith(expect.any(String))
  })

  it('saves an instrument with price and tag through the app_save_instrument RPC', async () => {
    const params = createParams({
      instrumentModal: {
        id: 11,
        ticker: ' aapl ',
        display_name: ' Apple ',
        currency: 'USD',
        instrument_type: 'stock',
        price: '210.5',
        price_date: '',
        tag_id: '7',
        note: ' core ',
        linked_account_id: '',
      },
    })
    const actions = createPortfolioActions(params)

    await actions.handleSaveInstrument()

    expect(params.supabase.rpc).toHaveBeenCalledWith('app_save_instrument', {
      input_instrument_id: 11,
      input_ticker: 'AAPL',
      input_display_name: 'Apple',
      input_currency: 'USD',
      input_instrument_type: 'stock',
      input_price: 210.5,
      input_price_date: '2026-07-12',
      input_tag_id: 7,
      input_source: 'user',
      input_request: null,
      input_note: 'core',
    })
    expect(params.refreshState).toHaveBeenCalledOnce()
    expect(params.setInstrumentModal).toHaveBeenCalledWith(null)
  })

  it('saves a holding through the app_save_holding RPC', async () => {
    const params = createParams({
      holdingModal: {
        id: null,
        account_id: '2',
        ticker: ' msft ',
        quantity: '3.5',
        avg_price: '100',
        note: ' long term ',
      },
      state: {
        accounts: [],
        holdings: [],
        instruments: [{ ticker: 'MSFT', display_name: 'Microsoft', currency: 'USD', instrument_type: 'stock' }],
        tags: [],
      },
    })
    const actions = createPortfolioActions(params)

    await actions.handleSaveHolding()

    expect(params.supabase.rpc).toHaveBeenCalledWith('app_save_holding', {
      input_holding_id: null,
      input_account_id: 2,
      input_ticker: 'MSFT',
      input_quantity: 3.5,
      input_avg_price: 100,
      input_note: 'long term',
      input_source: 'user',
      input_request: null,
    })
    expect(params.refreshState).toHaveBeenCalledOnce()
    expect(params.setHoldingModal).toHaveBeenCalledWith(null)
    expect(params.setHoldingLookupResult).toHaveBeenCalledWith(null)
  })

  it('invokes sync-prices and records activity', async () => {
    const params = createParams()
    const actions = createPortfolioActions(params)

    await actions.handleSyncPrices()

    expect(params.supabase.functions.invoke).toHaveBeenCalledWith('sync-prices', { body: {} })
    expect(params.supabase.rpc).toHaveBeenCalledWith('activity_record_user_event', {
      input_action_type: 'sync_prices',
      input_target_table: 'holding_prices_daily',
      input_target_id: null,
      input_before_data: null,
      input_after_data: null,
    })
    expect(params.refreshState).toHaveBeenCalledOnce()
    expect(params.setSyncingPrices.mock.calls.map(([value]) => value)).toEqual([true, false])
  })
})
