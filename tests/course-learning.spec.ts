import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

import { courseLessons, courseNodeMap, courseStages } from '../src/data/courseCatalog'
import { advanceCourseForLiteracy, createEmptyCourseState, isLessonAvailable, prepareCourseQuestions, startCourseAtStage, submitLessonAttempt } from '../src/lib/courseEngine'
import { selectStudyBatch, type VocabularyEntry } from '../src/lib/curriculumContent'
import { getLiteracyReadiness, isStableLiteracyItem, recordLiteracyAnswer, recordReadingAttempt } from '../src/lib/literacyEngine'

async function answerQuestions(page: Page, answersByPrompt: Record<string, string>, count: number) {
  for (let index = 0; index < count; index += 1) {
    const prompt = (await page.locator('main h2').last().textContent())?.trim() ?? ''
    const answer = answersByPrompt[prompt]
    expect(answer, `missing answer for ${prompt}`).toBeTruthy()
    await page.locator(`[data-option-value=${JSON.stringify(answer)}]`).click()
    await page.getByRole('button', { name: index === count - 1 ? /查看结果/ : /下一题/ }).click()
  }
}

function createRemoteState(profileId: string) {
  return {
    version: 1,
    profileId,
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

async function useCourseProfile(page: Page, profileId: string) {
  let state: Record<string, unknown> = createRemoteState(profileId)
  await page.addInitScript((id) => {
    window.localStorage.setItem('yuru-nihongo-cloud-profile-id', id)
  }, profileId)
  await page.route('https://yuru-nihongo-study.vercel.app/api/app-state**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state }) })
      return
    }
    const body = route.request().postDataJSON() as { state?: Record<string, unknown> }
    if (body.state) state = body.state
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
}

test('new learner can finish the first course and resume the next step after reload', async ({ page }) => {
  await useCourseProfile(page, 'course-new-learner')
  await page.route('https://yuru-nihongo-study.vercel.app/api/translate', async (route) => {
    const body = route.request().postDataJSON() as { texts?: string[] }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ translations: (body.texts ?? []).map((text) => `中文：${text}`) }),
    })
  })
  await page.goto('/')

  await expect(page.getByRole('heading', { name: /不再收藏知识/ })).toBeVisible()
  await page.getByRole('button', { name: /我从零开始/ }).click()
  await expect(page.getByRole('heading', { name: '沿着一条路，今天再前进一步' })).toBeVisible()
  await expect(page.getByText('学会第一组平假名').first()).toBeVisible()

  await page.getByRole('link', { name: /开始今天的主课/ }).click()
  await expect(page).toHaveURL(/\/learn\/foundation-kana$/)
  await expect(page.getByRole('heading', { name: '学会第一组平假名' })).toBeVisible()

  await page.getByPlaceholder('输入罗马音').fill('a')
  await page.getByRole('button', { name: '检查回答' }).click()
  await page.getByRole('button', { name: /开始检测/ }).click()
  await answerQuestions(page, {
    '「あ」的读音是？': 'a',
    '「い」的读音是？': 'i',
    '「う」的读音是？': 'u',
    '「え」的读音是？': 'e',
    '「お」的读音是？': 'o',
    '「いえ」应该怎样读？': 'ie',
  }, 6)

  await expect(page.getByTestId('lesson-result')).toContainText('你已经完成本课')
  await page.getByRole('link', { name: /进入下一课/ }).click()
  await expect(page).toHaveURL(/\/learn\/foundation-kana-k$/)
  await expect(page.getByRole('heading', { name: '读出か行', level: 1 })).toBeVisible()
  await expect(page.getByTestId('lesson-result')).toHaveCount(0)
  await page.getByRole('link', { name: '返回学习首页' }).click()
  await expect(page.getByText('读出か行').first()).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: '沿着一条路，今天再前进一步' })).toBeVisible()
  await expect(page.getByText('读出か行').first()).toBeVisible()

  await page.getByRole('link', { name: '能力训练' }).click()
  await expect(page.getByRole('heading', { name: '先理解，再遮住回忆' })).toBeVisible()
  await expect(page.getByTestId('literacy-practice')).toContainText('假名读音')
  await page.getByRole('button', { name: /遮住答案，开始回忆/ }).click()
  await expect(page.getByRole('heading', { name: '看到日语，说出意思' })).toBeVisible()
})

