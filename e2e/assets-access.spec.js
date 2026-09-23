import { expect, test } from '@playwright/test'
import { callRpc, openMenuTab, signInAs } from './helpers'

test('saves a private holding reason without exposing it in the shared portfolio DTO', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  const state = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(state.status, JSON.stringify(state.body)).toBe(200)
  const instrument = state.body.instruments.find((item) => item.ticker === 'E2EAPL')
  expect(instrument).toBeTruthy()

  await openMenuTab(page, '자산')
  await page.getByRole('button', { name: /E2E Apple/ }).click()
  await page.getByRole('dialog', { name: 'E2E Apple' }).getByRole('button', { name: '보유 메모' }).click()
  const editor = page.getByRole('dialog', { name: 'E2E Apple 보유 메모' })
  await editor.getByLabel('보유 이유·다음 확인 조건').fill('장기 서비스 성장성을 보고 보유한다.')
  await editor.getByRole('button', { name: '메모 저장' }).click()

  await page.getByRole('button', { name: /E2E Apple/ }).click()
  await expect(page.getByRole('dialog', { name: 'E2E Apple' }).getByText('장기 서비스 성장성을 보고 보유한다.')).toBeVisible()
  const notes = await callRpc(page, 'app_list_private_holding_notes')
  expect(notes.status, JSON.stringify(notes.body)).toBe(200)
  expect(notes.body.items).toContainEqual(expect.objectContaining({
    instrument_id: instrument.id, account_id: null, note: '장기 서비스 성장성을 보고 보유한다.',
  }))
  const publicState = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(JSON.stringify(publicState.body)).not.toContain('장기 서비스 성장성을 보고 보유한다.')

  const context = await callRpc(page, 'app_get_daily_context', {
    input_subject_tickers: null,
    input_timezone: 'Asia/Seoul',
  })
  expect(context.status, JSON.stringify(context.body)).toBe(200)
  expect(context.body.private_holding_notes).toContainEqual(expect.objectContaining({
    instrument_id: instrument.id,
    note: '장기 서비스 성장성을 보고 보유한다.',
  }))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('previews and records a completed trade on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')
  await page.getByRole('button', { name: /E2E Apple/ }).click()
  let tradeButton = page.getByRole('dialog', { name: 'E2E Apple' }).getByRole('button', { name: '매매 기록' })
  await tradeButton.click()
  const tradeDialog = page.getByRole('dialog', { name: 'E2E Apple 매매 기록' })
  await expect(tradeDialog).toBeVisible()
  await expect.poll(() => tradeDialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true)
  await expect.poll(() => page.locator('[inert]').count()).toBeGreaterThan(0)
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect.poll(() => tradeDialog.evaluate((dialog) => {
      const bounds = dialog.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= window.innerWidth
    })).toBe(true)
  }
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => tradeDialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(tradeDialog).toBeHidden()
  await page.getByRole('button', { name: /E2E Apple/ }).click()
  tradeButton = page.getByRole('dialog', { name: 'E2E Apple' }).getByRole('button', { name: '매매 기록' })
  await tradeButton.click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('체결 수량').fill('1')
  await page.getByLabel(/체결 단가/).fill('200')
  await page.getByRole('button', { name: '변경 미리보기' }).click()
  await expect(page.getByText('2 → 3')).toBeVisible()
  let dropFirstConfirmationResponse = true
  await page.route('**/rest/v1/rpc/app_record_completed_trade', async (route) => {
    if (!dropFirstConfirmationResponse) return route.continue()
    dropFirstConfirmationResponse = false
    await route.fetch()
    await route.abort('connectionreset')
  })
  await page.getByRole('button', { name: '체결 기록 확정' }).click()
  await expect(page.getByText(/같은 요청으로 다시 시도/)).toBeVisible()
  await page.getByRole('button', { name: '체결 기록 확정' }).click()
  await expect(page.getByRole('heading', { name: 'E2E Apple 매매 기록' })).toBeHidden()
  await page.unroute('**/rest/v1/rpc/app_record_completed_trade')

  const transactions = await callRpc(page, 'app_list_transactions', { input_limit: 10, input_before: null })
  expect(transactions.status, JSON.stringify(transactions.body)).toBe(200)
  expect(transactions.body.filter((item) => item.ticker === 'E2EAPL' && item.side === 'buy' && Number(item.quantity) === 1)).toHaveLength(1)
  const state = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(state.body.holdings.find((item) => item.ticker === 'E2EAPL')).toMatchObject({ quantity: 3 })

  await page.getByRole('button', { name: /E2E Apple/ }).click()
  await page.getByRole('dialog', { name: 'E2E Apple' }).getByRole('button', { name: '매매 기록' }).click()
  await expect(page.getByRole('button', { name: '기록 취소' })).toHaveCount(0)
  await expect(page.getByText(/증권사에서 확인한 현재 수량·평균가로 보정/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('reconciles and verifies one holding without broadening the checked fields', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')
  await page.getByRole('button', { name: /E2E Apple/ }).click()
  await page.getByRole('dialog', { name: 'E2E Apple' }).getByRole('button',{name:'잔고 맞추기'}).click()
  await page.getByRole('textbox',{name:'수량'}).fill('4')
  await page.getByRole('textbox',{name:'평균가'}).fill('125')
  await page.getByRole('checkbox',{name:'수량'}).check()
  await page.getByLabel('보정 이유').fill('증권사 수량과 평균가로 현재값을 맞춥니다.')
  await page.getByRole('button',{name:'보정 미리보기'}).click()
  await expect(page.getByText(/수량: .* → 4/)).toBeVisible()
  await page.getByRole('button',{name:'보정 확정'}).click()
  await expect(page.getByRole('heading',{name:'E2E Apple 잔고 맞추기'})).toBeHidden()
  const state=await callRpc(page,'app_get_portfolio_state',{input_owner_user_id:null})
  const holding=state.body.holdings.find((item)=>item.ticker==='E2EAPL')
  expect(holding).toMatchObject({quantity:4,avg_price:125})
  const integrity=await callRpc(page,'app_get_holding_integrity',{input_holding_id:holding.id})
  expect(integrity.body.last_verification.verified_fields).toEqual(['quantity'])
  expect(integrity.body.last_verification.changed_since).toBe(false)
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
  const ownerPage = await browser.newPage()
  await signInAs(ownerPage, 'e2e-owner@example.com')
  await ownerPage.goto('/')
  const initialPolicy = await callRpc(ownerPage, 'app_get_sharing_policy')
  const enabledPolicy = await callRpc(ownerPage, 'app_update_sharing_policy', {
    input_expected_version: initialPolicy.body.version,
    input_grants: { briefings: true, decisions: true, tasks: true },
  })
  expect(enabledPolicy.status).toBe(200)

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

  await friendPage.reload()
  await friendPage.getByLabel('포트폴리오 전환').selectOption('00000000-0000-0000-0000-00000000e201')
  const sharedPrimary = friendPage.locator('nav[aria-label="주요 메뉴"]:visible')
  await expect(sharedPrimary.getByRole('button')).toHaveCount(4)
  await expect(sharedPrimary.getByRole('button', { name: '자산', exact: true })).toBeVisible()
  await expect(sharedPrimary.getByRole('button', { name: '배분', exact: true })).toBeVisible()
  await expect(sharedPrimary.getByRole('button', { name: '활동', exact: true })).toBeVisible()
  await expect(sharedPrimary.getByRole('button', { name: '원칙', exact: true })).toBeVisible()
  await sharedPrimary.getByRole('button', { name: '활동', exact: true }).click()
  await friendPage.getByText('상세 필터').click()
  await friendPage.getByRole('button', { name: '점검', exact: true }).click()
  await friendPage.getByRole('button', { name: '검색', exact: true }).click()
  await expect(friendPage.getByRole('heading', { name: '검색 결과' })).toBeVisible()
  await friendPage.getByRole('button', { name: 'Open menu' }).click()
  const sharedMenu = friendPage.locator('nav[aria-label="보조 메뉴"]')
  await expect(sharedMenu.getByRole('button', { name: '오늘', exact: true })).toHaveCount(0)
  await expect(sharedMenu.getByRole('button', { name: '활동', exact: true })).toHaveCount(0)
  await expect(sharedMenu.getByRole('button', { name: '설정', exact: true })).toHaveCount(0)

  await friendPage.getByLabel('포트폴리오 전환').selectOption('owner')
  await expect(friendPage.getByText('E2E Apple')).toHaveCount(0)
  let releaseSharedRequest
  let markSharedRequest
  const sharedRequestSeen = new Promise((resolve) => { markSharedRequest = resolve })
  const releaseSharedResponse = new Promise((resolve) => { releaseSharedRequest = resolve })
  await friendPage.route('**/rest/v1/rpc/app_get_portfolio_state', async (route) => {
    if (route.request().postDataJSON()?.input_owner_user_id === '00000000-0000-0000-0000-00000000e201') {
      markSharedRequest()
      await releaseSharedResponse
    }
    await route.continue()
  })
  await friendPage.getByLabel('포트폴리오 전환').selectOption('00000000-0000-0000-0000-00000000e201')
  await sharedRequestSeen
  await friendPage.getByLabel('포트폴리오 전환').selectOption('owner')
  await expect(friendPage.getByLabel('포트폴리오 전환')).toHaveValue('owner')
  releaseSharedRequest()
  await expect(friendPage.getByText('E2E Apple')).toHaveCount(0)
  await friendPage.unroute('**/rest/v1/rpc/app_get_portfolio_state')

  await friendPage.getByLabel('포트폴리오 전환').selectOption('00000000-0000-0000-0000-00000000e201')
  expect((await callRpc(friendPage, 'app_list_action_timeline', {
    input_cursor: null, input_filter: 'all', input_limit: 20,
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
    input_from: null, input_to: null, input_timezone: 'Asia/Seoul',
  })).body.pending).toBeInstanceOf(Array)

  await friendPage.getByLabel('포트폴리오 전환').selectOption('owner')
  let releaseTimeline
  const heldTimeline = new Promise((resolve) => { releaseTimeline = resolve })
  let sawTimeline
  const timelineReached = new Promise((resolve) => { sawTimeline = resolve })
  await friendPage.route('**/rest/v1/rpc/app_list_action_timeline', async (route) => {
    if (route.request().postDataJSON()?.input_owner_user_id !== '00000000-0000-0000-0000-00000000e201') return route.continue()
    sawTimeline()
    await heldTimeline
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'stale shared error' }) })
  })
  await friendPage.getByLabel('포트폴리오 전환').selectOption('00000000-0000-0000-0000-00000000e201')
  await sharedPrimary.getByRole('button', { name: '활동', exact: true }).click()
  await timelineReached
  await friendPage.getByLabel('포트폴리오 전환').selectOption('owner')
  releaseTimeline()
  await expect(friendPage.getByRole('heading', { name: '할 일' })).toBeVisible()
  await expect(friendPage.getByText('stale shared error')).toHaveCount(0)
  await friendPage.unroute('**/rest/v1/rpc/app_list_action_timeline')

  expect((await callRpc(ownerPage, 'app_update_sharing_policy', {
    input_expected_version: enabledPolicy.body.version,
    input_grants: { briefings: false, decisions: false, tasks: false },
  })).status).toBe(200)
  expect((await callRpc(friendPage, 'app_list_action_timeline', {
    input_cursor: null, input_filter: 'all', input_limit: 20,
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
    input_from: null, input_to: null, input_timezone: 'Asia/Seoul',
  })).body.pending).toEqual([])
  expect((await callRpc(friendPage, 'app_list_narrative_activities', {
    input_cursor: null, input_kind: 'decision', input_limit: 20,
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })).body.items).toEqual([])

  const outsiderPage = await browser.newPage()
  await signInAs(outsiderPage, 'e2e-outsider@example.com')
  await outsiderPage.goto('/')
  const blockedState = await callRpc(outsiderPage, 'app_get_portfolio_state', {
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })
  expect(blockedState.body.accounts).toEqual([])
})

