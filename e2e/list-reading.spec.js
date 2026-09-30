import { expect, test } from '@playwright/test'
import { callRpc, signInAs } from './helpers'

test('separates record reading from editing without opening a modal while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAs(page, 'e2e-owner@example.com')
  const title = 'ISHARES 20+Y US TREASURY BOND JPY HEDGED'
  const longValue = 'b31291ed9fc8a4284b9db0d29ea79d6374e74ad4bc45ca3880d9fab45b0dc99d'
  const body = `## 근거\n\n| 항목 | 값 |\n| --- | --- |\n| 심리 | ${longValue.repeat(3)} |\n\n- **관찰** 기록 ${longValue}\n\nSHA-256: ${longValue}\n\n인라인 코드: \`${longValue}\`\n\n\`\`\`text\n${longValue.repeat(3)}\n\`\`\``
  const created = await callRpc(page, 'app_create_activity', {
    input_idempotency_key: crypto.randomUUID(),
    input_payload: { title, summary: title, body, authored_via: 'app' },
  })
  expect(created.status, JSON.stringify(created.body)).toBe(200)
  await page.goto('/#tasks')
  const item = page.getByRole('listitem').filter({ hasText: title }).first()
  const read = item.getByRole('button', { name: `기록 보기: ${title}` })
  const edit = item.getByRole('button', { name: `기록 편집: ${title}` })
  await expect(read).toBeVisible()
  await expect(edit).toBeVisible()
  await expect(read).toHaveText('보기')
  await expect(edit).toHaveText('편집')
  for (const viewportWidth of [320, 360, 390, 414, 768]) {
    await page.setViewportSize({ width: viewportWidth, height: 844 })
    for (const locator of [page.locator('#lifecycle-panel'), page.locator('.page-panel').first(), item, read, edit]) {
      const bounds = await locator.boundingBox()
      expect(bounds, `missing bounds at ${viewportWidth}px`).not.toBeNull()
      expect(bounds.x, `left edge at ${viewportWidth}px`).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width, `right edge at ${viewportWidth}px`).toBeLessThanOrEqual(viewportWidth)
    }
    const clippedActions = await page.locator('#lifecycle-panel .list-item-text-action').evaluateAll((buttons) => buttons.filter((button) => {
      const bounds = button.getBoundingClientRect()
      return bounds.left < 0 || bounds.right > window.innerWidth
    }).map((button) => button.getAttribute('aria-label')))
    expect(clippedActions, `clipped list actions at ${viewportWidth}px`).toEqual([])
    const layout = await item.locator('.list-item-title-line').first().evaluate((line) => {
      const title = line.querySelector('.list-item-title')
      const actions = line.querySelector('.list-item-actions')
      const range = document.createRange()
      range.selectNodeContents(title)
      const rects = [...range.getClientRects()]
      const titleBounds = rects.at(-1)
      const actionBounds = actions.getBoundingClientRect()
      return { titleRight: titleBounds.right, titleBottom: titleBounds.bottom, titleTop: titleBounds.top, lines: rects.length, available: line.getBoundingClientRect().right - titleBounds.right, actionWidth: actionBounds.width, actionsX: actionBounds.x, actionsTop: actionBounds.top, actionsBottom: actionBounds.bottom, actionsRight: actionBounds.right }
    })
    expect(layout.actionsRight).toBeLessThanOrEqual(viewportWidth)
    if (viewportWidth === 390) {
      expect(layout.lines).toBeGreaterThan(1)
      expect(layout.available).toBeGreaterThanOrEqual(layout.actionWidth + 5)
      await item.screenshot({ path: test.info().outputPath('inline-actions-390.png') })
    }
    if (layout.available >= layout.actionWidth + 5) {
      expect(layout.actionsX).toBeGreaterThanOrEqual(layout.titleRight)
      expect(layout.actionsTop).toBeLessThan(layout.titleBottom)
      expect(layout.actionsBottom).toBeGreaterThan(layout.titleTop)
    } else {
      expect(layout.actionsTop).toBeGreaterThanOrEqual(layout.titleBottom - 1)
    }
  }
  await page.setViewportSize({ width: 390, height: 844 })
  const width = await read.evaluate((button) => getComputedStyle(button).width)
  expect(Number.parseFloat(width)).toBeGreaterThanOrEqual(44)
  const appearance = await read.evaluate((button) => {
    const style = getComputedStyle(button)
    return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, background: style.backgroundColor, border: style.borderTopWidth, decoration: style.textDecorationLine }
  })
  expect(appearance).toEqual({ fontSize: '14px', fontWeight: '400', lineHeight: '20px', background: 'rgba(0, 0, 0, 0)', border: '0px', decoration: 'underline' })
  const actionGroup = item.locator('.list-item-actions').first()
  await expect(actionGroup.locator('.list-item-actions__separator')).toHaveText('·')
  await item.locator('.list-item-title').click()
  await page.mouse.wheel(0, 400)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await read.click()
  const detail = page.getByRole('dialog', { name: '기록 상세' })
  await expect(detail.getByRole('heading', { name: '근거' })).toBeVisible()
  await expect(detail.getByRole('table')).toBeVisible()
  await expect(detail.getByRole('heading', { name: title, exact: true })).toBeVisible()
  await expect(detail.getByRole('textbox')).toHaveCount(0)
  for (const viewportWidth of [320, 360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width: viewportWidth, height: 900 })
    const layout = await detail.evaluate((dialog) => {
      const bounds = dialog.getBoundingClientRect()
      const fieldset = dialog.querySelector('fieldset')
      const fieldBounds = fieldset.getBoundingClientRect()
      const clipped = [...fieldset.querySelectorAll('section, input, .type-long-body, .type-long-body > *')]
        .filter((element) => {
          const rect = element.getBoundingClientRect()
          return rect.left < fieldBounds.left - 1 || rect.right > fieldBounds.right + 1
        }).map((element) => element.tagName)
      const scrollRegions = [...dialog.querySelectorAll('pre, table')].map((element) => {
        const region = element.tagName === 'TABLE' ? element.parentElement : element
        return { overflow: getComputedStyle(region).overflowX, scrolls: region.scrollWidth > region.clientWidth }
      })
      return { left: bounds.left, right: bounds.right, clipped, scrollRegions, fieldOverflow: fieldset.scrollWidth - fieldset.clientWidth }
    })
    expect(layout.left).toBeGreaterThanOrEqual(0)
    expect(layout.right).toBeLessThanOrEqual(viewportWidth)
    expect(layout.clipped, `clipped reading content at ${viewportWidth}px`).toEqual([])
    expect(layout.fieldOverflow).toBeLessThanOrEqual(1)
    expect(layout.scrollRegions).toEqual([{ overflow: 'auto', scrolls: true }, { overflow: 'auto', scrolls: true }])
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await detail.getByRole('button', { name: `기록 편집: ${title}` }).click()
  await expect(detail.getByRole('textbox', { name: '기록 제목' })).toHaveValue(title)
  await detail.getByRole('textbox', { name: '기록 제목' }).fill(`${title} 수정`)
  await detail.getByRole('textbox', { name: '요약', exact: true }).fill('자료를 확인하고 결과를 기록했습니다.')
  await detail.getByRole('button', { name: '저장', exact: true }).click()
  await expect(detail.getByRole('heading', { name: '근거' })).toBeVisible()
  await expect(detail.getByRole('textbox')).toHaveCount(0)
  await expect(detail.getByRole('heading', { name: `${title} 수정`, exact: true })).toBeVisible()
  for (const viewportWidth of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width: viewportWidth, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})
