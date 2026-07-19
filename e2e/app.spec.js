import { expect, test } from '@playwright/test'
import { callRpc, signInAs } from './helpers'

test('loads the owner portfolio with a virtual Supabase user session', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')

  const stateRequest = page.waitForResponse((response) =>
    response.url().includes('/rest/v1/rpc/app_get_portfolio_state') && response.status() === 200,
  )
  await page.goto('/')
  const state = await (await stateRequest).json()

  expect(state.accounts).toContainEqual(expect.objectContaining({ name: 'E2E Account' }))
  expect(state.instruments).toContainEqual(expect.objectContaining({ display_name: 'E2E Apple' }))
})

test('starts the Google OAuth authorization redirect without using a Google account', async ({ page }) => {
  let authorizeUrl = ''
  await page.route('**/auth/v1/authorize**', async (route) => {
    authorizeUrl = route.request().url()
    await route.fulfill({ contentType: 'text/html', status: 200, body: '<title>E2E OAuth redirect</title>' })
  })
  await page.goto('/')
  await page.getByRole('button', { name: /Google/ }).click()
  await expect.poll(() => authorizeUrl).toContain('provider=google')
  expect(authorizeUrl).toContain('redirect_to=')
})

test('creates portfolio entities and records the owner activity', async ({ page }) => {
  const suffix = Date.now().toString()
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  const account = await callRpc(page, 'app_save_account', {
    input_account_id: null,
    input_broker: 'E2E Broker',
    input_name: `E2E CRUD Account ${suffix}`,
    input_note: 'Created by Playwright',
    input_request: 'E2E account create',
    input_source: 'user',
  })
  expect(account.status).toBe(200)
  const accountId = account.body[0].account_id

  const tag = await callRpc(page, 'app_save_tag', {
    input_name: `E2E CRUD Tag ${suffix}`,
    input_request: 'E2E tag create',
    input_sort_order: 10,
    input_source: 'user',
    input_tag_id: null,
  })
  expect(tag.status).toBe(200)
  const tagId = tag.body[0].tag_id

  const instrument = await callRpc(page, 'app_save_instrument', {
    input_currency: 'USD',
    input_display_name: `E2E CRUD Instrument ${suffix}`,
    input_instrument_id: null,
    input_instrument_type: 'market',
    input_note: 'Created by Playwright',
    input_price: 200,
    input_price_date: '2026-07-19',
    input_price_source: 'manual',
    input_request: 'E2E instrument create',
    input_source: 'user',
    input_tag_id: tagId,
    input_ticker: `E2E${suffix.slice(-8)}`,
  })
  expect(instrument.status).toBe(200)

  const holding = await callRpc(page, 'app_save_holding', {
    input_account_id: accountId,
    input_avg_price: 150,
    input_holding_id: null,
    input_note: 'Created by Playwright',
    input_quantity: 3,
    input_request: 'E2E holding create',
    input_source: 'user',
    input_ticker: `E2E${suffix.slice(-8)}`,
  })
  expect(holding.status).toBe(200)

  const activity = await callRpc(page, 'activity_list_recent_events', { limit_count: 10 })
  expect(activity.body.map((event) => event.action_type)).toEqual(expect.arrayContaining([
    'create_account',
    'create_holding',
    'create_instrument',
    'create_tag',
  ]))
})

