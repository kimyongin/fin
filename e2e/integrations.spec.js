import { expect, test } from '@playwright/test'
import { callRpc, clickPageAction, openMenuTab, openPageActionMenu, signInAs } from './helpers'

test('handles mocked price-sync Edge Function success and failure in the asset UI', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')

  let calls = 0
  await page.route('**/functions/v1/sync-prices', async (route) => {
    calls += 1
    await route.fulfill(calls === 1
      ? {
          contentType: 'application/json',
          status: 200,
          body: JSON.stringify({ total_count: 1, synced: [{ ticker: 'AAPL', rows: 1 }], failed: [] }),
        }
      : { contentType: 'application/json', status: 500, body: JSON.stringify({ message: 'E2E sync failure' }) })
  })
  await openPageActionMenu(page, '자산')
  const button = page.getByRole('button', { name: '가격 갱신' })
  await button.click()
  await expect.poll(() => calls).toBe(1)
  await expect(page.getByText('1/1개 종목 확인, 새 가격 1건 저장.')).toBeVisible()
  await openPageActionMenu(page, '자산')
  await button.click()
  await expect.poll(() => calls).toBe(2)
})

test('looks up a ticker without registering it before the user saves', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')
  await clickPageAction(page, '자산', '종목 추가')
  const tickerInput = page.getByRole('dialog', { name: '종목 추가' }).getByLabel('티커')
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
  const before = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(before.body.instruments.some((item) => item.ticker === 'E2ELOOKUP')).toBe(false)
  await tickerInput.fill('E2EFAIL')
  await lookup.click()
  await expect.poll(() => calls).toBe(2)
})

test('registers a zero-holding instrument, then adds its first holding from detail', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#overview')
  const ticker = `E2E${Date.now().toString(36).slice(-7).toUpperCase()}`
  await page.getByRole('combobox', { name: '계좌 선택' }).selectOption({ label: 'E2E Account' })
  await page.getByRole('searchbox', { name: '종목 검색' }).fill('hidden')
  await page.route('**/functions/v1/lookup-ticker', async (route) => {
    await route.fulfill({ contentType: 'application/json', status: 200,
      body: JSON.stringify({ ticker, display_name: `Registered ${ticker}`, currency: 'USD', instrument_type: 'market' }) })
  })
  await clickPageAction(page, '자산', '종목 추가')
  const registration = page.getByRole('dialog', { name: '종목 추가' })
  await registration.getByLabel('티커').fill(ticker)
  await registration.getByRole('button', { name: '조회' }).click()
  await expect(registration.getByText(`조회 결과 · Registered ${ticker} · USD`)).toBeVisible()
  const before = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(before.body.instruments.some((item) => item.ticker === ticker)).toBe(false)
  await registration.getByRole('button', { name: '등록' }).click()
  const row = page.getByRole('button', { name: new RegExp(`Registered ${ticker}`) })
  await expect(row).toBeVisible()
  await expect(page.getByRole('combobox', { name: '계좌 선택' })).toHaveValue('all')
  await expect(page.getByRole('searchbox', { name: '종목 검색' })).toHaveValue('')
  await expect(row).toContainText('수량 0')
  await page.reload()
  await expect(row).toContainText('수량 0')
  await row.click()
  const detail = page.getByRole('dialog', { name: `Registered ${ticker}` })
  await expect(detail.getByLabel('티커')).toHaveValue(ticker)
  await expect(detail.getByLabel('현재가')).toHaveValue('—')
  await expect(detail.getByLabel('현재가')).toHaveAttribute('readonly', '')
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
    await expect(detail).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await detail.getByRole('button', { name: '보유 추가' }).click()
  await detail.getByRole('combobox', { name: '계좌', exact: true }).selectOption({ label: 'E2E Account' })
  await detail.getByLabel('수량').fill('2')
  await detail.getByLabel('평균가').fill('100')
  await detail.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByRole('dialog', { name: '보유값 변경 확인' }).getByRole('button', { name: '저장' }).click()
  await expect(detail.getByText('저장되었습니다.')).toBeVisible()
  const after = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(after.body.holdings.find((item) => item.ticker === ticker)?.quantity).toBe(2)
  await detail.getByRole('button', { name: '보유 삭제' }).click()
  await page.getByRole('dialog', { name: '보유 삭제' }).getByRole('button', { name: '보유 삭제' }).click()
  await expect(detail.getByRole('button', { name: '보유 추가' })).toBeVisible()
  await detail.getByRole('button', { name: '종목 삭제' }).click()
  await page.getByRole('dialog', { name: '종목 삭제' }).getByRole('button', { name: '종목 삭제' }).click()
  await expect(row).toHaveCount(0)
})

test('copies saved portfolio CSV only from the spreadsheet', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')
  await expect(page.getByRole('button', { name: 'CSV 복사' })).toHaveCount(0)
  await clickPageAction(page, '자산', '표 편집')
  const spreadsheet = page.getByRole('dialog', { name: '표 편집' })
  const footer = spreadsheet.getByRole('group', { name: '표 편집 하단 작업' })
  await expect(footer.getByRole('button', { name: 'CSV 복사' })).toBeVisible()
  await footer.getByRole('button', { name: 'CSV 복사' }).click()
  await expect(page.getByRole('status').getByText('CSV를 복사했어요')).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('티커')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('E2EAPL')
  await spreadsheet.getByRole('button', { name: '닫기' }).click()
  await expect(page.getByRole('button', { name: 'CSV 복사' })).toHaveCount(0)
})

