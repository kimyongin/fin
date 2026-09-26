import { expect, test } from '@playwright/test'
import { callRpc, clickPageAction, signInAs } from './helpers'

test('registers a valuation instrument without creating an account', async ({ page }) => {
  await signInAs(page, 'e2e-outsider@example.com')
  await page.goto('/#overview')
  const before = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(before.body.accounts).toHaveLength(0)
  await clickPageAction(page, '자산', '종목 추가')
  const registration = page.getByRole('dialog', { name: '종목 추가' })
  await registration.getByLabel('종류').selectOption('valuation')
  await registration.getByLabel('종목명').fill('계좌 없는 평가 자산')
  await registration.getByRole('button', { name: '등록' }).click()
  const row = page.getByRole('button', { name: /계좌 없는 평가 자산/ })
  await expect(row).toContainText('보유 없음')
  await row.click()
  await expect(page.getByRole('dialog', { name: '계좌 없는 평가 자산' }).getByText(/계좌를 추가해 주세요/)).toBeVisible()
  const after = await callRpc(page, 'app_get_portfolio_state', { input_owner_user_id: null })
  expect(after.body.holdings).toHaveLength(0)
})