test('a fresh installation creates its own cloud profile instead of sharing another learner state', async ({ page, browser }) => {
  await page.goto('/')

  await expect(page.getByRole('button', { name: /我从零开始/ })).toBeVisible()
  const storedProfileId = await page.evaluate(() => localStorage.getItem('yuru-nihongo-cloud-profile-id'))
  expect(storedProfileId).toBeTruthy()
  expect(storedProfileId).toMatch(/^[a-z0-9-]{16,64}$/)

  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()
  await secondPage.goto('/')
  await expect(secondPage.getByRole('button', { name: /我从零开始/ })).toBeVisible()
  const secondProfileId = await secondPage.evaluate(() => localStorage.getItem('yuru-nihongo-cloud-profile-id'))
  expect(secondProfileId).toBeTruthy()
  expect(secondProfileId).not.toBe(storedProfileId)
  await secondContext.close()
})

test('placement immediately assigns a conservative course entry', async ({ page }) => {
  await useCourseProfile(page, 'course-placement')
  await page.goto('/')

  await page.getByRole('button', { name: /先定位水平/ }).click()
  await expect(page.getByTestId('placement-panel')).toBeVisible()
  for (let index = 0; index < 10; index += 1) {
    const values = await page.locator('[data-option-value]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-option-value')).filter(Boolean) as string[],
    )
    const selected = index === 0 ? values.find((value) => value !== 'a') : values[0]
    expect(selected).toBeTruthy()
    await page.locator(`[data-option-value=${JSON.stringify(selected)}]`).click()
  }

  await expect(page.getByRole('heading', { name: '沿着一条路，今天再前进一步' })).toBeVisible()
  await expect(page.getByText('学会第一组平假名').first()).toBeVisible()
})

test('answer positions change and one immediate lesson cannot become stable mastery', () => {
  const lesson = courseLessons[0]
  const firstAttempt = prepareCourseQuestions(lesson.questions, `${lesson.id}:0`)
  const secondAttempt = prepareCourseQuestions(lesson.questions, `${lesson.id}:1`)

  expect(new Set(firstAttempt.map((question) => question.answerIndex)).size).toBeGreaterThan(1)
  expect(firstAttempt.map((question) => question.answerIndex)).not.toEqual(
    secondAttempt.map((question) => question.answerIndex),
  )

  const started = startCourseAtStage(createEmptyCourseState(), 0)
  const submitted = submitLessonAttempt(started, lesson.id, lesson.questions.map((question) => ({
    questionId: question.id,
    nodeId: question.nodeId,
    correct: true,
    elapsedMs: 2_000,
  })))

  expect(submitted.mastery[0].state).not.toBe('stable')
  expect(submitted.mastery[0].stabilityHours).toBeLessThanOrEqual(24)
})

test('the main curriculum remains complete, sequential and assessment-ready', () => {
  expect(courseLessons).toHaveLength(54)
  expect(new Set(courseLessons.map((lesson) => lesson.id)).size).toBe(courseLessons.length)
  expect(courseStages.map((stage) => courseLessons.filter((lesson) => lesson.level === stage.id).length))
    .toEqual([17, 9, 7, 7, 7, 7])

  courseLessons.forEach((lesson, index) => {
    expect(lesson.order).toBe(index + 1)
    expect(lesson.questions.length).toBeGreaterThanOrEqual(3)
    expect(lesson.nodeIds.every((nodeId) => courseNodeMap.has(nodeId))).toBe(true)
    expect(lesson.questions.every((question) => new Set(question.options).size === question.options.length)).toBe(true)
    expect(lesson.questions.every((question) => question.options.length === 4)).toBe(true)
    expect(lesson.prerequisiteLessonIds).toEqual(index === 0 ? [] : [courseLessons[index - 1].id])
  })
})

