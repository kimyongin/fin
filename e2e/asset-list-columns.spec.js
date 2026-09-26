import { expect, test } from '@playwright/test'
import { callRpc, seedProviderPrice, signInAs } from './helpers'

test('aligns asset list headers and values across screen sizes', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#overview')

  const state = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(state.status).toBe(200)
  const suffix = Date.now().toString(36).slice(-6).toUpperCase()
  const ticker = `COL${suffix}`
  const name = `장기 투자 목록에서 이름이 길어지는 종목 ${suffix}`
  const instrument = await callRpc(page, 'app_save_instrument', {
    input_currency: 'USD', input_display_name: name, input_instrument_id: null,
    input_instrument_type: 'market', input_note: null, input_price: null,
    input_price_date: null, input_price_source: 'manual', input_request: null,
    input_source: 'user', input_tag_id: state.body.tags[0]?.id ?? null,
    input_ticker: ticker,
  })
  expect(instrument.status).toBe(200)
  await seedProviderPrice(page, ticker, 12.5, '2026-09-24')
  const holding = await callRpc(page, 'app_save_holding', {
    input_account_id: state.body.accounts[0].id, input_avg_price: 10,
    input_holding_id: null, input_quantity: 2.25, input_request: null,
    input_source: 'user', input_ticker: ticker,
  })
  expect(holding.status).toBe(200)

  const valuationTicker = `VALUATION:COL${suffix}`
  const cashTicker = `CASH:COL${suffix}`
  const missingTicker = `MISS${suffix}`
  for (const item of [
    { ticker: valuationTicker, name: '직접 평가 자산', type: 'valuation' },
    { ticker: cashTicker, name: '현금 잔액', type: 'cash' },
    { ticker: missingTicker, name: '시세 없는 종목', type: 'market' },
  ]) {
    const saved = await callRpc(page, 'app_save_instrument', {
      input_currency: 'KRW', input_display_name: item.name, input_instrument_id: null,
      input_instrument_type: item.type, input_note: null, input_price: null,
      input_price_date: null, input_price_source: 'manual', input_request: null,
      input_source: 'user', input_tag_id: null, input_ticker: item.ticker,
    })
    expect(saved.status).toBe(200)
  }
  expect((await callRpc(page, 'app_save_valuation_holding', {
    input_account_id: state.body.accounts[0].id, input_holding_id: null,
    input_purchase_amount: 100000, input_request: null, input_source: 'user',
    input_ticker: valuationTicker, input_valuation_amount: 125000,
  })).status).toBe(200)
  expect((await callRpc(page, 'app_save_cash_holding', {
    input_account_id: state.body.accounts[0].id, input_balance: 50000,
    input_holding_id: null, input_request: null, input_source: 'user',
    input_ticker: cashTicker,
  })).status).toBe(200)
  expect((await callRpc(page, 'app_save_holding', {
    input_account_id: state.body.accounts[0].id, input_avg_price: 0,
    input_holding_id: null, input_quantity: 1, input_request: null,
    input_source: 'user', input_ticker: missingTicker,
  })).status).toBe(200)

  await page.reload()
  const list = page.getByRole('region', { name: '자산 종목' })
  const header = list.getByText('종목', { exact: true }).locator('..')
  const row = list.getByRole('button', { name: new RegExp(name) })
  await expect(row).toBeVisible()
  await expect(header.locator(':scope > span')).toHaveText(['종목', '보유', '평가'])
  await expect(row.getByText('2.25')).toBeVisible()
  await expect(row.getByText(/평균가.*USD/)).toBeVisible()
  await expect(row.getByText(/현재가.*USD/)).toBeVisible()
  await expect(row.getByText('+25.0%')).toBeVisible()
  await expect(row.getByText(/환산/)).toBeVisible()
  await expect(list.getByText(/수익률은 평균가 대비 현재가 기준/)).toBeVisible()
  await expect(list).toContainText('환율 기준')
  await expect(list).toContainText('1 USD = 1,400원 (2026-09-26)')
  await expect(row.getByText('2026-09-24')).toHaveCount(0)
  const valuationRow = list.getByRole('button', { name: /직접 평가 자산/ })
  await expect(valuationRow.getByText('평가형')).toBeVisible()
  await expect(valuationRow.getByText(/매입.*100,000/)).toBeVisible()
  await expect(valuationRow.getByText(/현재가/)).toHaveCount(0)
  const cashRow = list.getByRole('button', { name: /현금 잔액/ })
  await expect(cashRow.getByText('현금성')).toBeVisible()
  await expect(cashRow.getByText(/평균가|현재가/)).toHaveCount(0)
  const missingRow = list.getByRole('button', { name: /시세 없는 종목/ })
  await expect(missingRow.getByText('평가 불가')).toBeVisible()
  await expect(missingRow).toContainText('—')
  await page.evaluate(() => document.fonts.ready)

  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const aligned = await Promise.all([header, row].map((item) => item.evaluate((element) =>
      [...element.children].map((child) => child.getBoundingClientRect().left),
    )))
    expect(aligned[0]).toHaveLength(3)
    expect(aligned[1]).toHaveLength(3)
    aligned[0].forEach((left, index) => expect(Math.abs(left - aligned[1][index])).toBeLessThan(1))
    expect(await row.evaluate((element) => [...element.children].every((cell) => cell.scrollWidth <= cell.clientWidth + 1))).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const typography = await row.evaluate((element) => {
      const style = (selector) => {
        const computed = getComputedStyle(element.querySelector(selector))
        return [computed.fontSize, computed.fontWeight, computed.lineHeight]
      }
      return {
        name: style('.type-item-title'),
        ticker: style('.type-meta'),
        quantity: style('.type-value'),
        price: style('.type-secondary'),
      }
    })
    expect(typography).toEqual({
      name: ['16px', '600', '24px'],
      ticker: ['12px', '400', '18px'],
      quantity: ['16px', '600', '24px'],
      price: ['14px', '400', '20px'],
    })
    expect(await page.getByRole('searchbox', { name: '종목 검색' }).evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px')
  }

  await page.getByRole('searchbox', { name: '종목 검색' }).fill('존재하지 않는 검색어')
  await expect(list.getByText('조건에 맞는 종목이 없습니다.')).toBeVisible()
  await expect(list.getByText('종목', { exact: true })).toHaveCount(0)
  await page.getByRole('searchbox', { name: '종목 검색' }).clear()
  await expect(row).toBeVisible()
  await page.getByRole('combobox', { name: '계좌 선택' }).selectOption(String(state.body.accounts[0].id))
  await expect(row).toBeVisible()

  await row.click()
  const detail = page.getByRole('dialog', { name })
  await expect(detail.getByLabel('기준일')).toHaveValue('2026-09-24')
  await expect(detail.getByLabel('기준일')).toHaveAttribute('readonly', '')
  expect(await detail.locator('.type-dialog-title').first().evaluate((element) => {
    const computed = getComputedStyle(element)
    return [computed.fontSize, computed.fontWeight, computed.lineHeight]
  })).toEqual(['20px', '600', '28px'])
  await detail.getByRole('button', { name: '닫기' }).last().click()
  await expect(row).toBeVisible()
})
