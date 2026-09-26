import { expect, test } from '@playwright/test'
import { callRpc, openMenuTab, signInAs } from './helpers'

test('saves one asset detail across accounts atomically and retries after a rejected row', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  const suffix = Date.now().toString(36).slice(-6).toUpperCase()
  const ticker = `DET${suffix}`
  const first = await callRpc(page, 'app_save_account', {
    input_account_id: null, input_broker: null, input_name: `Detail First ${suffix}`,
    input_note: null, input_request: null, input_source: 'user',
  })
  const second = await callRpc(page, 'app_save_account', {
    input_account_id: null, input_broker: null, input_name: `Detail Second ${suffix}`,
    input_note: null, input_request: null, input_source: 'user',
  })
  expect(first.status).toBe(200)
  expect(second.status).toBe(200)
  expect((await callRpc(page, 'app_save_instrument', {
    input_currency: 'USD', input_display_name: `Detail ${suffix}`, input_instrument_id: null,
    input_instrument_type: 'market', input_note: null, input_price: null,
    input_price_date: null, input_price_source: 'manual', input_request: null,
    input_source: 'user', input_tag_id: null, input_ticker: ticker,
  })).status).toBe(200)
  expect((await callRpc(page, 'app_save_holding', {
    input_account_id: first.body[0].account_id, input_avg_price: 8, input_holding_id: null,
    input_quantity: 2, input_request: null, input_source: 'user', input_ticker: ticker,
  })).status).toBe(200)
  const createdTag = await callRpc(page, 'app_save_tag', {
    input_name: `Detail Tag ${suffix}`, input_request: null, input_sort_order: 99,
    input_source: 'user', input_tag_id: null,
  })
  expect(createdTag.status).toBe(200)
  await page.reload()
  await openMenuTab(page, '자산')
  await page.getByRole('button', { name: new RegExp(`Detail ${suffix}`) }).click()
  const editor = page.getByRole('dialog', { name: `Detail ${suffix}` })
  await editor.getByRole('button', { name: `Detail Tag ${suffix}` }).click()
  await expect(editor.getByRole('button', { name: `Detail Tag ${suffix}` })).toHaveAttribute('aria-pressed', 'true')
  await editor.getByLabel('종목명').fill(`Updated ${suffix}`)
  await editor.getByLabel('수량').first().fill('3')
  await editor.getByRole('button', { name: '다른 계좌에 보유 추가' }).click()
  await editor.getByRole('combobox', { name: '계좌', exact: true }).last().selectOption(String(second.body[0].account_id))
  await editor.getByLabel('수량').last().fill('1')
  await editor.getByLabel('평균가').last().fill('9')
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect.poll(() => editor.evaluate((dialog) => {
      const bounds = dialog.getBoundingClientRect()
      return bounds.left >= 0 && bounds.right <= window.innerWidth
    })).toBe(true)
    const deleteButton = await editor.getByRole('button', { name: '보유 삭제' }).boundingBox()
    const accountSelect = await editor.getByRole('combobox', { name: '계좌', exact: true }).first().boundingBox()
    expect(deleteButton.y + deleteButton.height).toBeLessThan(accountSelect.y)
  }

  let rejectOnce = true
  await page.route('**/rest/v1/rpc/app_save_asset_detail_current', async (route) => {
    if (!rejectOnce) return route.continue()
    rejectOnce = false
    const payload = route.request().postDataJSON()
    payload.input_holdings[1].account_id = 999999
    await route.continue({ postData: JSON.stringify(payload) })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  const editorBody = editor.locator(':scope > div').nth(1)
  await editorBody.evaluate((element) => { element.scrollTop = 120 })
  const beforeConfirmScroll = await editorBody.evaluate((element) => element.scrollTop)
  await editor.getByRole('button', { name: '저장', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '보유값 변경 확인' })
  expect(await editor.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true)
  await expect(editor.getByLabel('수량').first()).toHaveValue('3')
  expect(await editorBody.evaluate((element) => element.scrollTop)).toBe(beforeConfirmScroll)
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
    await expect(confirmation).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await confirmation.getByLabel('변경 사유 (선택)').fill('계좌별 현재값 확인')
  await confirmation.getByRole('button', { name: '저장', exact: true }).click()
  await expect(confirmation.getByRole('alert')).toBeVisible()
  const rolledBack = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(rolledBack.body.instruments.find((item) => item.ticker === ticker).display_name).toBe(`Detail ${suffix}`)
  expect(rolledBack.body.holdings.filter((item) => item.ticker === ticker)).toHaveLength(1)
  await confirmation.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('저장되었습니다.')).toBeVisible()
  const saved = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(saved.body.instruments.find((item) => item.ticker === ticker).display_name).toBe(`Updated ${suffix}`)
  expect(saved.body.instrumentTags.find((item) => item.ticker === ticker)?.tags?.id).toBe(createdTag.body[0].tag_id)
  expect(saved.body.holdings.filter((item) => item.ticker === ticker)).toHaveLength(2)
  expect(saved.body.holdings.find((item) => item.ticker === ticker && Number(item.account_id) === Number(first.body[0].account_id)).quantity).toBe(3)
  const updatedEditor = page.getByRole('dialog', { name: `Updated ${suffix}` })
  let rejectDeleteOnce = true
  await page.route('**/rest/v1/rpc/app_delete_holding_checked', async (route) => {
    if (!rejectDeleteOnce) return route.continue()
    rejectDeleteOnce = false
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '시험 삭제 오류' }) })
  })
  await updatedEditor.getByRole('button', { name: '보유 삭제' }).last().click()
  expect(await updatedEditor.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true)
  await expect(page.getByRole('dialog', { name: '보유 삭제' })).toBeVisible()
  await page.getByRole('dialog', { name: '보유 삭제' }).getByRole('button', { name: '보유 삭제' }).click()
  await expect(page.getByRole('dialog', { name: '보유 삭제' }).getByRole('alert')).toContainText('시험 삭제 오류')
  await page.getByRole('dialog', { name: '보유 삭제' }).getByRole('button', { name: '보유 삭제' }).click()
  await expect(page.getByRole('dialog', { name: '보유 삭제' })).toBeHidden()
  await expect(page.getByRole('dialog', { name: `Updated ${suffix}` })).toBeVisible()
  const afterDelete = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(afterDelete.body.holdings.filter((item) => item.ticker === ticker)).toHaveLength(1)
  await page.unroute('**/rest/v1/rpc/app_save_asset_detail_current')
  await page.unroute('**/rest/v1/rpc/app_delete_holding_checked')
})

