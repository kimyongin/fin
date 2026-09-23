import { expect, test } from '@playwright/test'
import { callRpc, openMenuTab, signInAs } from './helpers'

test('handles mocked price-sync Edge Function success and failure in the settings UI', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '설정')

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
  const button = page.getByRole('button', { name: '가격 동기화' })
  await button.click()
  await expect.poll(() => calls).toBe(1)
  await expect(page.getByText('1/1개 종목 확인, 새 가격 1건 저장.')).toBeVisible()
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

test('copies the visible portfolio as CSV from the asset toolbar', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/')
  await openMenuTab(page, '자산')
  await page.getByRole('button', { name: 'CSV 복사' }).click()
  await expect(page.getByRole('status').getByText('CSV를 복사했어요')).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('티커')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('E2EAPL')
  await page.getByRole('button', { name: '목표와 비교' }).click()
  await expect(page.getByRole('button', { name: 'CSV 복사' })).toBeVisible()
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