test('edits and deletes portfolio entities while enforcing holding dependencies', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  const account = await callRpc(page, 'app_save_account', {
    input_account_id: null, input_broker: null, input_name: 'E2E Lifecycle Account', input_note: null, input_request: null, input_source: 'user',
  })
  const accountId = account.body[0].account_id
  const tag = await callRpc(page, 'app_save_tag', {
    input_name: 'E2E Lifecycle Tag', input_request: null, input_sort_order: 20, input_source: 'user', input_tag_id: null,
  })
  const tagId = tag.body[0].tag_id
  const instrument = await callRpc(page, 'app_save_instrument', {
    input_currency: 'USD', input_display_name: 'E2E Lifecycle Instrument', input_instrument_id: null, input_instrument_type: 'market', input_note: null,
    input_price: 100, input_price_date: '2026-07-19', input_price_source: 'manual', input_request: null, input_source: 'user', input_tag_id: tagId, input_ticker: 'E2ELIFE',
  })
  const instrumentId = instrument.body[0].instrument_id
  const holding = await callRpc(page, 'app_save_holding', {
    input_account_id: accountId, input_avg_price: 100, input_holding_id: null, input_note: null, input_quantity: 1, input_request: null, input_source: 'user', input_ticker: 'E2ELIFE',
  })
  const holdingId = holding.body[0].holding_id

  const updatedAccount = await callRpc(page, 'app_save_account', {
    input_account_id: accountId, input_broker: 'Updated broker', input_name: 'E2E Lifecycle Account Updated', input_note: 'Updated note', input_request: null, input_source: 'user',
  })
  expect(updatedAccount.body[0]).toMatchObject({ account_id: accountId, name: 'E2E Lifecycle Account Updated' })
  const updatedTag = await callRpc(page, 'app_save_tag', {
    input_name: 'E2E Lifecycle Tag Updated', input_request: null, input_sort_order: 21, input_source: 'user', input_tag_id: tagId,
  })
  expect(updatedTag.body[0]).toMatchObject({ tag_id: tagId, name: 'E2E Lifecycle Tag Updated' })
  const updatedInstrument = await callRpc(page, 'app_save_instrument', {
    input_currency: 'USD', input_display_name: 'E2E Lifecycle Instrument Updated', input_instrument_id: instrumentId, input_instrument_type: 'market', input_note: 'Updated note',
    input_price: 110, input_price_date: '2026-07-19', input_price_source: 'manual', input_request: null, input_source: 'user', input_tag_id: tagId, input_ticker: 'E2ELIFE',
  })
  expect(updatedInstrument.body[0]).toMatchObject({ instrument_id: instrumentId, display_name: 'E2E Lifecycle Instrument Updated' })
  const updatedHolding = await callRpc(page, 'app_save_holding', {
    input_account_id: accountId, input_avg_price: 105, input_holding_id: holdingId, input_note: 'Updated holding', input_quantity: 2, input_request: null, input_source: 'user', input_ticker: 'E2ELIFE',
  })
  expect(updatedHolding.body[0]).toMatchObject({ holding_id: holdingId, quantity: 2 })

  expect((await callRpc(page, 'app_delete_account', { input_account_id: accountId, input_request: null, input_source: 'user' })).status).toBe(400)
  expect((await callRpc(page, 'app_delete_instrument', { input_instrument_id: instrumentId, input_request: null, input_source: 'user' })).status).toBe(400)

  expect((await callRpc(page, 'app_delete_holding', { input_holding_id: holdingId, input_request: null, input_source: 'user' })).status).toBe(200)
  expect((await callRpc(page, 'app_delete_instrument', { input_instrument_id: instrumentId, input_request: null, input_source: 'user' })).status).toBe(200)
  expect((await callRpc(page, 'app_delete_tag', { input_request: null, input_source: 'user', input_tag_id: tagId })).status).toBe(200)
  expect((await callRpc(page, 'app_delete_account', { input_account_id: accountId, input_request: null, input_source: 'user' })).status).toBe(200)
  const lifecycleEvents = await callRpc(page, 'app_list_recent_activity', { input_owner_user_id: null, limit_count: 30 })
  expect(lifecycleEvents.body.map((event) => event.action_type)).toEqual(expect.arrayContaining([
    'update_account', 'update_holding', 'update_instrument', 'update_tag', 'delete_account', 'delete_holding', 'delete_instrument', 'delete_tag',
  ]))
})

test('deleting a tag unlinks it from its instrument without deleting the instrument', async ({ page }) => {
  const suffix = Date.now().toString().slice(-8)
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  const tag = await callRpc(page, 'app_save_tag', {
    input_name: `E2E Unlink ${suffix}`, input_request: null, input_sort_order: 99, input_source: 'user', input_tag_id: null,
  })
  const tagId = tag.body[0].tag_id
  const ticker = `E2EU${suffix}`
  const instrument = await callRpc(page, 'app_save_instrument', {
    input_currency: 'USD', input_display_name: 'E2E Unlinked Instrument', input_instrument_id: null, input_instrument_type: 'market', input_note: null,
    input_price: 1, input_price_date: '2026-07-19', input_price_source: 'manual', input_request: null, input_source: 'user', input_tag_id: tagId, input_ticker: ticker,
  })
  expect(instrument.status).toBe(200)
  expect((await callRpc(page, 'app_delete_tag', { input_request: null, input_source: 'user', input_tag_id: tagId })).status).toBe(200)
  const state = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(state.body.instruments).toContainEqual(expect.objectContaining({ ticker }))
  expect(state.body.instrumentTags).not.toContainEqual(expect.objectContaining({ ticker }))
})

test('adds a friend and grants only that user shared portfolio access', async ({ browser }) => {
  const friendPage = await browser.newPage()
  await signInAs(friendPage, 'e2e-friend@example.com')
  await friendPage.goto('/')

  const addFriend = await callRpc(friendPage, 'add_friend', {
    input_public_name: 'e2e-owner',
    input_viewer_password: 'e2e-password',
  })
  expect(addFriend.status).toBe(200)

  const sharedState = await callRpc(friendPage, 'app_get_portfolio_state', {
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })
  expect(sharedState.body.accounts).toContainEqual(expect.objectContaining({ name: 'E2E Account' }))

  const outsiderPage = await browser.newPage()
  await signInAs(outsiderPage, 'e2e-outsider@example.com')
  await outsiderPage.goto('/')
  const blockedState = await callRpc(outsiderPage, 'app_get_portfolio_state', {
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })
  expect(blockedState.body.accounts).toEqual([])
})

