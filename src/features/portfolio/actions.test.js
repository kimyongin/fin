import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPortfolioActions } from './actions'

function createSupabaseMock() {
  return {
    functions: {
      invoke: vi.fn(async () => ({
        data: { total_count: 1, synced: [{ ticker: 'AAPL', rows: 1 }], failed: [] },
        error: null,
      })),
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  }
}

function createParams(overrides = {}) {
  const supabase = overrides.supabase ?? createSupabaseMock()

  return {
    accountModal: null,
    canEdit: true,
    holdingsByAccountId: new Map(),
    holdingsByTicker: new Map(),
    instrumentModal: null,
    refreshState: vi.fn(async () => {}),
    setAccountError: vi.fn(),
    setAccountModal: vi.fn(),
    setAccountSaving: vi.fn(),
    setInstrumentError: vi.fn(),
    setInstrumentModal: vi.fn(),
    setInstrumentSaving: vi.fn(),
    setLoadError: vi.fn(),
    setSyncMessage: vi.fn(),
    setSyncingPrices: vi.fn(),
    state: { accounts: [], holdings: [], instruments: [], tags: [] },
    supabase,
    tagMapByTicker: new Map(),
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

  it('closes a saved editor and reports a refresh-only failure without retrying the write', async () => {
    const params = createParams({
      accountModal: { id: null, name: 'ISA', broker: '', note: '' },
      refreshState: vi.fn(async () => { throw new Error('refresh failed') }),
    })
    const actions = createPortfolioActions(params)

    await actions.handleSaveAccount()

    expect(params.supabase.rpc).toHaveBeenCalledOnce()
    expect(params.setAccountModal).toHaveBeenCalledWith(null)
    expect(params.setAccountError).not.toHaveBeenCalledWith('refresh failed')
    expect(params.setLoadError).toHaveBeenCalledWith(expect.stringContaining('변경은 저장됐지만'))
  })

  it('updates an instrument without writing a price', async () => {
    const params = createParams({
      instrumentModal: {
        id: 11,
        ticker: ' aapl ',
        display_name: ' Apple ',
        currency: 'USD',
        instrument_type: 'stock',
        tag_id: '7',
        note: ' core ',
      },
    })
    const actions = createPortfolioActions(params)

    await actions.handleSaveInstrument()

    expect(params.supabase.rpc).toHaveBeenCalledWith('app_save_instrument', {
      input_instrument_id: 11,
      input_ticker: 'AAPL',
      input_display_name: 'Apple',
      input_currency: 'USD',
      input_instrument_type: 'market',
      input_price: null,
      input_price_date: null,
      input_tag_id: 7,
      input_source: 'user',
      input_request: null,
      input_note: 'core',
    })
    expect(params.refreshState).toHaveBeenCalledOnce()
    expect(params.setInstrumentModal).toHaveBeenCalledWith(null)
  })

  it('registers a looked-up instrument without holding or price', async () => {
    const params = createParams({
      instrumentModal: { id: null, ticker: 'AAPL', display_name: 'Apple', currency: 'USD', instrument_type: 'market', tag_id: '', note: '' },
      instrumentLookupResult: { ticker: 'AAPL' },
      onInstrumentSaved: vi.fn(),
    })
    const actions = createPortfolioActions(params)
    await actions.handleSaveInstrument()
    expect(params.supabase.rpc).toHaveBeenCalledWith('app_create_instrument', {
      input_ticker: 'AAPL', input_display_name: 'Apple', input_currency: 'USD',
      input_instrument_type: 'market', input_tag_id: null, input_note: null,
    })
    expect(params.supabase.rpc).toHaveBeenCalledOnce()
    expect(params.onInstrumentSaved).toHaveBeenCalledWith('AAPL')
  })

  it('requires a matching lookup before registering a market instrument', async () => {
    const params = createParams({
      instrumentModal: { id: null, ticker: 'AAPL', display_name: 'Apple', currency: 'USD', instrument_type: 'market', tag_id: '', note: '' },
      instrumentLookupResult: { ticker: 'MSFT' },
    })
    await createPortfolioActions(params).handleSaveInstrument()
    expect(params.supabase.rpc).not.toHaveBeenCalled()
    expect(params.setInstrumentError).toHaveBeenCalledWith(expect.stringContaining('조회'))
  })

  it('invokes sync-prices and refreshes the saved prices', async () => {
    const params = createParams()
    const actions = createPortfolioActions(params)

    await actions.handleSyncPrices()

    expect(params.supabase.functions.invoke).toHaveBeenCalledWith('sync-prices', { body: {} })
    expect(params.supabase.rpc).not.toHaveBeenCalled()
    expect(params.refreshState).toHaveBeenCalledOnce()
    expect(params.setSyncMessage).toHaveBeenCalledWith('1/1개 종목 확인, 새 가격 1건 저장.')
    expect(params.setSyncingPrices.mock.calls.map(([value]) => value)).toEqual([true, false])
  })

  it('does not record a successful activity when every price fails', async () => {
    const params = createParams({
      supabase: {
        ...createSupabaseMock(),
        functions: {
          invoke: vi.fn(async () => ({
            data: {
              total_count: 1,
              synced: [],
              failed: [{ ticker: 'UNKNOWN', error: 'Yahoo response 429' }],
            },
            error: null,
          })),
        },
      },
    })
    const actions = createPortfolioActions(params)

    await actions.handleSyncPrices()

    expect(params.refreshState).not.toHaveBeenCalled()
    expect(params.supabase.rpc).not.toHaveBeenCalled()
    expect(params.setSyncMessage).toHaveBeenCalledWith(expect.stringContaining('가격 동기화 실패'))
  })

})
