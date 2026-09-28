import { expect, test } from '@playwright/test'
import { callRpc, signInAs } from './helpers'

test('separates record reading from editing without opening a modal while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  const title = `E2E 읽기 동작 ${Date.now()}`
  const body = '## 근거\n\n| 항목 | 값 |\n| --- | --- |\n| 심리 | 주의 |\n\n- **관찰** 기록'
  const created = await callRpc(page, 'app_create_activity', {
    input_idempotency_key: crypto.randomUUID(),
    input_payload: { title, body, authored_via: 'app' },
  })
  expect(created.status, JSON.stringify(created.body)).toBe(200)
  await page.goto('/#tasks')
  const item = page.getByRole('listitem').filter({ hasText: title }).first()
  const read = item.getByRole('button', { name: `기록 읽기: ${title}` })
  const edit = item.getByRole('button', { name: `기록 편집: ${title}` })
  await expect(read).toBeVisible()
  await expect(edit).toBeVisible()
  for (const viewportWidth of [320, 360, 390, 414, 768]) {
    await page.setViewportSize({ width: viewportWidth, height: 844 })
    for (const locator of [page.locator('#lifecycle-panel'), page.locator('.page-panel').first(), item, read, edit]) {
      const bounds = await locator.boundingBox()
      expect(bounds, `missing bounds at ${viewportWidth}px`).not.toBeNull()
      expect(bounds.x, `left edge at ${viewportWidth}px`).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width, `right edge at ${viewportWidth}px`).toBeLessThanOrEqual(viewportWidth)
    }
    const clippedActions = await page.locator('#lifecycle-panel button[title="읽기"], #lifecycle-panel button[title="편집"]').evaluateAll((buttons) => buttons.filter((button) => {
      const bounds = button.getBoundingClientRect()
      return bounds.left < 0 || bounds.right > window.innerWidth
    }).map((button) => button.getAttribute('aria-label')))
    expect(clippedActions, `clipped list actions at ${viewportWidth}px`).toEqual([])
  }
  await page.setViewportSize({ width: 390, height: 844 })
  const width = await read.evaluate((button) => getComputedStyle(button).width)
  expect(Number.parseFloat(width)).toBeGreaterThanOrEqual(44)
  await item.getByText(title).click()
  await page.mouse.wheel(0, 400)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await read.click()
  const detail = page.getByRole('dialog', { name: '기록 상세' })
  await expect(detail.getByRole('heading', { name: '근거' })).toBeVisible()
  await expect(detail.getByRole('table')).toBeVisible()
  await expect(detail.getByRole('textbox', { name: '기록 제목' })).toHaveAttribute('readonly', '')
  await detail.getByRole('button', { name: `기록 편집: ${title}` }).click()
  await expect(detail.getByRole('textbox', { name: '기록 제목' })).toHaveValue(title)
  await detail.getByRole('textbox', { name: '기록 제목' }).fill(`${title} 수정`)
  await detail.getByRole('button', { name: '저장', exact: true }).click()
  await expect(detail.getByRole('heading', { name: '근거' })).toBeVisible()
  await expect(detail.getByRole('textbox', { name: '기록 제목' })).toHaveAttribute('readonly', '')
  await expect(detail.getByRole('textbox', { name: '기록 제목' })).toHaveValue(`${title} 수정`)
  for (const viewportWidth of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width: viewportWidth, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})
