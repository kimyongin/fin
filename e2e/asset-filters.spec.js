import { expect, test } from '@playwright/test'
import { callRpc, seedProviderPrice, signInAs } from './helpers'

test('filters asset rows and summary together, then removes a newly tagged holding from untagged results', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#overview')
  const state = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(state.status).toBe(200)
  const ticker = `FLT${Date.now().toString(36).slice(-6).toUpperCase()}`
  const instrument = await callRpc(page, 'app_save_instrument', {
    input_currency: 'KRW', input_display_name: `필터 테스트 ${ticker}`, input_instrument_id: null,
    input_instrument_type: 'market', input_note: null, input_price: null,
    input_price_date: null, input_price_source: 'manual', input_request: null,
    input_source: 'user', input_tag_id: null, input_ticker: ticker,
  })
  expect(instrument.status).toBe(200)
  await seedProviderPrice(page, ticker, 1000, '2026-09-25')
  expect((await callRpc(page, 'app_save_holding', {
    input_account_id: state.body.accounts[0].id, input_avg_price: 900,
    input_holding_id: null, input_quantity: 2, input_request: null,
    input_source: 'user', input_ticker: ticker,
  })).status).toBe(200)

  await page.reload()
  const filters = page.getByRole('group', { name: '대표 태그 필터' })
  const list = page.getByRole('region', { name: '자산 종목' })
  const row = list.getByRole('button', { name: new RegExp(ticker) })
  await filters.getByRole('button', { name: '태그 없음' }).click()
  await page.getByRole('searchbox', { name: '종목 검색' }).fill(ticker)
  await expect(row).toBeVisible()
  await expect(page.locator('.page-panel__supporting')).toContainText('조회 결과 · 평가액 ₩2,000')
  await expect(list).toContainText('가장 최근 시세 기준일 2026-09-25 · 수익률은')

  await row.click()
  const detail = page.getByRole('dialog', { name: `필터 테스트 ${ticker}` })
  await detail.getByRole('button', { name: 'E2E Tag' }).click()
  await detail.getByRole('button', { name: '저장' }).click()
  await page.getByRole('dialog', { name: '변경 내용 저장' }).getByRole('button', { name: '저장' }).click()
  await expect(detail.getByText('저장되었습니다.')).toBeVisible()
  await detail.getByRole('button', { name: '닫기' }).last().click()
  await expect(row).toHaveCount(0)
  await expect(page.locator('.page-panel__supporting')).toContainText('조회 결과 · 평가액 ₩0')
  await expect(filters.getByRole('button', { name: '태그 없음' })).toHaveAttribute('aria-pressed', 'true')
  await expect(list).toBeFocused()
  await filters.getByRole('button', { name: 'E2E Tag' }).click()
  await expect(row).toBeVisible()
})

test('keeps the four page panels within mobile and desktop viewports', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const tab of ['overview', 'allocation', 'tasks', 'strategy']) {
      await page.goto(`/#${tab}`)
      await expect(page.locator('main')).toBeVisible()
      if (tab === 'overview') {
        const radii = await page.getByRole('group', { name: '대표 태그 필터' }).getByRole('button').evaluateAll(buttons => buttons.slice(0, 2).map(button => getComputedStyle(button).borderTopLeftRadius))
        expect(radii).toEqual(['10px', '10px'])
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${tab} at ${width}px`).toBe(true)
    }
  }
})
