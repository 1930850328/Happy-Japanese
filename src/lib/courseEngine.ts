import { courseLessonMap, courseLessons, courseStages } from '../data/courseCatalog'
import type {
  CourseEvidence,
  CourseEvidenceSource,
  CourseLessonProgress,
  CourseMastery,
  CourseMasteryState,
  CoursePlacement,
  CourseQuestion,
  CourseState,
} from '../types'
import { getLiteracyReadiness } from './literacyEngine'
import { createEmptyLiteracyState } from './literacyEngine'

export interface CourseAnswerResult {
  questionId: string
  nodeId: string
  correct: boolean
  elapsedMs: number
}

export const COURSE_POLICY = {
  lessonPassScore: 0.8,
  stableConfidence: 0.82,
  reviewingConfidence: 0.45,
  maxEvidenceRecords: 2_000,
} as const

function hashSeed(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededShuffle<T>(items: T[], seed: string) {
  const result = [...items]
  let state = hashSeed(seed) || 1
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const target = state % (index + 1)
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

export function prepareCourseQuestions(
  questions: CourseQuestion[],
  attemptSeed: string,
  shuffleQuestions = true,
) {
  const orderedQuestions = shuffleQuestions
    ? seededShuffle(questions, `${attemptSeed}:questions`)
    : questions
  return orderedQuestions.map((question) => {
    const correctOption = question.options[question.answerIndex]
    const options = seededShuffle(question.options, `${attemptSeed}:${question.id}:options`)
    return {
      ...question,
      options,
      answerIndex: options.indexOf(correctOption),
    }
  })
}

export function createEmptyCourseState(): CourseState {
  return {
    version: 1,
    lessonProgress: [],
    mastery: [],
    evidence: [],
    literacy: createEmptyLiteracyState(),
    updatedAt: new Date().toISOString(),
  }
}

export function normalizeCourseState(state: CourseState): CourseState {
  const reviewedNodeIds = new Set(
    state.evidence.filter((item) => item.source === 'review').map((item) => item.nodeId),
  )
  const migrationReviewAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
  const mastery = state.mastery.map((item) => {
    if (reviewedNodeIds.has(item.nodeId)) return item
    const confidence = Math.min(item.confidence, 0.44)
    return {
      ...item,
      confidence,
      stabilityHours: Math.min(item.stabilityHours, 24),
      state: confidence >= COURSE_POLICY.reviewingConfidence ? 'reviewing' as const : 'learning' as const,
      nextReviewAt: new Date(item.nextReviewAt).getTime() < new Date(migrationReviewAt).getTime()
        ? item.nextReviewAt
        : migrationReviewAt,
    }
  })
  return {
    ...state,
    mastery,
    literacy: {
      itemProgress: state.literacy?.itemProgress ?? [],
      readingAttempts: state.literacy?.readingAttempts ?? [],
    },
  }
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString()
}

function getMasteryState(confidence: number, correct: boolean): CourseMasteryState {
  if (!correct && confidence < COURSE_POLICY.reviewingConfidence) return 'at_risk'
  if (confidence >= COURSE_POLICY.stableConfidence) return 'stable'
  if (confidence >= COURSE_POLICY.reviewingConfidence) return 'reviewing'
  return 'learning'
}

function updateMastery(
  current: CourseMastery | undefined,
  nodeId: string,
  accuracy: number,
  elapsedMs: number,
  answerCount: number,
  now: Date,
  source: CourseEvidenceSource,
): CourseMastery {
  const previousConfidence = current?.confidence ?? 0.18
  const responseQuality = elapsedMs > 45_000 ? 0.84 : elapsedMs > 20_000 ? 0.93 : 1
  const passed = accuracy >= COURSE_POLICY.lessonPassScore
  const previousStability = current?.stabilityHours ?? 6
  const hoursSinceLastReview = current?.lastReviewedAt
    ? Math.max(0, (now.getTime() - new Date(current.lastReviewedAt).getTime()) / 3_600_000)
    : 0
  const delayedRecall = source === 'review' && hoursSinceLastReview >= previousStability * 0.7
  const rawConfidence = passed
    ? Math.min(0.99, previousConfidence + (1 - previousConfidence) * 0.24 * accuracy * responseQuality)
    : Math.max(0.04, previousConfidence * (0.42 + accuracy * 0.28))
  const confidence = passed && !delayedRecall ? Math.min(rawConfidence, 0.6) : rawConfidence
  const stabilityHours = passed
    ? delayedRecall
      ? Math.min(24 * 180, Math.max(12, previousStability * (1.35 + confidence)))
      : Math.max(12, Math.min(previousStability, 24))
    : Math.max(3, previousStability * 0.32)

  return {
    nodeId,
    state: getMasteryState(confidence, passed) === 'stable' && !delayedRecall
      ? 'reviewing'
      : getMasteryState(confidence, passed),
    confidence,
    stabilityHours,
    correctCount: (current?.correctCount ?? 0) + Math.round(accuracy * answerCount),
    incorrectCount: (current?.incorrectCount ?? 0) + Math.round((1 - accuracy) * answerCount),
    nextReviewAt: addHours(now, stabilityHours),
    lastReviewedAt: now.toISOString(),
  }
}

function mergeEvidence(
  state: CourseState,
  answers: CourseAnswerResult[],
  source: CourseEvidenceSource,
  lessonId?: string,
) {
  const now = new Date()
  const masteryMap = new Map(state.mastery.map((item) => [item.nodeId, item]))
  const answersByNode = new Map<string, CourseAnswerResult[]>()
  for (const answer of answers) {
    answersByNode.set(answer.nodeId, [...(answersByNode.get(answer.nodeId) ?? []), answer])
  }
  for (const [nodeId, nodeAnswers] of answersByNode) {
    const accuracy = nodeAnswers.filter((answer) => answer.correct).length / nodeAnswers.length
    const averageElapsedMs = nodeAnswers.reduce((sum, answer) => sum + answer.elapsedMs, 0) / nodeAnswers.length
    masteryMap.set(
      nodeId,
      updateMastery(masteryMap.get(nodeId), nodeId, accuracy, averageElapsedMs, nodeAnswers.length, now, source),
    )
  }
  const evidence: CourseEvidence[] = answers.map((answer) => {
    return {
      id: crypto.randomUUID(),
      nodeId: answer.nodeId,
      questionId: answer.questionId,
      lessonId,
      source,
      correct: answer.correct,
      elapsedMs: answer.elapsedMs,
      createdAt: now.toISOString(),
    }
  })

  return {
    mastery: [...masteryMap.values()],
    evidence: [...evidence, ...state.evidence].slice(0, COURSE_POLICY.maxEvidenceRecords),
  }
}

function placementFromStageIndex(index: number): CoursePlacement {
  if (index <= 0) return 'new'
  if (index === 1) return 'foundation'
  if (index === 2) return 'elementary'
  if (index === 3) return 'intermediate'
  return 'advanced'
}

export function startCourseAtStage(state: CourseState, stageIndex: number, placementEvidence: CourseAnswerResult[] = []) {
  const safeStageIndex = Math.max(0, Math.min(stageIndex, courseStages.length - 1))
  const entryLessonId = courseStages[safeStageIndex]?.lessonIds[0] ?? courseLessons[0].id
  const entryOrder = courseLessonMap.get(entryLessonId)?.order ?? 1
  const now = new Date().toISOString()
  const lessonProgress: CourseLessonProgress[] = courseLessons
    .filter((item) => item.order < entryOrder)
    .map((item) => ({
      lessonId: item.id,
      status: 'placed',
      attempts: 0,
      bestScore: 1,
      completedAt: now,
    }))

  const next: CourseState = {
    ...state,
    profile: {
      target: 'N1',
      placement: placementFromStageIndex(safeStageIndex),
      activeLessonId: entryLessonId,
      startedAt: now,
    },
    lessonProgress,
    updatedAt: now,
  }

  if (placementEvidence.length === 0) return next
  const merged = mergeEvidence(next, placementEvidence, 'placement')
  return { ...next, ...merged, updatedAt: now }
}

export function getPlacementStageIndex(answers: CourseAnswerResult[]) {
  const groupSize = 2
  let passedStages = 0
  for (let index = 0; index < answers.length; index += groupSize) {
    const group = answers.slice(index, index + groupSize)
    if (group.length < groupSize || group.some((answer) => !answer.correct)) break
    passedStages += 1
  }
  return Math.min(passedStages, courseStages.length - 1)
}

export function submitLessonAttempt(
  state: CourseState,
  lessonId: string,
  answers: CourseAnswerResult[],
) {
  const lesson = courseLessonMap.get(lessonId)
  if (!lesson || answers.length === 0) return state

  const score = answers.filter((answer) => answer.correct).length / answers.length
  const passed = score >= COURSE_POLICY.lessonPassScore
  const now = new Date().toISOString()
  const progressMap = new Map(state.lessonProgress.map((item) => [item.lessonId, item]))
  const current = progressMap.get(lessonId)
  progressMap.set(lessonId, {
    lessonId,
    status: passed ? 'completed' : 'in_progress',
    attempts: (current?.attempts ?? 0) + 1,
    bestScore: Math.max(current?.bestScore ?? 0, score),
    lastStudiedAt: now,
    completedAt: passed ? current?.completedAt ?? now : current?.completedAt,
  })

  const nextLesson = courseLessons.find((item) => item.order > lesson.order)
  const merged = mergeEvidence(state, answers, 'lesson', lessonId)
  const crossesStageBoundary = Boolean(nextLesson && nextLesson.level !== lesson.level)
  const stageReady = !crossesStageBoundary || getLiteracyReadiness(state, lesson.level).ready

  return {
    ...state,
    ...merged,
    profile: state.profile
      ? {
          ...state.profile,
          activeLessonId: passed && nextLesson && stageReady ? nextLesson.id : lessonId,
        }
      : state.profile,
    lessonProgress: [...progressMap.values()],
    updatedAt: now,
  }
}

export function advanceCourseForLiteracy(state: CourseState) {
  if (!state.profile) return state
  const activeLesson = courseLessonMap.get(state.profile.activeLessonId)
  if (!activeLesson || getLessonProgress(state, activeLesson.id)?.status !== 'completed') return state
  const nextLesson = courseLessons.find((item) => item.order > activeLesson.order)
  if (!nextLesson || nextLesson.level === activeLesson.level) return state
  if (!getLiteracyReadiness(state, activeLesson.level).ready) return state
  return {
    ...state,
    profile: { ...state.profile, activeLessonId: nextLesson.id },
    updatedAt: new Date().toISOString(),
  }
}

export function submitCourseReview(
  state: CourseState,
  answer: CourseAnswerResult,
) {
  const merged = mergeEvidence(state, [answer], 'review')
  return {
    ...state,
    ...merged,
    updatedAt: new Date().toISOString(),
  }
}

export function getDueCourseMastery(state: CourseState, now = new Date()) {
  return state.mastery
    .filter((item) => new Date(item.nextReviewAt).getTime() <= now.getTime())
    .sort((a, b) => {
      if (a.state === 'at_risk' && b.state !== 'at_risk') return -1
      if (b.state === 'at_risk' && a.state !== 'at_risk') return 1
      return new Date(a.nextReviewAt).getTime() - new Date(b.nextReviewAt).getTime()
    })
}

export function getLessonProgress(state: CourseState, lessonId: string) {
  return state.lessonProgress.find((item) => item.lessonId === lessonId)
}

export function isLessonAvailable(state: CourseState, lessonId: string) {
  const lesson = courseLessonMap.get(lessonId)
  if (!lesson || !state.profile) return false
  if (lesson.id === state.profile.activeLessonId) return true
  const progress = getLessonProgress(state, lessonId)
  if (progress?.status === 'completed' || progress?.status === 'placed') return true
  const previousLesson = courseLessons.find((item) => item.order === lesson.order - 1)
  if (previousLesson && previousLesson.level !== lesson.level && !getLiteracyReadiness(state, previousLesson.level).ready) {
    return false
  }
  return lesson.prerequisiteLessonIds.every((requiredId) => {
    const requiredProgress = getLessonProgress(state, requiredId)
    return requiredProgress?.status === 'completed' || requiredProgress?.status === 'placed'
  })
}

export function getCourseCompletion(state: CourseState) {
  const completed = state.lessonProgress.filter(
    (item) => item.status === 'completed' || item.status === 'placed',
  ).length
  return {
    completed,
    total: courseLessons.length,
    ratio: courseLessons.length === 0 ? 0 : completed / courseLessons.length,
  }
}
