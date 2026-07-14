import { expect, test, type Page } from '@playwright/test'

import type { ImportedClip, StudyIndex, TranscriptSegment } from '../src/types'

const gibberishPattern =
  /鐗囦腑鍘熷彞|渚嬪彞|鍒犻櫎|璇硶|璇嶅彞|鍏抽棴|鍗曡瘝|鏃ヨ瀛︿範鐭棰戞祦/

const longText = `超长标题回归测试${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(8)}${'这是为了验证卡片边界和换行策略'.repeat(4)}`

function buildRemoteState(importedClips: ImportedClip[]) {
  return {
    version: 1,
    profileId: 'profile-test',
    updatedAt: new Date().toISOString(),
    favorites: [],
    notes: [],
    goal: {
      id: 'daily-goals',
      videosTarget: 1,
      wordsTarget: 5,
      grammarTarget: 1,
      reviewTarget: 3,
      updatedAt: new Date().toISOString(),
    },
    studyEvents: [],
    reviewItems: [],
    reviewLogs: [],
    vocabProgress: [],
    importedClips,
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

async function seedRemoteClips(page: Page, importedClips: ImportedClip[]) {
  const state = buildRemoteState(importedClips)
  await page.addInitScript(() => {
    window.localStorage.setItem('yuru-nihongo-cloud-profile-id', 'profile-test')
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

function buildStudyIndex(segments: TranscriptSegment[], quality: StudyIndex['quality']): StudyIndex {
  return {
    version: 1,
    videoId: 'clip-profile-source',
    status: quality === 'trusted' ? 'ready' : 'needsReview',
    quality,
    sourceLabel: quality === 'trusted' ? '用户已确认字幕' : '自动字幕草稿',
    generatedAt: new Date().toISOString(),
    transcript: segments.map((segment, index) => ({
      id: `cue-${index + 1}`,
      startMs: segment.startMs,
      endMs: segment.endMs,
      ja: segment.ja,
      zh: segment.zh,
      kana: segment.kana,
      romaji: segment.romaji,
      termOccurrenceIds: [],
      grammarOccurrenceIds: [],
    })),
    termOccurrences: [],
    grammarOccurrences: [],
    summary: {
      cueCount: segments.length,
      termCount: 0,
      grammarCount: 0,
      trusted: quality === 'trusted',
    },
  }
}

function buildProfileClip(overrides: Partial<ImportedClip> = {}): ImportedClip {
  const segments =
    overrides.segments ??
    [
      {
        startMs: 0,
        endMs: 3200,
        ja: 'これはテストです。',
        kana: 'これは てすと です。',
        romaji: 'kore wa tesuto desu.',
        zh: '这是测试。',
        focusTermIds: [],
      },
    ]

  return {
    id: 'clip-profile-source',
    title: '整片上传测试',
    theme: '日语原片',
    difficulty: 'Custom',
    importMode: 'raw',
    sourceType: 'local',
    sourceIdOrBlobKey: 'local-video:clip-profile-source',
    sourceFileName: 'source.mp4',
    sourceUrl: '',
    sourceProvider: '本地原片 / 本地草稿',
    cover: '/videos/covers/hare-waiting.jpg',
    durationMs: 180000,
    fileType: 'video/mp4',
    subtitleFileName: 'source.srt',
    subtitleSource: 'manual',
    studyIndex: buildStudyIndex(segments, 'trusted'),
    createdAt: new Date().toISOString(),
    segments,
    knowledgePoints: [],
    tags: ['私有原片', '字幕时间轴', '字幕已确认', '本地草稿'],
    description: '整片字幕时间轴测试素材。',
    creditLine: '视频暂存在当前浏览器。',
    ...overrides,
  }
}

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
  await page.goto('/discover')

  await expect(page.getByTestId('lesson-card')).toBeVisible({ timeout: 15_000 })
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

  await page.goto('/discover')
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

test('我的页把整片上传任务和已生成学习切片分开展示', async ({ page }) => {
  const sourceSegments: TranscriptSegment[] = [
    {
      startMs: 0,
      endMs: 3200,
      ja: 'これはテストです。',
      kana: 'これは てすと です。',
      romaji: 'kore wa tesuto desu.',
      zh: '这是测试。',
      focusTermIds: [],
    },
  ]
  const sourceClip = buildProfileClip({
    id: 'clip-profile-source',
    title: '源视频一号',
    segments: sourceSegments,
    studyIndex: buildStudyIndex(sourceSegments, 'trusted'),
  })
  const generatedSlice = buildProfileClip({
    id: 'clip-grammar-profile-source-slice-1',
    title: '源视频一号 - テスト',
    importMode: 'sliced',
    sourceClipId: sourceClip.id,
    sourceUrl: 'https://cdn.example.com/site-videos/source.mp4',
    sourceIdOrBlobKey: 'site-videos/source.mp4',
    sourceProvider: '本地原片 / 字幕切片 / 按需生成',
    tags: ['学习切片', '按需语法切片', '站内存储'],
  })

  await seedRemoteClips(page, [generatedSlice, sourceClip])
  await page.goto('/profile')

  await expect(page.getByTestId('source-clip-list')).toContainText('源视频一号')
  await expect(page.getByTestId('source-clip-list')).not.toContainText('源视频一号 - テスト')
  await expect(page.getByTestId('generated-slice-summary')).toContainText('1 条')
})

test('字幕预览编辑器只渲染可视字幕行', async ({ page }) => {
  const longSegments: TranscriptSegment[] = Array.from({ length: 640 }, (_, index) => ({
    startMs: index * 2200,
    endMs: index * 2200 + 1800,
    ja: `長い字幕テスト ${index + 1}`,
    kana: `ながい じまく てすと ${index + 1}`,
    romaji: `nagai jimaku tesuto ${index + 1}`,
    zh: `长字幕测试 ${index + 1}`,
    focusTermIds: [],
  }))
  const sourceClip = buildProfileClip({
    title: '长字幕整片',
    segments: longSegments,
    studyIndex: buildStudyIndex(longSegments, 'draft'),
    tags: ['私有原片', '字幕时间轴', '字幕待校对', '本地草稿'],
  })

  await seedRemoteClips(page, [sourceClip])
  await page.goto('/profile')
  await page.getByRole('button', { name: '预览/编辑字幕' }).click()

  const reviewDialog = page.getByRole('dialog')
  await expect(reviewDialog).toBeVisible()
  await expect(reviewDialog).toContainText('共 640 条字幕')
  await expect(reviewDialog).toContainText('正在显示')

  const renderedRows = await page.getByTestId('subtitle-review-row').count()
  expect(renderedRows).toBeGreaterThan(0)
  expect(renderedRows).toBeLessThan(80)
})

test('新人从导入整片到确认字幕再上传站点的链路可靠', async ({ page }) => {
  let savedState = buildRemoteState([])
  let uploadTicketRequested = false
  let videoUploaded = false

  await page.addInitScript(() => {
    window.localStorage.setItem('yuru-nihongo-cloud-profile-id', 'new-user-flow-test')
  })
  await page.route('https://yuru-nihongo-study.vercel.app/api/app-state**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ state: savedState }),
      })
      return
    }

    const body = route.request().postDataJSON() as { state?: ReturnType<typeof buildRemoteState> }
    if (body.state) {
      savedState = body.state
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    })
  })
  await page.route('https://yuru-nihongo-study.vercel.app/api/translate', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ translations: ['先稍微等等看。', '现在还来得及。', '这样就没问题。'] }),
    })
  })
  await page.route('https://yuru-nihongo-study.vercel.app/api/video-upload', async (route) => {
    uploadTicketRequested = true
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        uploadUrl: 'https://upload.example.com/site-videos/new-user-flow.webm',
        url: 'https://cdn.example.com/site-videos/new-user-flow.webm',
        pathname: 'site-videos/new-user-flow.webm',
        contentType: 'video/webm',
        provider: 'r2',
      }),
    })
  })
  await page.route('https://upload.example.com/**', async (route) => {
    videoUploaded = true
    await route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': '*',
      },
      body: '',
    })
  })

  await page.goto('/profile')
  await expect(page.getByRole('button', { name: '导入整片并生成字幕' })).toBeDisabled()

  await page.locator('input[type="file"]').nth(0).setInputFiles('public/videos/clips/hare-waiting.webm')
  await page.locator('input[type="file"]').nth(1).setInputFiles('tests/fixtures/new-user-upload.srt')
  await expect(page.getByText('本次导入队列')).toBeVisible()
  await expect(page.getByText('字幕：new-user-upload.srt')).toBeVisible()

  await page.getByRole('button', { name: '导入整片并生成字幕' }).click()
  await expect(page.getByTestId('source-clip-list')).toContainText('hare-waiting')
  await expect(page.getByTestId('source-clip-list')).toContainText('本地草稿')
  await expect(page.getByText('本次导入队列')).toHaveCount(0)

  await page.getByRole('button', { name: '预览/编辑字幕' }).click()
  const reviewDialog = page.getByRole('dialog')
  await expect(reviewDialog).toBeVisible()
  await expect(reviewDialog).toContainText('共 3 条字幕')
  await expect(reviewDialog).toContainText('少し待ってみよう。')

  const firstReviewRow = page.getByTestId('subtitle-review-row').nth(0)
  await firstReviewRow.locator('textarea').nth(1).fill('先等等看，我已校对。')
  await page.getByRole('button', { name: '保存并标记可信' }).click()
  await expect(reviewDialog).toHaveCount(0)
  await expect(page.getByTestId('source-clip-list')).toContainText('字幕可信')
  await expect(page.getByRole('button', { name: '上传整片到站点' })).toBeVisible()

  await page.getByRole('button', { name: '上传整片到站点' }).click()
  await expect(page.getByTestId('source-clip-list')).toContainText('站点已上传')
  await expect(page.getByTestId('source-clip-list')).toContainText('已上传到站点')
  expect(uploadTicketRequested).toBe(true)
  expect(videoUploaded).toBe(true)
  expect(savedState.importedClips[0]?.sourceUrl).toBe('https://cdn.example.com/site-videos/new-user-flow.webm')
})
