import { expect, test } from '@playwright/test'
import { signInAs } from './helpers'

test('captures account reference and activity editor at mobile and desktop widths', async ({ page }, testInfo) => {
  await signInAs(page, 'e2e-owner@example.com')
  for (const width of [390, 1024]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/#overview')
    await page.getByText('추가 ▾').click()
    await page.getByRole('button', { name: '계좌 추가' }).click()
    const account = page.getByRole('dialog', { name: '계좌 추가' })
    await expect(account.getByLabel('계좌명')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`account-${width}.png`) })
    await account.getByRole('button', { name: '닫기' }).first().click()

    await page.goto('/#tasks')
    await page.getByRole('button', { name: '활동 추가', exact: true }).click()
    const activity = page.getByRole('dialog', { name: '활동 추가' })
    await expect(activity.getByRole('textbox', { name: '할 일 제목' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`activity-${width}.png`) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await activity.getByRole('button', { name: '닫기' }).first().click()
  }
})
