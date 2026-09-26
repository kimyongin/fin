import { expect, test } from '@playwright/test'
import { callRpc, signInAs } from './helpers'

test('confirms sharing reset without deleting investments or the profile icon', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  await page.goto('/#settings')
  const prepared = await callRpc(page, 'app_save_sharing_profile', {
    input_public_name: 'e2e-owner', input_viewer_password: 'e2e-password', input_sharing_enabled: true,
  })
  expect(prepared.status).toBe(200)
  await page.reload()
  const sharing = page.locator('article').filter({ has: page.getByRole('heading', { name: '공유 하기' }) })
  const resetButton = sharing.getByRole('button', { name: '공유 설정 초기화' })
  await expect(resetButton).toBeVisible()
  await resetButton.click()
  const confirmation = page.getByRole('dialog', { name: '공유 설정 초기화' })
  await expect(confirmation).toContainText('투자 데이터와 프로필 아이콘은 유지됩니다')
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
    await expect(confirmation).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await confirmation.getByRole('button', { name: '유지' }).click()
  await expect(resetButton).toBeVisible()
  await resetButton.click()
  await confirmation.getByRole('button', { name: '초기화' }).click()
  await expect(sharing.getByText('공유 설정을 초기화하고 기존 연결을 해제했습니다.')).toBeVisible()
  const profile = await callRpc(page, 'app_get_sharing_profile')
  expect(profile.status).toBe(200)
  expect(profile.body).toMatchObject({ public_name: null, sharing_enabled: false, viewer_password_updated_at: null })
  expect(profile.body).not.toHaveProperty('viewer_password_hash')
  await expect(resetButton).toHaveCount(0)
})
