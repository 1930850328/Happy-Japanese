import { expect, test, type Page } from '@playwright/test'

function buildEmptyRemoteState() {
  return {
    version: 1,
    profileId: 'ux-regression',
    updatedAt: new Date().toISOString(),
    favorites: [],
    notes: [],
    goal: {
      id: 'daily-goals',
      videosTarget: 2,
      wordsTarget: 5,
      grammarTarget: 1,
      reviewTarget: 4,
      updatedAt: new Date().toISOString(),
    },
    studyEvents: [],
    reviewItems: [],
    reviewLogs: [],
    vocabProgress: [],
    importedClips: [],
    settings: {
      id: 'settings',
      remindersEnabled: false,
      showRomaji: true,
      showPlaybackKnowledge: true,
      showJapaneseSubtitle: true,
      showChineseSubtitle: true,
      accentMode: 'macaron',
    },
  }
}

async function useCleanProfile(page: Page) {
  const state = buildEmptyRemoteState()

  await page.addInitScript(() => {
    window.localStorage.setItem('yuru-nihongo-cloud-profile-id', 'ux-regression')
  })

  await page.route('https://yuru-nihongo-study.vercel.app/api/app-state**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ state }),
      })
      return
    }

    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })
}

test.beforeEach(async ({ page }) => {
  await useCleanProfile(page)
})

test('route navigation resets scroll to the top of the next page', async ({ page }) => {
  await page.goto('/vocab')
  await expect(page.getByRole('heading', { name: '一张卡片只记一个最值得脱口而出的词' })).toBeVisible()

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200)

  await page.getByRole('link', { name: '我的' }).click()
  await expect(page.getByRole('heading', { name: '管理今天的学习节奏' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
})

test('review page explains newly scheduled review items instead of saying they disappeared', async ({
  page,
}) => {
  await page.goto('/vocab')
  await page.getByPlaceholder('搜索日文、假名、罗马音或中文释义').fill('ありがとう')

  const card = page.locator('article').filter({ hasText: 'ありがとう' })
  await expect(card).toHaveCount(1)
  await card.getByRole('button', { name: '加入复习' }).click()

  await page.getByRole('link', { name: '复习' }).click()
  await expect(page.getByText('已排入复习计划')).toBeVisible()
  await expect(page.getByText('今天的复习已经清空啦')).toHaveCount(0)
  await expect(page.getByText('ありがとう')).toBeVisible()
})

test('fallback text analysis romanizes common kanji words instead of leaking kanji into romaji', async ({
  page,
}) => {
  await page.goto('/notes')
  await page
    .getByPlaceholder('例如：すみません、もう一度お願いします。')
    .fill('すみません、駅はどこですか。')
  await page.getByRole('button', { name: '立即解析' }).click()

  await expect(page.getByText('sumimasen, eki wa doko desu ka.')).toBeVisible()
  await expect(page.getByText('駅hadokodesuka')).toHaveCount(0)
})

test('immersive flow exposes controls for the active slide only', async ({ page }) => {
  await page.goto('/immersive')
  await expect(page.getByTestId('immersive-action-rail')).toBeVisible()
  await expect(page.getByRole('button', { name: '加复习' })).toHaveCount(1)
})
