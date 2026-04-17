import { expect, test, type Page } from '@playwright/test'

const gibberishPattern =
  /鐗囦腑鍘熷彞|渚嬪彞|鍒犻櫎|璇硶|璇嶅彞|鍏抽棴|鍗曡瘝|鏃ヨ瀛︿範鐭棰戞祦/

const longText = `超长标题回归测试${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(8)}${'这是为了验证卡片边界和换行策略'.repeat(4)}`

async function seedLocalClip(page: Page, overrides?: Record<string, unknown>) {
  await page.goto('/favicon.svg')

  await page.evaluate(
    async ({ longTextValue, overridesValue }) => {
      const openDb = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('yuru-nihongo-db', 1)

          request.onupgradeneeded = () => {
            const db = request.result
            const stores = [
              'favorites',
              'notes',
              'goals',
              'study_events',
              'review_items',
              'review_logs',
              'vocab_progress',
              'imported_clips',
              'app_settings',
            ]

            for (const store of stores) {
              if (!db.objectStoreNames.contains(store)) {
                db.createObjectStore(store, { keyPath: 'id' })
              }
            }
          }

          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })

      const runWriteTransaction = (db: IDBDatabase, blob: Blob) =>
        new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(['imported_clips', 'app_settings'], 'readwrite')
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error)
          transaction.onabort = () => reject(transaction.error)

          const importedClips = transaction.objectStore('imported_clips')
          importedClips.clear()

          const appSettings = transaction.objectStore('app_settings')
          appSettings.put({
            id: 'settings',
            remindersEnabled: false,
            showRomaji: true,
            showPlaybackKnowledge: true,
            showJapaneseSubtitle: true,
            showChineseSubtitle: true,
            accentMode: 'macaron',
          })

          importedClips.put({
            id: 'clip-regression-test',
            title: longTextValue,
            theme: longTextValue,
            difficulty: 'Custom',
            importMode: 'sliced',
            sourceType: 'local',
            sourceIdOrBlobKey: 'blob-regression-test',
            sourceFileName: 'hare-waiting.webm',
            sourceUrl: '',
            sourceProvider: `${longTextValue} / 来源文字也必须被正确包裹显示`,
            cover: '/videos/covers/hare-waiting.jpg',
            durationMs: 6000,
            clipStartMs: 1000,
            clipEndMs: 7000,
            fileType: blob.type || 'video/webm',
            blob,
            createdAt: new Date().toISOString(),
            segments: [
              {
                startMs: 0,
                endMs: 3000,
                ja: '少し待ってみよう。',
                kana: 'すこし まって みよう。',
                romaji: 'sukoshi matte miyou.',
                zh: '先稍微等等看。',
                focusTermIds: ['point-1'],
              },
              {
                startMs: 3000,
                endMs: 6000,
                ja: 'まだ間に合うよ。',
                kana: 'まだ まにあう よ。',
                romaji: 'mada maniau yo.',
                zh: '现在还来得及。',
                focusTermIds: ['point-2'],
              },
            ],
            knowledgePoints: [
              {
                id: 'point-1',
                kind: 'grammar',
                expression: '〜てみよう',
                reading: '〜てみよう',
                meaningZh: '试着……吧',
                partOfSpeech: '语法',
                explanationZh: '表示先尝试做做看，语气自然又常用。',
                exampleJa: '使ってみよう。',
                exampleZh: '试着用一下吧。',
              },
              {
                id: 'point-2',
                kind: 'word',
                expression: '間に合う',
                reading: 'まにあう',
                meaningZh: '来得及 / 赶得上',
                partOfSpeech: '动词',
                explanationZh: '经常用于时间紧张但仍有机会赶上的场景。',
                exampleJa: 'まだ間に合う。',
                exampleZh: '现在还来得及。',
              },
            ],
            tags: [longTextValue, '回归测试'],
            description: `${longTextValue}。这是一段用于验证卡片内所有文字都不会溢出的说明文字。`,
            creditLine: `${longTextValue}。这是一段用于验证来源说明、长标题和长描述都不会把卡片撑破的文案。`,
            ...(overridesValue ?? {}),
          })
        })

      const blob = await fetch('/videos/clips/hare-waiting.webm').then((response) => response.blob())
      const db = await openDb()
      await runWriteTransaction(db, blob)
      db.close()
    },
    { longTextValue: longText, overridesValue: overrides ?? {} },
  )
}

