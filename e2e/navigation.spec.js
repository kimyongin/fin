import { expect, test } from '@playwright/test'
import { callRpc, openMenuTab, signInAs } from './helpers'

test('navigates the authenticated browser through strategy, activity, and settings pages', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: '자산' })).toBeVisible()

  const policy = await callRpc(page, 'app_get_sharing_policy')
  await callRpc(page, 'app_update_sharing_policy', {
    input_expected_version: policy.body.version,
    input_grants: { activity: false, tasks: false },
  })

  async function openTab(label, title) {
    await openMenuTab(page, label)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  }

  await openTab('원칙', '원칙')
  await openTab('활동', '활동')
  await openTab('설정', '설정')
  const reviewSharing = page.getByRole('button', { name: '활동 공유' })
  await expect(reviewSharing).toHaveAttribute('aria-pressed', 'false')
  await reviewSharing.click()
  await expect(reviewSharing).toHaveAttribute('aria-pressed', 'true')
  const sharingPolicy = await callRpc(page, 'app_get_sharing_policy')
  expect(sharingPolicy.body.grants).toMatchObject({ activity: true, tasks: false })
  await reviewSharing.click()
  await expect(reviewSharing).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText(/^버전 \d{8}T\d{6}Z$/)).toBeVisible()
  await openTab('가이드', '가이드')
  await expect(page.getByText('현재 자산을 입력하고, ChatGPT에서 첫 점검을 저장하세요')).toBeVisible()
})

test('routes old news links to the research activity flow', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#news')
  await expect(page.getByRole('heading', { level: 1, name: '활동' })).toBeVisible()
  await expect(page).toHaveURL(/#tasks$/)
  const title = `E2E 조사 활동 ${Date.now()}`
  const created = await callRpc(page, 'app_create_activity', {
    input_idempotency_key: crypto.randomUUID(),
    input_payload: { title, body: '공식 자료 확인', authored_via: 'app', timezone: 'Asia/Seoul' },
  })
  expect(created.status, JSON.stringify(created.body)).toBe(200)
  await page.reload()
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible()
  const detail = await callRpc(page, 'app_get_activity', { input_activity_id: created.body.id, input_owner_user_id: null })
  expect(detail.body.body).toBe('공식 자료 확인')
})

