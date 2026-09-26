import { expect, test } from '@playwright/test'
import { signInAs } from './helpers'

test('uses the same page-panel heading and action rules across primary tabs', async ({ page }, testInfo) => {
  await signInAs(page, 'e2e-owner@example.com')
  const tabs = [
    ['overview', '자산'],
    ['allocation', '태그별 배분'],
    ['tasks', '할 일과 기록'],
    ['strategy', '현재 원칙'],
  ]
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [hash, title] of tabs) {
      await page.goto(`/#${hash}`)
      const panel = page.locator('.page-panel').filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) })
      await expect(panel).toBeVisible()
      const heading = panel.getByRole('heading', { level: 2, name: title, exact: true })
      await expect.poll(() => heading.evaluate((node) => {
        const style = getComputedStyle(node)
        return [style.fontSize, style.fontWeight, style.lineHeight, style.color]
      })).toEqual(['18px', '600', '28px', 'rgb(236, 236, 239)'])
      const trigger = panel.getByRole('button', { name: `${title} 작업 메뉴` })
      await expect(trigger).toBeVisible()
      const style = await trigger.evaluate((node) => {
          const value = getComputedStyle(node)
          const box = node.getBoundingClientRect()
          const panelBox = node.closest('.page-panel').getBoundingClientRect()
          return { height: box.height, width: box.width, right: box.right, panelRight: panelBox.right, radius: value.borderRadius }
        })
      expect(style.height).toBe(44)
      expect(style.width).toBe(44)
      expect(style.right).toBeLessThanOrEqual(style.panelRight - 15)
      expect(style.radius).toBe('12px')
      if (width >= 768) {
          const offset = await trigger.evaluate((node) => {
            const title = node.closest('.page-panel__header').querySelector('h2').getBoundingClientRect()
            const action = node.getBoundingClientRect()
            return Math.abs((title.top + title.bottom) / 2 - (action.top + action.bottom) / 2)
          })
          expect(offset).toBeLessThanOrEqual(1)
      }
      await expect(panel.getByRole('group', { name: `${title} 작업` })).toBeHidden()
      const supporting = panel.locator('.page-panel__supporting')
      if (await supporting.count()) {
        const gap = await supporting.evaluate((node) => node.getBoundingClientRect().top - node.previousElementSibling.getBoundingClientRect().bottom)
        expect(gap).toBeLessThanOrEqual(8)
      }
      if (hash === 'overview') {
        await expect(panel.locator('.type-summary-value')).toHaveCount(0)
        await expect(panel.locator('.page-panel__supporting')).toContainText('평가액')
        await expect(panel).not.toContainText('가장 최근 시세 기준일')
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      if (width === 390 || width === 1024) await panel.screenshot({ path: testInfo.outputPath(`${hash}-${width}.png`) })
    }
  }
})

test('opens each card action menu and closes it with Escape', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  for (const [hash, title, labels] of [
    ['overview', '자산', ['가격 갱신', '종목 추가', '계좌 추가', '표 편집']],
    ['allocation', '태그별 배분', ['태그 관리']],
    ['tasks', '할 일과 기록', ['태그 관리', '활동 추가']],
    ['strategy', '현재 원칙', []],
  ]) {
    await page.goto(`/#${hash}`)
    const panel = page.locator('.page-panel').filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) })
    const trigger = panel.getByRole('button', { name: `${title} 작업 메뉴` })
    await trigger.click()
    const menu = panel.getByRole('group', { name: `${title} 작업` })
    await expect(menu).toBeVisible()
    for (const label of labels) await expect(menu.getByRole('button', { name: label })).toBeVisible()
    if (hash === 'strategy') await expect(menu.getByRole('button', { name: /^(원칙 작성|수정)$/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()
  }
})

test('aligns desktop asset and allocation column header heights', async ({ page }) => {
  await signInAs(page, 'e2e-owner@example.com')
  for (const width of [768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/#overview')
    const assetHeader = page.getByRole('region', { name: '자산 종목' }).locator('.list-column-header')
    await expect(assetHeader).toBeVisible()
    const assetHeight = await assetHeader.evaluate((element) => element.getBoundingClientRect().height)
    await page.goto('/#allocation')
    const allocationHeader = page.getByRole('region', { name: '태그별 현재 및 목표 비중' }).locator('.list-column-header')
    await expect(allocationHeader).toBeVisible()
    const allocationHeight = await allocationHeader.evaluate((element) => element.getBoundingClientRect().height)
    expect(assetHeight).toBe(36)
    expect(allocationHeight).toBe(assetHeight)
    const allocationTopGap = await allocationHeader.evaluate((element) => element.getBoundingClientRect().top - element.parentElement.getBoundingClientRect().top)
    expect(allocationTopGap).toBeLessThanOrEqual(2)
  }
})
