import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function isolateProfile(page: Page, offline = false) {
  let state: Record<string, unknown> | null = null
  await page.addInitScript(() => localStorage.setItem('yuru-nihongo-cloud-profile-id', 'reading-ui-test'))
  await page.route('**/api/app-state**', async (route) => {
    if (offline) return route.abort()
    if (route.request().method() === 'PUT') state = route.request().postDataJSON().state
    await route.fulfill({ json: route.request().method() === 'PUT' ? { ok: true } : { state } })
  })
  // UI tests never contact or modify the user's cloud media library.
  await page.route('**/api/published*', (route) => route.fulfill({ json: { lessons: [] } }))
}

test('new course resumes steps, conceals answers, and advances only after the whole day', async ({ page }) => {
  await isolateProfile(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('看得懂')
  await expect(page.locator('a[href^="/course/"]')).toHaveCount(22)
  await page.getByRole('link', { name: '开始第 1 天' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('把平假名认成词')
  await page.getByRole('button', { name: '完成这一步，继续' }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('先建立字形对应')
  await page.getByRole('button', { name: '遮住右栏，试着回想' }).click()
  await expect(page.locator('tbody tr').first().locator('td').last()).toBeHidden()
  await page.getByRole('button', { name: '显示右栏，核对答案' }).click()
  await expect(page.locator('tbody tr').first().locator('td').last()).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('先建立字形对应')
  await page.getByRole('button', { name: /06.*收束/ }).click()
  await expect(page.getByRole('button', { name: '继续未完成的步骤' })).toBeVisible()
  await page.getByRole('button', { name: '继续未完成的步骤' }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('先建立字形对应')
  await page.getByRole('button', { name: '完成这一步，继续' }).click()
  await page.getByRole('button', { name: '完成这一步，继续' }).click()
  await expect(page.locator('article details')).toHaveCount(1)
  await expect(page.locator('article details')).not.toHaveAttribute('open')
  await page.locator('article summary').click()
  await expect(page.locator('article details')).toHaveAttribute('open', '')
  await page.getByRole('button', { name: '完成这一步，继续' }).click()
  await expect(page.locator('article details')).not.toHaveAttribute('open')
  await page.getByRole('button', { name: '完成这一步，继续' }).click()
  await page.getByRole('button', { name: '完成今天的学习' }).click()
  await expect(page.getByRole('heading', { name: '今天就到这里。' })).toBeVisible()
  await page.getByRole('link', { name: '回到学习路线' }).click()
  await expect(page.getByRole('link', { name: '继续第 2 天' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('link', { name: '继续第 2 天' })).toBeVisible()
})

test('every authored section, table, reading passage and answer is available across all 21 days', async ({ page }) => {
  test.setTimeout(180_000)
  await isolateProfile(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (let day = 1; day <= 21; day++) {
    const source = readFileSync(`learning-materials/02-course-design/lessons/${String(day).padStart(2, '0')}.md`, 'utf8')
    const sections = source.trim().split(/^## /m).slice(1)
    await page.goto(`/course/${day}`)
    const steps = page.getByRole('navigation', { name: '本课步骤' }).getByRole('button')
    await expect(steps).toHaveCount(sections.length + 1)
    for (let index = 0; index < sections.length; index++) {
      const section = sections[index]
      await steps.nth(index + 1).click()
      await expect(page.locator('article > h2')).toHaveText(section.split('\n')[0].replace(/^\d+\.\s*/, ''))
      await expect(page.locator('article details')).toHaveCount((section.match(/<details>/g) ?? []).length)
      await expect(page.locator('article tbody tr')).toHaveCount(Math.max(0, section.split('\n').filter((line) => line.startsWith('|')).length - (section.match(/^\| ---/gm) ?? []).length * 2))
      for (const line of section.split('\n').filter((line) => /^> .+/.test(line))) {
        await expect(page.locator('article blockquote')).toContainText([line.slice(2)])
      }
      await expect(page.locator('article a[href*=".md"], article a[href*=".html"]')).toHaveCount(0)
    }
  }
  expect(errors).toEqual([])
})

test('mobile layout fits and progress survives offline reload', async ({ page }) => {
  await isolateProfile(page, true)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('link', { name: '开始第 1 天' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: 'test-results/reading-home-mobile.png', fullPage: true })
  await page.getByRole('link', { name: '开始第 1 天' }).click()
  await page.getByRole('button', { name: '完成这一步，继续' }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('先建立字形对应')
  await page.reload()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('先建立字形对应')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: 'test-results/reading-lesson-mobile.png', fullPage: true })
})

test('desktop and unknown course link', async ({ page }) => {
  await isolateProfile(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('link', { name: '开始第 1 天' })).toBeVisible()
  await page.screenshot({ path: 'test-results/reading-home-desktop.png', fullPage: true })
  await page.goto('/course/12')
  await page.getByRole('button', { name: /04.*四种关系必须分清/ }).click()
  await expect(page.locator('article')).toContainText('行かなくてもいい')
  await page.screenshot({ path: 'test-results/reading-lesson-desktop.png', fullPage: true })
  await page.goto('/course/999')
  await expect(page.getByRole('heading', { name: '没有找到这一天的课程' })).toBeVisible()
})