test('curriculum quality keeps lessons connected, task-based and free of listening requirements', () => {
  expect(courseStages.every((stage) => stage.canDo.length > 12 && stage.evidence.length > 12)).toBe(true)
  expect([...courseNodeMap.values()].some((node) => node.kind === ('listening' as never))).toBe(false)

  const integratedLessons = courseLessons.filter((lesson) => lesson.id.includes('-module-'))
  expect(integratedLessons).toHaveLength(20)
  integratedLessons.forEach((lesson) => {
    expect(lesson.nodeIds.length).toBeGreaterThanOrEqual(2)
    expect(lesson.examples.length).toBeGreaterThanOrEqual(2)
    expect(lesson.questions.length).toBeGreaterThanOrEqual(6)
    expect(lesson.mission.length).toBeGreaterThan(12)
    expect(lesson.transferTask.length).toBeGreaterThan(12)
  })
  expect([...courseNodeMap.values()].every((node) => node.prerequisiteNodeIds.length > 0 || node.id === 'kana.hiragana')).toBe(true)
})

test('ability training unlocks content with course progress instead of exposing the whole level', () => {
  const entries: VocabularyEntry[] = Array.from({ length: 20 }, (_, index) => ({
    id: `word-${index}`,
    level: 'N5',
    term: `词${index}`,
    reading: `ことば${index}`,
    meaningEn: `word ${index}`,
  }))
  const locked = selectStudyBatch(entries, 'vocabulary', 'foundation', [], 20, new Date('2026-07-14'), {
    currentLevel: 'foundation', stageProgressRatio: 0, learnedTexts: [], learnedPatterns: [],
  })
  const partlyUnlocked = selectStudyBatch(entries, 'vocabulary', 'foundation', [], 20, new Date('2026-07-14'), {
    currentLevel: 'foundation', stageProgressRatio: 0.25, learnedTexts: [], learnedPatterns: [],
  })

  expect(locked).toHaveLength(0)
  expect(partlyUnlocked).toHaveLength(5)
})

test('literacy mastery requires delayed recall instead of repeated same-session answers', () => {
  const startedAt = new Date('2026-07-14T00:00:00.000Z')
  const first = recordLiteracyAnswer({ itemProgress: [], readingAttempts: [] }, {
    itemId: 'word-test', kind: 'vocabulary', level: 'N5', correct: true, meaningZh: '测试',
  }, startedAt)
  const immediate = recordLiteracyAnswer(first, {
    itemId: 'word-test', kind: 'vocabulary', level: 'N5', correct: true, meaningZh: '测试',
  }, new Date('2026-07-14T00:02:00.000Z'))

  expect(isStableLiteracyItem(immediate.itemProgress[0])).toBe(false)
  expect(immediate.itemProgress[0].confidence).toBeLessThanOrEqual(0.58)

  let delayed = immediate
  for (const reviewedAt of ['2026-07-16T00:00:00.000Z', '2026-07-20T00:00:00.000Z', '2026-07-29T00:00:00.000Z', '2026-08-18T00:00:00.000Z']) {
    delayed = recordLiteracyAnswer(delayed, {
      itemId: 'word-test', kind: 'vocabulary', level: 'N5', correct: true, meaningZh: '测试',
    }, new Date(reviewedAt))
  }
  expect(isStableLiteracyItem(delayed.itemProgress[0])).toBe(true)
})

test('assisted reading never counts as unassisted reading evidence', () => {
  const started = startCourseAtStage(createEmptyCourseState(), 0)
  const assistedLiteracy = recordReadingAttempt(started.literacy, {
    passageId: 'assisted', level: 'foundation', accuracy: 1, charactersPerMinute: 120,
    usedReadingAid: true, usedTranslationAid: false,
  }, new Date('2026-07-14T00:00:00.000Z'))
  const unassistedLiteracy = recordReadingAttempt(assistedLiteracy, {
    passageId: 'unassisted', level: 'foundation', accuracy: 1, charactersPerMinute: 80,
    usedReadingAid: false, usedTranslationAid: false,
  }, new Date('2026-07-15T00:00:00.000Z'))
  const readiness = getLiteracyReadiness({ ...started, literacy: unassistedLiteracy }, 'foundation')

  expect(readiness.readingPasses).toBe(1)
  expect(readiness.charactersPerMinute).toBe(80)
})