test('guides a new user from empty assets through OAuth setup and first review', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-outsider@example.com')
  await page.goto('/#today')

  await expect(page).toHaveURL(/#tasks$/)
  await page.getByText('상세 필터').click()
  await page.getByRole('textbox', { name: '활동 검색' }).fill('존재하지 않는 점검')
  await page.getByRole('button', { name: '검색', exact: true }).click()
  await expect(page.getByText('조건에 맞는 활동이 없습니다.')).toBeVisible()
  await openMenuTab(page, '가이드')
  await expect(page).toHaveURL(/#guide$/)
  await expect(page.getByText('/functions/v1/portfolio-mcp-oauth')).toBeVisible()
  await page.getByRole('button', { name: 'OAuth MCP 주소 복사' }).click()
  await expect(page.getByRole('button', { name: '복사했어요' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('portfolio-mcp-oauth')
  await page.getByRole('button', { name: '첫 점검 문구 복사' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('오늘 내 포트폴리오 점검하고 저장해줘')
  await expect(page.getByText('분석만 요청하면 저장하지 않습니다.')).toBeVisible()
  await expect(page.getByText('앱은 주문하지 않습니다.')).toBeVisible()
  await page.getByText('로그인 또는 승인을 취소함').click()
  await expect(page.getByText('Portfolio 데이터는 바뀌지 않습니다.')).toBeVisible()
  await page.getByRole('button', { name: '자산 입력하기' }).click()
  await expect(page).toHaveURL(/#overview$/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('keeps the four primary page controls readable across viewport widths', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [hash, title] of [
      ['overview', '자산'],
      ['allocation', '배분'],
      ['tasks', '활동'],
      ['strategy', '원칙'],
    ]) {
      await page.goto(`/#${hash}`)
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      if (hash === 'overview') await expect(page.getByRole('region', { name: '보유 종목' })).toBeVisible()
      if (hash === 'allocation') await expect(page.getByRole('heading', { name: /전체 계좌 · 태그별 배분/ })).toBeVisible()
      if (hash === 'tasks') {
        await expect(page.getByRole('textbox', { name: '활동 검색' })).toBeVisible()
        await expect(page.getByRole('heading', { name: '할 일' })).toBeVisible()
        await expect(page.getByRole('heading', { name: '기록' })).toBeVisible()
      }
      if (hash === 'strategy') await expect(page.getByRole('heading', { name: '변경 이력' })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
  }
})
test('keeps tag allocation visible and editable in the bottom allocation tab', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  const portfolio = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  const before = await callRpc(page, 'app_get_strategy_state', { input_owner_user_id: null })
  const tag = portfolio.body.tags[0]
  await callRpc(page, 'app_save_allocation_targets', {
    input_targets: [{ tag_id: tag.id, target_percentage: 100 }],
    input_expected_targets: before.body.targets.map(({ tag_id, target_percentage }) => ({ tag_id, target_percentage })),
  })
  await openMenuTab(page, '원칙')
  await expect(page.getByRole('heading', { name: '변경 이력' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: `${tag.name} 목표 비중` })).toHaveCount(0)
  await expect(page.getByText('비중 계산을 잠시 멈췄습니다.')).toHaveCount(0)
  await openMenuTab(page, '배분')
  await expect(page.getByRole('textbox', { name: `${tag.name} 목표 비중` })).toHaveValue('100')
  await expect(page.locator('nav[aria-label="주요 메뉴"]').getByRole('button', { name: '배분', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: '자산으로 돌아가기' })).toHaveCount(0)
  await expect(page.getByText('목표 합계 100.00% / 100%')).toBeVisible()
  await expect(page).toHaveURL(/#allocation$/)
  await expect(page.getByRole('button', { name: '모드 변경' })).toHaveCount(0)
  await openMenuTab(page, '자산')
  await expect(page).toHaveURL(/#overview$/)
  await expect(page.getByRole('button', { name: '전체 배분 보기' })).toHaveCount(0)
})

test('manages instrument tags from the asset toolbar', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#overview')
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('button', { name: '가격 갱신' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await openMenuTab(page, '배분')
  await page.getByRole('button', { name: '태그 관리' }).click()
  const manager = page.getByRole('dialog', { name: '종목 태그 관리' })
  await expect(manager).toBeVisible()
  await manager.getByRole('button', { name: '태그 추가' }).click()
  const editor = page.getByRole('dialog', { name: '태그 추가' })
  await expect(editor).toBeVisible()
  const tagName = `E2E 종목 태그 ${Date.now()}`
  await editor.getByRole('textbox', { name: '태그명' }).fill(tagName)
  await editor.getByRole('button', { name: '저장' }).click()
  await expect(editor).toHaveCount(0)
  await page.getByRole('button', { name: '태그 관리' }).click()
  await expect(page.getByRole('dialog', { name: '종목 태그 관리' }).getByRole('button', { name: new RegExp(tagName) })).toBeVisible()
})

test('shows incomplete valuation explicitly and suppresses allocation amounts', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  const initialState = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  const missingTicker = `E2EMISS${Date.now().toString().slice(-8)}`
  expect((await callRpc(page, 'app_save_instrument', {
    input_currency: 'KRW', input_display_name: 'E2E Missing Price', input_instrument_id: null,
    input_instrument_type: 'market', input_note: null, input_price: null, input_price_date: null,
    input_price_source: 'manual', input_request: null, input_source: 'user', input_tag_id: null,
    input_ticker: missingTicker,
  })).status).toBe(200)
  expect((await callRpc(page, 'app_save_holding', {
    input_account_id: initialState.body.accounts[0].id, input_avg_price: 100, input_holding_id: null,
    input_note: null, input_quantity: 1, input_request: null, input_source: 'user',
    input_ticker: missingTicker,
  })).status).toBe(200)
  const beforeTargets = await callRpc(page, 'app_get_strategy_state', { input_owner_user_id: null })
  expect((await callRpc(page, 'app_save_allocation_targets', {
    input_targets: [{ tag_id: initialState.body.tags[0].id, target_percentage: 100 }],
    input_expected_targets: beforeTargets.body.targets.map(({ tag_id, target_percentage }) => ({ tag_id, target_percentage })),
  })).status).toBe(200)

  const state = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(state.status, JSON.stringify(state.body)).toBe(200)
  expect(state.body.valuation_quality.unknown_position_count).toBeGreaterThan(0)
  expect(state.body.valuation_quality.is_complete).toBe(false)

  await page.reload()
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/#overview')
    await expect(page.getByText(/평가 불가 \d+개 제외/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }

  await openMenuTab(page, '배분')
  await expect(page.getByText('시세 또는 환율이 빠져 현재 비중과 차이를 정확히 계산할 수 없습니다.')).toBeVisible()
  await expect(page.getByRole('heading', { name: '이번 달 적립금 배분' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '리밸런싱 제안' })).toHaveCount(0)
})

test('keeps four primary destinations usable without horizontal overflow', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')

  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const primary = page.locator('nav[aria-label="주요 메뉴"]:visible')
    await expect(primary.getByRole('button')).toHaveCount(4)
    await expect(primary.getByRole('button', { name: '자산', exact: true })).toBeVisible()
    await expect(primary.getByRole('button', { name: '배분', exact: true })).toBeVisible()
    await expect(primary.getByRole('button', { name: '활동', exact: true })).toBeVisible()
    await expect(primary.getByRole('button', { name: '원칙', exact: true })).toBeVisible()
    await expect.poll(() => primary.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return {
        bottom: Math.round(box.bottom),
        left: Math.round(box.left),
        position: getComputedStyle(element).position,
        width: Math.round(box.width),
      }
    })).toEqual({ bottom: 900, left: 0, position: 'fixed', width })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }

  const assets = page.locator('nav[aria-label="주요 메뉴"]:visible').getByRole('button', { name: '자산', exact: true })
  await assets.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#overview$/)
  await page.getByRole('button', { name: 'Open menu' }).click()
  const secondary = page.locator('nav[aria-label="보조 메뉴"]')
  for (const label of ['피드백', '설정', '가이드']) await expect(secondary.getByRole('button', { name: label, exact: true })).toBeVisible()
  await expect(secondary.getByRole('button', { name: '자료', exact: true })).toHaveCount(0)
  await expect(secondary.getByRole('button', { name: '활동 내역', exact: true })).toHaveCount(0)
})

test('keeps shared page controls and editing surfaces consistent', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#overview')

  await page.getByRole('button', { name: '표 편집' }).click()
  await expect(page).toHaveURL(/#overview$/)
  const spreadsheet = page.getByRole('dialog', { name: '표 편집' })
  await expect(spreadsheet).toBeVisible()
  await expect(page.getByRole('region', { name: '보유 종목' })).toBeVisible()
  await expect(page.getByRole('button', { name: '전체 화면으로 표 편집' })).toHaveCount(0)
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(spreadsheet).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  const accountName = spreadsheet.getByLabel('계좌명').first()
  const initialAccountName = await accountName.inputValue()
  await accountName.fill(`${initialAccountName} 임시`)
  await spreadsheet.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(spreadsheet.getByText('저장하지 않은 변경이 있습니다.')).toBeVisible()
  await spreadsheet.getByRole('button', { name: '계속 편집' }).click()
  await expect(accountName).toHaveValue(`${initialAccountName} 임시`)
  await spreadsheet.getByRole('button', { name: '닫기', exact: true }).click()
  await spreadsheet.getByRole('button', { name: '변경 버리기' }).click()
  await expect(spreadsheet).toHaveCount(0)
  await expect(page).toHaveURL(/#overview$/)
  await page.getByText('추가 ▾').click()
  await page.getByRole('button', { name: '계좌 추가' }).click()
  const accountEditor = page.getByRole('dialog', { name: '계좌 추가' })
  await accountEditor.getByLabel('계좌명').fill('저장 전 계좌')
  await accountEditor.getByRole('button', { name: '닫기', exact: true }).last().click()
  await expect(accountEditor.getByText('저장하지 않은 변경이 있습니다.')).toBeVisible()
  await accountEditor.getByRole('button', { name: '계속 편집' }).click()
  await expect(accountEditor.getByLabel('계좌명')).toHaveValue('저장 전 계좌')
  await accountEditor.getByRole('button', { name: '닫기', exact: true }).first().click()
  await accountEditor.getByRole('button', { name: '변경 버리기' }).click()
  await expect(accountEditor).toHaveCount(0)

  const destinations = [
    ['overview', '자산'],
    ['decisions', '활동'],
    ['tasks', '활동'],
    ['strategy', '원칙'],
    ['activity', '활동'],
    ['feedback', '피드백'],
    ['settings', '설정'],
    ['guide', '가이드'],
  ]
  for (const [route, heading] of destinations) {
    await page.goto(`/#${route}`)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
  }
  await page.goto('/#today')
  await expect(page).toHaveURL(/#tasks$/)
  await expect(page.getByRole('heading', { level: 1, name: '활동' })).toBeVisible()
})

test('keeps legacy asset links pointed at their new purpose', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  for (const hash of ['accounts', 'instruments', 'tags']) {
    await page.goto(`/#${hash}`)
    await expect(page.getByRole('region', { name: '보유 종목' })).toBeVisible()
    await expect(page).toHaveURL(/#overview$/)
  }
  await page.goto('/#sheet')
  await expect(page.getByRole('region', { name: '보유 종목' })).toBeVisible()
  await expect(page).toHaveURL(/#overview$/)
  await page.goto('/#allocation')
  await expect(page.getByRole('heading', { name: /전체 계좌 · 태그별 배분/ })).toBeVisible()
})

test('keeps holdings, instrument detail, allocation and spreadsheet within supported widths', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#overview')
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('region', { name: '보유 종목' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', { name: /E2E Apple/ }).click()
    await expect(page.getByRole('dialog', { name: 'E2E Apple' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('dialog', { name: 'E2E Apple' }).getByRole('button', { name: '닫기' }).first().click()
    await openMenuTab(page, '배분')
    await expect(page.getByRole('heading', { name: /전체 계좌 · 태그별 배분/ })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await openMenuTab(page, '자산')
    await page.getByRole('button', { name: '표 편집' }).click()
    await expect(page.getByRole('dialog', { name: '표 편집' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('dialog', { name: '표 편집' }).getByRole('button', { name: '닫기' }).click()
  }
})
