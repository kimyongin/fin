import { expect, test } from '@playwright/test'
import { callRpc, signInAs } from './helpers'

async function openMenuTab(page, label) {
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.locator('nav').getByRole('button', { name: label, exact: true }).click()
}

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

test('shows the latest saved daily review first on a mobile-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  const context = await callRpc(page, 'app_create_daily_context', {
    input_subject_tickers: null,
    input_timezone: 'Asia/Seoul',
  })
  expect(context.status, JSON.stringify(context.body)).toBe(200)

  const now = new Date()
  const headline = `E2E 오늘의 결론 ${Date.now()}`
  const saved = await callRpc(page, 'app_save_daily_briefing', {
    input_context_id: context.body.context_id,
    input_idempotency_key: crypto.randomUUID(),
    input_payload: {
      status: 'attention',
      headline,
      changes: [{ summary: '확인이 필요한 변화입니다.' }],
      uncertainties: [{ summary: '외부 조사는 테스트에서 생략했습니다.' }],
      evidence: [],
      scopes: [{
        scope_key: 'portfolio-review',
        subject_kind: 'portfolio',
        window_from: new Date(now.getTime() - 86400000).toISOString(),
        window_to: now.toISOString(),
        coverage: 'unverified',
        reason: 'E2E 화면 검증은 외부 조사를 수행하지 않습니다.',
        checked_at: now.toISOString(),
        evidence_keys: [],
        checked_sources: [],
      }],
    },
  })
  expect(saved.status, JSON.stringify(saved.body)).toBe(200)

  await page.reload()
  await expect(page).toHaveURL(/#today$/)
  await expect(page.getByText(headline).first()).toBeVisible()
  await expect(page.getByText('자료 부족').first()).toBeVisible()
  await page.getByRole('button', { name: '전체 브리핑 보기' }).click()
  await expect(page.getByRole('heading', { name: '저장된 점검 상세' })).toBeVisible()
  await expect(page.getByText('확인이 필요한 변화입니다.')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('shows an adopted decision and its research follow-up without implying a trade', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  const suffix = Date.now()
  const question = `E2E 보유 판단 ${suffix}`
  const taskTitle = `E2E 다음 실적 확인 ${suffix}`
  const recorded = await callRpc(page, 'app_record_investment_decision', {
    input_idempotency_key: crypto.randomUUID(),
    input_payload: {
      status: 'proposed',
      subject: { kind: 'instrument', instrument_id: 'E2EAPL', label: 'E2E Apple' },
      question,
      options: ['유지', '축소 검토'],
      review_condition: '다음 분기 실적 발표',
      timezone: 'Asia/Seoul',
      authored_via: 'app',
      follow_up_tasks: [{
        title: taskTitle,
        subject: { kind: 'instrument', instrument_id: 'E2EAPL', label: 'E2E Apple' },
        trigger_text: '다음 분기 실적 발표',
      }],
    },
  })
  expect(recorded.status, JSON.stringify(recorded.body)).toBe(200)
  expect(recorded.body.tasks).toHaveLength(1)

  const adopted = await callRpc(page, 'app_transition_investment_decision', {
    input_decision_id: recorded.body.id,
    input_expected_version: 1,
    input_idempotency_key: crypto.randomUUID(),
    input_payload: {
      action: 'adopt',
      selected_option: '유지',
      reason: '다음 실적에서 핵심 가설을 다시 확인합니다.',
      authored_via: 'app',
    },
  })
  expect(adopted.status, JSON.stringify(adopted.body)).toBe(200)

  const resolvedAnswer = '공식 실적에서 확인할 지표가 기준을 충족했습니다.'
  const resolved = await callRpc(page, 'app_transition_portfolio_task', {
    input_task_id: recorded.body.tasks[0].id,
    input_expected_version: 1,
    input_idempotency_key: crypto.randomUUID(),
    input_payload: {
      action: 'resolve',
      answer: resolvedAnswer,
      reason: '공식 실적 발표 확인',
      authored_via: 'app',
      evidence: [{
        title: 'E2E official earnings release',
        source_url: 'https://example.com/e2e-earnings',
        summary: 'E2E 상태 전이 검증용 공식 자료입니다.',
        checked_at: new Date().toISOString(),
      }],
    },
  })
  expect(resolved.status, JSON.stringify(resolved.body)).toBe(200)

  await openMenuTab(page, '판단')
  await expect(page.getByText(question)).toBeVisible()
  await expect(page.getByText('내가 채택함').first()).toBeVisible()
  await page.getByText(question).click()
  await expect(page.getByText(taskTitle)).toBeVisible()
  await page.getByRole('button', { name: '닫기' }).click()

  await openMenuTab(page, '할 일')
  await expect(page.getByText(taskTitle)).toBeVisible()
  await expect(page.getByText('답을 확인함').first()).toBeVisible()
  await page.getByText(taskTitle).click()
  await expect(page.getByText(resolvedAnswer)).toBeVisible()
  await expect(page.getByText('E2E official earnings release')).toBeVisible()
  await expect(page.getByText('매매 주문이나 체결 기록이 아닙니다.')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('saves a private investment policy and includes its version in daily context', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '원칙')

  await page.getByRole('button', { name: '기준 추가' }).click()
  await page.getByLabel('한 줄로 적는 기본 원칙').fill('장기 투자하고 자주 매매하지 않는다.')
  await page.getByLabel('투자 목적').fill('은퇴 자산을 장기적으로 늘린다.')
  await page.getByLabel('투자 기간').fill('10년 이상')
  await page.getByLabel('하지 않을 것 · 한 줄에 하나').fill('레버리지 상품은 매수하지 않는다.')
  await page.getByLabel('변경 이유').fill('처음 개인 투자 기준을 정했습니다.')
  await page.getByRole('button', { name: '기준 저장' }).click()

  await expect(page.getByText('장기 투자하고 자주 매매하지 않는다.')).toBeVisible()
  await expect(page.getByText('기준 버전 1')).toBeVisible()

  const policy = await callRpc(page, 'app_get_investment_policy')
  expect(policy.status, JSON.stringify(policy.body)).toBe(200)
  expect(policy.body.profile).toMatchObject({
    version: 1,
    horizon_text: '10년 이상',
  })

  const context = await callRpc(page, 'app_create_daily_context', {
    input_subject_tickers: null,
    input_timezone: 'Asia/Seoul',
  })
  expect(context.status, JSON.stringify(context.body)).toBe(200)
  expect(context.body.snapshot.investment_policy).toMatchObject({ version: 1 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('saves an instrument holding thesis and includes it in daily context', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  const state = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(state.status, JSON.stringify(state.body)).toBe(200)
  const instrument = state.body.instruments.find((item) => item.ticker === 'E2EAPL')
  expect(instrument).toBeTruthy()

  await openMenuTab(page, '자산')
  await page.getByRole('tab').nth(2).click()
  const card = page.locator('article').filter({ hasText: 'E2E Apple' }).first()
  await card.getByRole('button', { name: '보유 이유 추가' }).click()
  await page.getByLabel('왜 보유하는가').fill('장기 서비스 성장성을 보고 보유한다.')
  await page.getByLabel('예상 보유 기간').fill('3년 이상')
  await page.getByLabel('다시 판단할 조건').fill('성장률이 두 분기 연속 둔화하면 재검토한다.')
  await page.getByLabel('변경 이유').fill('종목의 핵심 가설을 처음 기록합니다.')
  await page.getByRole('button', { name: '보유 이유 저장' }).click()

  await expect(card.getByText('장기 서비스 성장성을 보고 보유한다.')).toBeVisible()
  const thesis = await callRpc(page, 'app_get_holding_thesis', {
    input_instrument_id: instrument.id,
    input_account_id: null,
  })
  expect(thesis.status, JSON.stringify(thesis.body)).toBe(200)
  expect(thesis.body.instrument_base).toMatchObject({
    version: 1,
    reason_text: '장기 서비스 성장성을 보고 보유한다.',
  })

  const context = await callRpc(page, 'app_create_daily_context', {
    input_subject_tickers: null,
    input_timezone: 'Asia/Seoul',
  })
  expect(context.status, JSON.stringify(context.body)).toBe(200)
  expect(context.body.snapshot.holding_theses).toContainEqual(expect.objectContaining({
    instrument_id: instrument.id,
    version: 1,
  }))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('previews and records a completed trade on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')
  await page.getByRole('tab').nth(2).click()
  const card = page.locator('article').filter({ hasText: 'E2E Apple' }).first()
  await card.getByRole('button', { name: '매매 기록' }).click()
  await page.getByLabel('체결 수량').fill('1')
  await page.getByLabel(/체결 단가/).fill('200')
  await page.getByRole('button', { name: '변경 미리보기' }).click()
  await expect(page.getByText('2 → 3')).toBeVisible()
  await page.getByRole('button', { name: '체결 기록 확정' }).click()
  await expect(page.getByRole('heading', { name: 'E2E Apple 매매 기록' })).toBeHidden()

  const transactions = await callRpc(page, 'app_list_transactions', { input_limit: 10, input_before: null })
  expect(transactions.status, JSON.stringify(transactions.body)).toBe(200)
  expect(transactions.body).toContainEqual(expect.objectContaining({ ticker: 'E2EAPL', side: 'buy', quantity: '1.0000000000000000' }))
  const state = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(state.body.holdings.find((item) => item.ticker === 'E2EAPL')).toMatchObject({ quantity: 3 })

  await card.getByRole('button', { name: '매매 기록' }).click()
  await page.getByRole('button', { name: '기록 취소' }).click()
  await page.getByPlaceholder('취소 이유').fill('E2E 잘못 입력한 체결 정정')
  await page.getByRole('button', { name: '취소 영향 미리보기' }).click()
  await expect(page.getByText('현재 잔고를 다시 계산합니다.')).toBeVisible()
  await page.getByRole('button', { name: '거래 기록 취소 확정' }).click()
  await expect(page.getByText('취소됨')).toBeVisible()

  const reversedTransactions = await callRpc(page, 'app_list_transactions', { input_limit: 10, input_before: null })
  expect(reversedTransactions.body.find((item) => item.ticker === 'E2EAPL')?.reversed_at).toBeTruthy()
  const restoredState = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(restoredState.body.holdings.find((item) => item.ticker === 'E2EAPL')).toMatchObject({ quantity: 2 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('reconciles and verifies one holding without broadening the checked fields', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')
  await page.getByRole('tab').nth(2).click()
  const card=page.locator('article').filter({hasText:'E2E Apple'}).first()
  await card.getByRole('button',{name:'잔고 맞추기'}).click()
  await page.getByRole('textbox',{name:'수량'}).fill('4')
  await page.getByRole('textbox',{name:'평균가'}).fill('125')
  await page.getByRole('checkbox',{name:'수량'}).check()
  await page.getByLabel('보정 이유').fill('증권사 수량과 평균가로 현재값을 맞춥니다.')
  await page.getByRole('button',{name:'보정 미리보기'}).click()
  await expect(page.getByText(/2\.0000000000000000 → 4/)).toBeVisible()
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

  async function openTab(label, title) {
    await openMenuTab(page, label)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  }

  await openTab('전략', 'Strategy')
  await openTab('기록', 'Activity')
  await openTab('설정', 'Settings')
  await expect(page.getByText(/^버전 \d{8}T\d{6}Z$/)).toBeVisible()
  await openTab('가이드', 'Guide')
  await expect(page.getByText('자산 구조 만들기')).toBeVisible()
})

test('displays strategy contribution allocation and rebalancing guidance', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await callRpc(page, 'app_save_strategy', {
    input_buckets: [{ name: 'E2E Allocation Bucket', sort_order: 0, tag_ids: [1], target_percentage: 100 }],
    input_drift_threshold: 1, input_monthly_contribution: 100000, input_name: 'E2E Display Strategy', input_review_day: 1,
  })
  await openMenuTab(page, '원칙')
  await expect(page.getByText('E2E Display Strategy')).toBeVisible()
  await expect(page.getByText('E2E Allocation Bucket').first()).toBeVisible()
})

test('handles mocked price-sync Edge Function success and failure in the settings UI', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '설정')

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
  await openMenuTab(page, '자산')
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
  await openMenuTab(page, '자산')
  await page.getByRole('button', { name: 'CSV 복사' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('티커')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('E2EAPL')
})

test('renders saved data in every asset view', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')
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