test('repeating the same passage cannot inflate unassisted reading readiness', () => {
  const started = startCourseAtStage(createEmptyCourseState(), 0)
  const first = recordReadingAttempt(started.literacy, {
    passageId: 'same-passage', level: 'N5', accuracy: 1, charactersPerMinute: 70,
    usedReadingAid: false, usedTranslationAid: false,
  }, new Date('2026-07-14T00:00:00.000Z'))
  const repeated = recordReadingAttempt(first, {
    passageId: 'same-passage', level: 'N5', accuracy: 1, charactersPerMinute: 90,
    usedReadingAid: false, usedTranslationAid: false,
  }, new Date('2026-07-15T00:00:00.000Z'))

  expect(getLiteracyReadiness({ ...started, literacy: repeated }, 'N5').readingPasses).toBe(1)
})

test('the next course stage stays locked until real literacy evidence reaches the graduation target', () => {
  const foundationLessonIds = courseStages[0].lessonIds
  const lastLesson = courseLessons.find((lesson) => lesson.id === foundationLessonIds.at(-1))!
  const nextStageLesson = courseLessons.find((lesson) => lesson.id === courseStages[1].lessonIds[0])!
  const started = startCourseAtStage(createEmptyCourseState(), 0)
  const atBoundary = {
    ...started,
    profile: { ...started.profile!, activeLessonId: lastLesson.id },
    lessonProgress: foundationLessonIds.slice(0, -1).map((lessonId) => ({
      lessonId, status: 'completed' as const, attempts: 1, bestScore: 1,
    })),
  }
  const completedLessons = submitLessonAttempt(atBoundary, lastLesson.id, lastLesson.questions.map((question) => ({
    questionId: question.id, nodeId: question.nodeId, correct: true, elapsedMs: 1_500,
  })))

  expect(completedLessons.profile?.activeLessonId).toBe(lastLesson.id)
  expect(isLessonAvailable(completedLessons, nextStageLesson.id)).toBe(false)

  const reviewedAt = '2026-07-14T00:00:00.000Z'
  const readyState = {
    ...completedLessons,
    literacy: {
      itemProgress: Array.from({ length: 50 }, (_, index) => ({
        itemId: `word-ready-${index}`,
        kind: 'vocabulary' as const,
        level: 'N5' as const,
        confidence: 0.9,
        stabilityHours: 72,
        correctCount: 3,
        incorrectCount: 0,
        lastReviewedAt: reviewedAt,
        nextReviewAt: '2026-07-17T00:00:00.000Z',
      })),
      readingAttempts: [0, 1].map((index) => ({
        id: `reading-ready-${index}`,
        passageId: `passage-${index}`,
        level: 'foundation' as const,
        accuracy: 1,
        charactersPerMinute: 50,
        usedReadingAid: false,
        usedTranslationAid: false,
        completedAt: reviewedAt,
      })),
    },
  }
  const promoted = advanceCourseForLiteracy(readyState)

  expect(promoted.profile?.activeLessonId).toBe(nextStageLesson.id)
  expect(isLessonAvailable(promoted, nextStageLesson.id)).toBe(true)
})

test('open curriculum contains enough vocabulary, kanji and grammar for the declared N1 targets', () => {
  const load = (name: string) => JSON.parse(readFileSync(new URL(`../public/curriculum/${name}.json`, import.meta.url), 'utf8')) as unknown[]
  expect(load('vocabulary').length).toBeGreaterThanOrEqual(7_500)
  expect(load('kanji').length).toBeGreaterThanOrEqual(1_800)
  expect(load('grammar').length).toBeGreaterThanOrEqual(700)
})