test('saves a strategy, manages an agent token, and revokes friend access', async ({ browser }) => {
  const ownerPage = await browser.newPage()
  await signInAs(ownerPage, 'e2e-owner@example.com')
  await ownerPage.goto('/')

  const strategy = await callRpc(ownerPage, 'app_save_strategy', {
    input_buckets: [{ name: 'E2E Bucket', sort_order: 0, tag_ids: [1], target_percentage: 100 }],
    input_drift_threshold: 5,
    input_monthly_contribution: 100000,
    input_name: 'E2E Strategy',
    input_review_day: 1,
  })
  expect(strategy.status).toBe(200)
  expect(strategy.body.strategy).toMatchObject({ name: 'E2E Strategy' })
  const strategyState = await callRpc(ownerPage, 'app_get_strategy_state', { input_owner_user_id: null })
  expect(strategyState.body.strategy).toMatchObject({ name: 'E2E Strategy', review_day: 1 })

  const tokenHash = Date.now().toString(16).padStart(64, '0')
  const token = await callRpc(ownerPage, 'agent_create_token', {
    input_name: 'E2E Agent', input_token_hash: tokenHash, input_token_prefix: 'e2e_',
  })
  expect(token.status).toBe(200)
  expect((await callRpc(ownerPage, 'mcp_get_portfolio_state', { input_token_hash: tokenHash })).status).toBe(200)
  expect((await callRpc(ownerPage, 'agent_revoke_token', { input_token_id: token.body[0].id })).body[0].revoked_at).toBeTruthy()
  expect((await callRpc(ownerPage, 'mcp_get_portfolio_state', { input_token_hash: tokenHash })).status).toBe(400)

  const friendPage = await browser.newPage()
  await signInAs(friendPage, 'e2e-friend@example.com')
  await friendPage.goto('/')
  expect((await callRpc(friendPage, 'remove_friend', {
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })).status).toBe(200)
  const revokedState = await callRpc(friendPage, 'app_get_portfolio_state', {
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })
  expect(revokedState.body.accounts).toEqual([])
})

test('saves valuation and cash holdings, then bulk imports market rows', async ({ page }) => {
  const suffix = Date.now().toString().slice(-8)
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  const account = await callRpc(page, 'app_save_account', {
    input_account_id: null, input_broker: 'E2E', input_name: `E2E Nonmarket ${suffix}`, input_note: null, input_request: null, input_source: 'user',
  })
  const accountId = account.body[0].account_id
  const valuationTicker = `VALUATION:E2E${suffix}`
  const cashTicker = `CASH:E2E${suffix}`
  for (const instrument of [
    { ticker: valuationTicker, displayName: 'E2E Valuation', type: 'valuation' },
    { ticker: cashTicker, displayName: 'E2E Cash', type: 'cash' },
  ]) {
    const saved = await callRpc(page, 'app_save_instrument', {
      input_currency: 'KRW', input_display_name: instrument.displayName, input_instrument_id: null, input_instrument_type: instrument.type,
      input_note: null, input_price: null, input_price_date: null, input_price_source: 'manual', input_request: null, input_source: 'user', input_tag_id: null, input_ticker: instrument.ticker,
    })
    expect(saved.status).toBe(200)
  }

  const valuation = await callRpc(page, 'app_save_valuation_holding', {
    input_account_id: accountId, input_holding_id: null, input_note: 'E2E valuation', input_purchase_amount: 100000, input_request: null, input_source: 'user', input_ticker: valuationTicker, input_valuation_amount: 125000,
  })
  expect(valuation.status, JSON.stringify(valuation.body)).toBe(200)
  expect(valuation.body[0]).toMatchObject({ purchase_amount: 100000, valuation_amount: 125000 })
  const cash = await callRpc(page, 'app_save_cash_holding', {
    input_account_id: accountId, input_balance: 50000, input_holding_id: null, input_note: 'E2E cash', input_request: null, input_source: 'user', input_ticker: cashTicker,
  })
  expect(cash.body[0]).toMatchObject({ valuation_amount: 50000 })

  const bulk = await callRpc(page, 'app_bulk_save_portfolio_rows', {
    input_rows: [{
      account_name: `E2E Bulk ${suffix}`, avg_price: 10, broker: 'E2E', currency: 'USD', display_name: 'E2E Bulk Market', instrument_type: 'market', note: 'Bulk imported', quantity: 2, ticker: `E2EB${suffix}`,
    }],
  })
  expect(bulk.status).toBe(200)
  expect(bulk.body[0]).toMatchObject({ account_count: 1, holding_count: 1, instrument_count: 1 })
  const activities = await callRpc(page, 'app_list_recent_activity', { limit_count: 20, input_owner_user_id: null })
  expect(activities.body).toContainEqual(expect.objectContaining({ action_type: 'bulk_edit_portfolio', status: 'succeeded' }))
})