test('renders saved holdings, account scope, allocation and spreadsheet', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')
  await expect(page.getByRole('button', { name: /E2E Apple/ })).toBeVisible()
  await page.getByRole('combobox', { name: '계좌 선택' }).selectOption({ label: 'E2E Account' })
  await expect(page.getByRole('button', { name: '계좌 수정' })).toBeVisible()
  await openMenuTab(page, '배분')
  await expect(page.getByRole('heading', { name: '태그별 배분' })).toBeVisible()
  await openMenuTab(page, '자산')
  await clickPageAction(page, '자산', '표 편집')
  await expect(page.locator('input[value="E2E Apple"]')).toBeVisible()
})

test('aggregates one ticker across accounts and preserves the chosen scope after detail and allocation', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#overview')
  const before = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  const existing = before.body.holdings.filter((item) => item.ticker === 'E2EAPL')
  const expectedQuantity = existing.reduce((sum, item) => sum + Number(item.quantity), 2)
  const expectedAverage = (existing.reduce((sum, item) => sum + Number(item.quantity) * Number(item.avg_price), 0) + 400) / expectedQuantity
  const account = await callRpc(page, 'app_save_account', {
    input_account_id: null, input_broker: 'E2E Broker', input_name: 'E2E Second Account',
    input_note: null, input_request: 'E2E account scope', input_source: 'user',
  })
  expect(account.status).toBe(200)
  const holding = await callRpc(page, 'app_save_holding', {
    input_account_id: account.body[0].account_id, input_avg_price: 200,
    input_holding_id: null, input_quantity: 2,
    input_request: 'E2E weighted average', input_source: 'user', input_ticker: 'E2EAPL',
  })
  expect(holding.status).toBe(200)
  await page.reload()
  const apple = page.getByRole('button', { name: /E2E Apple/ })
  await expect(apple).toContainText(`수량 ${expectedQuantity}`)
  await expect(apple).toContainText(`$${expectedAverage.toFixed(2)} USD`)
  await apple.click()
  const detail = page.getByRole('dialog', { name: 'E2E Apple' })
  await expect(detail.locator('strong').filter({ hasText: 'E2E Account' })).toBeVisible()
  await expect(detail.locator('strong').filter({ hasText: 'E2E Second Account' })).toBeVisible()
  await detail.getByRole('button', { name: '닫기' }).last().click()
  await page.getByRole('combobox', { name: '계좌 선택' }).selectOption({ label: 'E2E Second Account' })
  await page.getByRole('searchbox', { name: '종목 검색' }).fill('apple')
  await expect(apple).toContainText('$200.00 USD')
  await apple.click()
  await expect(page.getByRole('dialog', { name: 'E2E Apple' }).locator('strong').filter({ hasText: 'E2E Account' })).toBeVisible()
  await page.getByRole('dialog', { name: 'E2E Apple' }).getByRole('button', { name: '닫기' }).last().click()
  await expect(page.getByRole('searchbox', { name: '종목 검색' })).toHaveValue('apple')
  await openMenuTab(page, '배분')
  await expect(page.getByRole('heading', { name: '태그별 배분' })).toBeVisible()
  await openMenuTab(page, '자산')
  await expect(page.getByRole('combobox', { name: '계좌 선택' })).toHaveValue(String(account.body[0].account_id))
  await expect(page.getByRole('searchbox', { name: '종목 검색' })).toHaveValue('apple')
})

test('unlocks a seeded shared portfolio through Supabase', async ({ browser, page }) => {
  const owner = await browser.newPage()
  await signInAs(owner, 'e2e-owner@example.com')
  await owner.goto('/')
  expect((await callRpc(owner, 'set_viewer_profile', {
    input_public_name: 'e2e-owner', input_viewer_password: 'e2e-password',
    input_sharing_enabled: true, input_share_scope: 'portfolio_all',
  })).status).toBe(200)
  await owner.close()
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
  await expect(page.getByRole('button', { name: /현재 e2e-owner의 포트폴리오, 전환하기/ })).toBeVisible()
  const principlesRead = page.waitForResponse((response) =>
    response.url().includes('/rest/v1/rpc/app_list_principles') && response.status() === 200,
  )
  await openMenuTab(page, '원칙')
  await principlesRead
  await expect(page.getByRole('heading', { level: 1, name: '원칙' })).toBeVisible()
})

test('rejects an invalid password for the shared portfolio', async ({ browser, page }) => {
  const owner = await browser.newPage()
  await signInAs(owner, 'e2e-owner@example.com')
  await owner.goto('/')
  expect((await callRpc(owner, 'set_viewer_profile', {
    input_public_name: 'e2e-owner', input_viewer_password: 'e2e-password',
    input_sharing_enabled: true, input_share_scope: 'portfolio_all',
  })).status).toBe(200)
  await owner.close()
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