test('saves allocation targets, manages an agent token, and revokes friend access', async ({ browser }) => {
  const ownerPage = await browser.newPage()
  await signInAs(ownerPage, 'e2e-owner@example.com')
  await ownerPage.goto('/')

  const portfolioState = await callRpc(ownerPage, 'app_get_portfolio_state', { input_owner_user_id: null })
  const currentTargets = await callRpc(ownerPage, 'app_get_strategy_state', { input_owner_user_id: null })
  const strategy = await callRpc(ownerPage, 'app_save_allocation_targets', {
    input_targets: [{ tag_id: portfolioState.body.tags[0].id, target_percentage: 100 }],
    input_expected_targets: currentTargets.body.targets.map(({ tag_id, target_percentage }) => ({ tag_id, target_percentage })),
  })
  expect(strategy.status).toBe(200)
  expect(strategy.body.configured).toBe(true)
  const strategyState = await callRpc(ownerPage, 'app_get_strategy_state', { input_owner_user_id: null })
  expect(strategyState.body.targets[0]).toMatchObject({ target_percentage: 100 })

  const tokenHash = Date.now().toString(16).padStart(64, '0')
  const token = await callRpc(ownerPage, 'agent_create_token', {
    input_name: 'E2E Agent', input_token_hash: tokenHash, input_token_prefix: 'e2e_',
  })
  expect(token.status).toBe(200)
  expect((await callRpc(ownerPage, 'mcp_get_portfolio_state', { input_token_hash: tokenHash })).status).toBe(200)
  const tokenTargets = await callRpc(ownerPage, 'mcp_get_strategy_state', { input_token_hash: tokenHash })
  expect(tokenTargets.body.targets[0]).toMatchObject({ tag_id: portfolioState.body.tags[0].id, target_percentage: 100 })
  expect((await callRpc(ownerPage, 'mcp_save_strategy', {
    input_token_hash: tokenHash,
    input_targets: [{ tag_id: portfolioState.body.tags[0].id, target_percentage: 100 }],
    input_expected_targets: [{ tag_id: portfolioState.body.tags[0].id, target_percentage: 100 }],
  })).status).toBe(200)
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