test('navigates the authenticated browser through strategy, activity, and settings pages', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  async function openTab(index, title) {
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.locator('nav button').nth(index).click()
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  }

  await openTab(1, 'Strategy')
  await openTab(2, 'Activity')
  await openTab(3, 'Settings')
})

test('displays strategy contribution allocation and rebalancing guidance', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await callRpc(page, 'app_save_strategy', {
    input_buckets: [{ name: 'E2E Allocation Bucket', sort_order: 0, tag_ids: [1], target_percentage: 100 }],
    input_drift_threshold: 1, input_monthly_contribution: 100000, input_name: 'E2E Display Strategy', input_review_day: 1,
  })
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.locator('nav button').nth(1).click()
  await expect(page.getByText('E2E Display Strategy')).toBeVisible()
  await expect(page.getByText('E2E Allocation Bucket').first()).toBeVisible()
})

test('handles mocked price-sync Edge Function success and failure in the settings UI', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.locator('nav button').nth(3).click()

  let calls = 0
  await page.route('**/functions/v1/sync-prices', async (route) => {
    calls += 1
    await route.fulfill(calls === 1
      ? { contentType: 'application/json', status: 200, body: '{}' }
      : { contentType: 'application/json', status: 500, body: JSON.stringify({ message: 'E2E sync failure' }) })
  })
  const button = page.getByRole('button', { name: '가격 동기화' })
  await button.click()
  await expect.poll(() => calls).toBe(1)
  await button.click()
  await expect.poll(() => calls).toBe(2)
})

test('handles mocked ticker-lookup Edge Function success and failure in the holding editor', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await page.getByRole('tab').nth(2).click()
  await page.getByRole('button', { name: '보유 추가' }).first().click()
  const tickerInput = page.locator('input[placeholder*="AAPL"]')
  let calls = 0
  await page.route('**/functions/v1/lookup-ticker', async (route) => {
    calls += 1
    await route.fulfill(calls === 1
      ? { contentType: 'application/json', status: 200, body: JSON.stringify({ ticker: 'E2ELOOKUP', display_name: 'E2E Lookup', currency: 'USD', instrument_type: 'market' }) }
      : { contentType: 'application/json', status: 500, body: JSON.stringify({ message: 'E2E lookup failure' }) })
  })
  await tickerInput.fill('E2ELOOKUP')
  const lookup = page.getByRole('button', { name: '조회' })
  await lookup.click()
  await expect.poll(() => calls).toBe(1)
  await tickerInput.fill('E2EFAIL')
  await lookup.click()
  await expect.poll(() => calls).toBe(2)
})

test('copies the visible portfolio as CSV from the browser header', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await page.getByRole('button', { name: 'CSV 복사' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('티커')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('E2EAPL')
})

test('renders saved data in every asset view', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  const tabs = page.getByRole('tab')
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  await tabs.nth(1).click()
  await expect(page.getByText('E2E Account')).toBeVisible()
  await tabs.nth(2).click()
  await expect(page.getByText('E2E Apple')).toBeVisible()
  await tabs.nth(3).click()
  await expect(page.locator('input[value="E2E Apple"]')).toBeVisible()
})

test('unlocks a seeded shared portfolio through Supabase', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: '공유 보기' }).click()
  await page.locator('input').nth(0).fill('e2e-owner')
  await page.locator('input[type="password"]').fill('e2e-password')
  const stateRequest = page.waitForResponse((response) =>
    response.url().includes('/rest/v1/rpc/app_get_portfolio_state') && response.status() === 200,
  )
  await page.getByRole('button', { name: '공유 포트폴리오 보기' }).click()
  const state = await (await stateRequest).json()

  expect(state.accounts).toContainEqual(expect.objectContaining({ name: 'E2E Account' }))
  expect(state.instruments).toContainEqual(expect.objectContaining({ display_name: 'E2E Apple' }))
  await expect(page.getByText('e2e-owner', { exact: false })).toBeVisible()
})

test('rejects an invalid password for the shared portfolio', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '공유 보기' }).click()
  await page.locator('input').nth(0).fill('e2e-owner')
  await page.locator('input[type="password"]').fill('wrong-password')
  const rejected = page.waitForResponse((response) =>
    response.url().includes('/rest/v1/rpc/unlock_viewer_access') && response.status() === 400,
  )
  await page.getByRole('button', { name: '공유 포트폴리오 보기' }).click()
  await rejected
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})