test('edits only the shared instrument memo in the asset detail', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  const state = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(state.status, JSON.stringify(state.body)).toBe(200)
  const instrument = state.body.instruments.find((item) => item.ticker === 'E2EAPL')
  expect(instrument).toBeTruthy()

  await openMenuTab(page, '자산')
  await page.getByRole('button', { name: /E2E Apple/ }).click()
  const editor = page.getByRole('dialog', { name: 'E2E Apple' })
  await expect(editor.getByLabel('보유 이유 · 나만 보기')).toHaveCount(0)
  await expect(editor.getByLabel('계좌 메모 · 공유 가능')).toHaveCount(0)
  await editor.getByLabel('메모', { exact: true }).fill('장기 서비스 성장성을 보고 보유한다.')
  await editor.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByText('저장되었습니다.')).toBeVisible()
  const publicState = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(publicState.body.instruments.find((item) => item.id === instrument.id).note).toBe('장기 서비스 성장성을 보고 보유한다.')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('edits current holdings in place without a separate verification flow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')
  await page.getByRole('button', { name: /E2E Apple/ }).click()
  const editor = page.getByRole('dialog', { name: 'E2E Apple' })
  await expect(editor.getByRole('button', { name: '매매 기록' })).toHaveCount(0)
  await expect(editor.getByRole('button', { name: '증권사 확인·보정' })).toHaveCount(0)
  await expect(editor.getByLabel('현재가')).toHaveAttribute('readonly', '')
  await expect(editor.getByLabel('기준일')).toHaveAttribute('readonly', '')
  await expect(editor.getByLabel('티커')).toHaveAttribute('readonly', '')
  await editor.getByLabel('수량').first().fill('4')
  await editor.getByLabel('평균가').first().fill('125')
  await editor.getByRole('button', { name: '저장', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '보유값 변경 확인' })
  await expect(confirmation.getByText(/수량:/)).toBeVisible()
  await confirmation.getByLabel('변경 사유 (선택)').fill('증권사 현재값 확인')
  await confirmation.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByText('저장되었습니다.')).toBeVisible()
  const state=await callRpc(page,'app_get_portfolio_state',{input_owner_user_id:null})
  const holding=state.body.holdings.find((item)=>item.ticker==='E2EAPL')
  expect(holding).toMatchObject({quantity:4,avg_price:125})
  await expect(page.getByText(/보유가 아직 미확인/)).toHaveCount(0)
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
    input_price: null,
    input_price_date: null,
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
    input_price: null, input_price_date: null, input_price_source: 'manual', input_request: null, input_source: 'user', input_tag_id: tagId, input_ticker: 'E2ELIFE',
  })
  const instrumentId = instrument.body[0].instrument_id
  const holding = await callRpc(page, 'app_save_holding', {
    input_account_id: accountId, input_avg_price: 100, input_holding_id: null, input_quantity: 1, input_request: null, input_source: 'user', input_ticker: 'E2ELIFE',
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
    input_price: null, input_price_date: null, input_price_source: 'manual', input_request: null, input_source: 'user', input_tag_id: tagId, input_ticker: 'E2ELIFE',
  })
  expect(updatedInstrument.body[0]).toMatchObject({ instrument_id: instrumentId, display_name: 'E2E Lifecycle Instrument Updated' })
  const updatedHolding = await callRpc(page, 'app_save_holding', {
    input_account_id: accountId, input_avg_price: 105, input_holding_id: holdingId, input_quantity: 2, input_request: null, input_source: 'user', input_ticker: 'E2ELIFE',
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
    input_price: null, input_price_date: null, input_price_source: 'manual', input_request: null, input_source: 'user', input_tag_id: tagId, input_ticker: ticker,
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
  expect((await callRpc(ownerPage, 'app_set_profile_avatar', { input_avatar_key: 'fox' })).body).toBe('fox')
  expect((await callRpc(ownerPage, 'app_set_profile_avatar', { input_avatar_key: 'invalid' })).status).toBeGreaterThanOrEqual(400)
  const enabledShare = await callRpc(ownerPage, 'app_save_sharing_profile', {
    input_public_name: 'e2e-owner', input_viewer_password: 'e2e-password',
    input_sharing_enabled: true,
  })
  expect(enabledShare.status).toBe(200)
  const originalPrinciples = await callRpc(ownerPage, 'app_list_principles', {
    input_on: null, input_timezone: 'Asia/Seoul', input_include_ended: false,
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })
  expect(originalPrinciples.status).toBe(200)
  const savedPrinciple = await callRpc(ownerPage, 'app_save_principle', {
    input_principle_id: originalPrinciples.body.items[0]?.principle_id ?? crypto.randomUUID(),
    input_expected_row_id: originalPrinciples.body.items[0]?.id ?? null,
    input_body: 'E2E 공유 원칙', input_change_note: '공유 확인', input_end: false,
  })
  expect(savedPrinciple.status).toBe(200)

  const friendPage = await browser.newPage()
  await signInAs(friendPage, 'e2e-friend@example.com')
  await friendPage.goto('/')

  const addFriend = await callRpc(friendPage, 'add_friend', {
    input_public_name: 'e2e-owner',
    input_viewer_password: 'e2e-password',
  })
  expect(addFriend.status).toBe(200)
  expect((await callRpc(friendPage, 'list_friends')).body).toContainEqual(expect.objectContaining({ owner_public_name: 'e2e-owner', owner_avatar_key: 'fox' }))

  const sharedState = await callRpc(friendPage, 'app_get_portfolio_state', {
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })
  expect(sharedState.body.accounts).toContainEqual(expect.objectContaining({ name: 'E2E Account' }))

  await friendPage.reload()
  await friendPage.getByRole('button', { name: /포트폴리오, 전환하기/ }).click()
  await expect(friendPage.getByRole('group', { name: '포트폴리오 선택' }).getByRole('button', { name: 'e2e-owner' })).toContainText('🦊')
  await friendPage.getByRole('button', { name: /포트폴리오, 전환하기/ }).click()
  const selectPortfolio = async (owner = 'owner') => {
    await friendPage.getByRole('button', { name: /포트폴리오, 전환하기/ }).click()
    await friendPage.getByRole('group', { name: '포트폴리오 선택' }).getByRole('button', { name: owner === 'owner' ? '나' : 'e2e-owner' }).click()
  }
  await selectPortfolio('friend')
  await expect(friendPage.getByTestId('self-profile-badge')).toHaveCount(0)
  const sharedPrimary = friendPage.locator('nav[aria-label="주요 메뉴"]:visible')
  await expect(sharedPrimary.getByRole('button')).toHaveCount(6)
  await expect(sharedPrimary.getByRole('button', { name: '자산', exact: true })).toBeVisible()
  await expect(sharedPrimary.getByRole('button', { name: '배분', exact: true })).toBeVisible()
  await expect(sharedPrimary.getByRole('button', { name: '활동', exact: true })).toBeVisible()
  await expect(sharedPrimary.getByRole('button', { name: '원칙', exact: true })).toBeVisible()
  await sharedPrimary.getByRole('button', { name: '원칙', exact: true }).click()
  await expect(friendPage.getByText('E2E 공유 원칙')).toBeVisible()
  await expect(friendPage.getByRole('button', { name: '수정', exact: true })).toHaveCount(0)
  await expect(friendPage.getByRole('heading', { name: '변경 이력' })).toBeVisible()
  await sharedPrimary.getByRole('button', { name: '배분', exact: true }).click()
  await expect(friendPage.getByRole('button', { name: '태그 관리' })).toHaveCount(0)
  await sharedPrimary.getByRole('button', { name: '활동', exact: true }).click()
  await expect(friendPage.getByRole('button', { name: '태그 관리' })).toHaveCount(0)
  await friendPage.getByRole('textbox', { name: '활동 검색' }).fill('점검')
  await expect(friendPage.getByRole('heading', { name: '검색 결과' })).toBeVisible({ timeout: 20000 })
  await friendPage.getByRole('button', { name: '메뉴 열기' }).click()
  const sharedMenu = friendPage.getByRole('group', { name: '보조 메뉴' })
  await expect(sharedMenu.getByRole('button', { name: '오늘', exact: true })).toHaveCount(0)
  await expect(sharedMenu.getByRole('button', { name: '활동', exact: true })).toHaveCount(0)
  await expect(sharedMenu.getByRole('button', { name: '설정', exact: true })).toHaveCount(0)

  await selectPortfolio()
  await expect(friendPage.getByTestId('self-profile-badge')).toBeVisible()
  await expect(friendPage).toHaveURL(/#tasks$/)
  await expect(friendPage.getByText('E2E Apple')).toHaveCount(0)
  let staleViewSignals = 0
  await friendPage.route('**/rest/v1/rpc/app_mark_shared_portfolio_view', async (route) => {
    staleViewSignals += 1
    await route.continue()
  })
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
  await selectPortfolio('friend')
  await sharedRequestSeen
  await selectPortfolio()
  await expect(friendPage.getByRole('button', { name: '현재 나의 포트폴리오, 전환하기' })).toBeVisible()
  releaseSharedRequest()
  await expect(friendPage.getByText('E2E Apple')).toHaveCount(0)
  expect(staleViewSignals).toBe(0)
  await friendPage.unroute('**/rest/v1/rpc/app_get_portfolio_state')
  await friendPage.unroute('**/rest/v1/rpc/app_mark_shared_portfolio_view')

  await selectPortfolio('friend')
  expect((await callRpc(friendPage, 'app_list_action_timeline', {
    input_cursor: null, input_filter: 'all', input_limit: 20,
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
    input_from: null, input_to: null, input_timezone: 'Asia/Seoul',
  })).body.pending).toBeInstanceOf(Array)

  await selectPortfolio()
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
  await selectPortfolio('friend')
  await sharedPrimary.getByRole('button', { name: '활동', exact: true }).click()
  await timelineReached
  await selectPortfolio()
  releaseTimeline()
  await expect(friendPage.getByRole('heading', { name: '할 일' })).toBeVisible()
  await expect(friendPage.getByText('stale shared error')).toHaveCount(0)
  await friendPage.unroute('**/rest/v1/rpc/app_list_action_timeline')

  expect((await callRpc(ownerPage, 'app_save_sharing_profile', {
    input_public_name: 'e2e-owner', input_viewer_password: '',
    input_sharing_enabled: false,
  })).status).toBe(200)
  expect((await callRpc(friendPage, 'app_list_action_timeline', {
    input_cursor: null, input_filter: 'all', input_limit: 20,
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
    input_from: null, input_to: null, input_timezone: 'Asia/Seoul',
  })).body.pending).toEqual([])
  expect((await callRpc(friendPage, 'app_search_activities', {
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
    input_query: '점검', input_limit: 20,
  })).body.items).toEqual([])

  const outsiderPage = await browser.newPage()
  await signInAs(outsiderPage, 'e2e-outsider@example.com')
  await outsiderPage.goto('/')
  const blockedState = await callRpc(outsiderPage, 'app_get_portfolio_state', {
    input_owner_user_id: '00000000-0000-0000-0000-00000000e201',
  })
  expect(blockedState.body.accounts).toEqual([])
})

test('saves allocation targets, rejects legacy token issuance, and revokes friend access', async ({ browser }) => {
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

  expect((await callRpc(ownerPage, 'agent_create_token', {
    input_name: 'retired', input_token_hash: '0'.repeat(64), input_token_prefix: 'retired',
  })).status).toBe(404)

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
    input_account_id: accountId, input_holding_id: null, input_purchase_amount: 100000, input_request: null, input_source: 'user', input_ticker: valuationTicker, input_valuation_amount: 125000,
  })
  expect(valuation.status, JSON.stringify(valuation.body)).toBe(200)
  expect(valuation.body[0]).toMatchObject({ purchase_amount: 100000, valuation_amount: 125000 })
  const cash = await callRpc(page, 'app_save_cash_holding', {
    input_account_id: accountId, input_balance: 50000, input_holding_id: null, input_request: null, input_source: 'user', input_ticker: cashTicker,
  })
  expect(cash.body[0]).toMatchObject({ valuation_amount: 50000 })

  const bulk = await callRpc(page, 'app_bulk_save_portfolio_rows', {
    input_rows: [{
      account_name: `E2E Bulk ${suffix}`, avg_price: 10, broker: 'E2E', currency: 'USD', display_name: 'E2E Bulk Market', instrument_type: 'market', quantity: 2, ticker: `E2EB${suffix}`,
    }],
  })
  expect(bulk.status).toBe(200)
  expect(bulk.body[0]).toMatchObject({ account_count: 1, holding_count: 1, instrument_count: 1 })
  const activities = await callRpc(page, 'app_list_recent_activity', { limit_count: 20, input_owner_user_id: null })
  expect(activities.body).toContainEqual(expect.objectContaining({ action_type: 'bulk_edit_portfolio', status: 'succeeded' }))
})