test('首页卡片保持中文文案且长文本不会溢出卡片', async ({ page }) => {
  await seedLocalClip(page)
  await page.goto('/')

  await expect(page.getByTestId('lesson-card')).toBeVisible()
  await expect(page.getByTestId('home-feed')).toBeVisible()

  const pageText = await page.locator('body').textContent()
  expect(pageText ?? '').not.toMatch(gibberishPattern)

  const overflowReport = await page.getByTestId('lesson-card').evaluate((card) => {
    const cardRect = card.getBoundingClientRect()
    const nodes = Array.from(
      card.querySelectorAll<HTMLElement>(
        '[data-testid="lesson-title"], [data-testid="lesson-description"], .chip, strong, p, small, span',
      ),
    )

    return nodes
      .map((node) => {
        const rect = node.getBoundingClientRect()
        return {
          text: (node.textContent || '').trim().slice(0, 48),
          visible: rect.width > 0 && rect.height > 0,
          overflowRight: rect.right - cardRect.right,
          overflowLeft: cardRect.left - rect.left,
        }
      })
      .filter((item) => item.visible && (item.overflowRight > 1 || item.overflowLeft > 1))
  })

  expect(overflowReport).toEqual([])
})

test('可播放的本地切片不会再误触发 FFmpeg 预处理', async ({ page }) => {
  await seedLocalClip(page)

  const ffmpegRequests: string[] = []
  page.on('request', (request) => {
    if (/ffmpeg/i.test(request.url())) {
      ffmpegRequests.push(request.url())
    }
  })

  await page.goto('/')
  await page.getByRole('button', { name: '开始学习这段' }).click()

  const video = page.locator('video').first()
  await expect(video).toBeVisible()
  await expect
    .poll(async () => {
      return video.evaluate((element) => (element as HTMLVideoElement).readyState)
    })
    .toBeGreaterThanOrEqual(2)

  await page.waitForTimeout(1200)
  expect(ffmpegRequests).toEqual([])
  await expect(page.getByText('正在截取当前学习片段…')).toHaveCount(0)
})

test('竖屏页保持短视频流布局，视频区域是视觉主角', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedLocalClip(page)
  await page.goto('/immersive')

  const stage = page.getByTestId('immersive-stage')
  const actionRail = page.getByTestId('immersive-action-rail')
  const infoCard = page.getByTestId('immersive-info')

  await expect(stage).toBeVisible()
  await expect(actionRail).toBeVisible()
  await expect(infoCard).toBeVisible()

  const metrics = await Promise.all([
    stage.boundingBox(),
    actionRail.boundingBox(),
    infoCard.boundingBox(),
    page.evaluate(() => {
      const stageElement = document.querySelector('[data-testid="immersive-stage"]')
      const actionRailElement = document.querySelector('[data-testid="immersive-action-rail"]')
      const infoCardElement = document.querySelector('[data-testid="immersive-info"]')

      return {
        actionRailInsideStage: Boolean(stageElement && actionRailElement && stageElement.contains(actionRailElement)),
        infoCardInsideStage: Boolean(stageElement && infoCardElement && stageElement.contains(infoCardElement)),
      }
    }),
    page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })),
  ])

  const [stageBox, actionRailBox, infoCardBox, containment, viewport] = metrics

  expect(stageBox).not.toBeNull()
  expect(actionRailBox).not.toBeNull()
  expect(infoCardBox).not.toBeNull()

  expect((stageBox?.height ?? 0) / viewport.height).toBeGreaterThan(0.68)
  expect(containment.actionRailInsideStage).toBe(true)
  expect(containment.infoCardInsideStage).toBe(true)
  expect(actionRailBox?.right ?? 0).toBeLessThanOrEqual((stageBox?.right ?? 0) + 1)
  expect(infoCardBox?.bottom ?? 0).toBeLessThanOrEqual((stageBox?.bottom ?? 0) + 1)
})

test('导入视频生成的封面不再带无意义英文水印', async ({ page }) => {
  await page.goto('/')

  const cover = await page.evaluate(async () => {
    const { useAppStore } = await import('/src/store/useAppStore.ts')
    const blob = await fetch('/videos/clips/hare-waiting.webm').then((response) => response.blob())
    const file = new File([blob], 'hare-waiting.webm', { type: blob.type || 'video/webm' })
    const clip = await useAppStore.getState().importClip({
      file,
      title: '封面回归测试',
      theme: '视频封面',
    })

    return clip.cover
  })

  const decoded = decodeURIComponent(cover)
  expect(decoded).not.toContain('Local Original Study Clip')
  expect(decoded).not.toContain('Official Clip Micro Lesson')
  expect(decoded).not.toContain('Auto-synced study clip')
})
