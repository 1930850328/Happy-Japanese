import { courseLessonMap, courseLessons, courseStages } from '../data/courseCatalog'
import type {
  CourseDimensionProgress,
  CourseEvidence,
  CourseEvidenceSource,
  CourseLearningDimension,
  CourseLesson,
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
  dimension?: CourseLearningDimension
  assisted?: boolean
  response?: string
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

export function getCourseQuestionDimension(question: CourseQuestion): CourseLearningDimension {
  if (question.dimension) return question.dimension
  if (question.kind === 'usage') return 'production'
  if (question.kind === 'comprehension') return 'transfer'
  return 'recognition'
}

export function getCourseQuestionInteraction(question: CourseQuestion) {
  return question.interaction ?? 'choice'
}

function normalizeCourseResponse(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s。！？、,.!?・-]/g, '')
}

export function isCourseQuestionCorrect(question: CourseQuestion, response: string | number) {
  if (getCourseQuestionInteraction(question) === 'choice') {
    return response === question.answerIndex
  }
  if (getCourseQuestionInteraction(question) === 'listening_choice') {
    return response === question.answerIndex
  }
  const normalized = normalizeCourseResponse(String(response))
  return (question.acceptableAnswers ?? []).some((answer) => normalizeCourseResponse(answer) === normalized)
}

export function getCourseQuestionAnswer(question: CourseQuestion) {
  return getCourseQuestionInteraction(question) === 'input'
    ? question.acceptableAnswers?.[0] ?? ''
    : question.options[question.answerIndex] ?? ''
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
    if (getCourseQuestionInteraction(question) === 'input') return { ...question }
    const correctOption = question.options[question.answerIndex]
    const options = seededShuffle(question.options, `${attemptSeed}:${question.id}:options`)
    return {
      ...question,
      options,
      answerIndex: options.indexOf(correctOption),
    }
  })
}

export function prepareAdaptiveLessonQuestions(
  lesson: CourseLesson,
  state: CourseState,
  attemptSeed: string,
) {
  const evidenceByQuestion = new Map<string, { correct: number; incorrect: number }>()
  for (const item of state.evidence) {
    const summary = evidenceByQuestion.get(item.questionId) ?? { correct: 0, incorrect: 0 }
    summary[item.correct ? 'correct' : 'incorrect'] += 1
    evidenceByQuestion.set(item.questionId, summary)
  }

  const prepared = prepareCourseQuestions(lesson.questions, attemptSeed)
    .map((item, index) => ({
      item: { ...item, sessionRole: 'lesson' as const },
      index,
      weakness: (evidenceByQuestion.get(item.id)?.incorrect ?? 0) - (evidenceByQuestion.get(item.id)?.correct ?? 0),
    }))
    .sort((a, b) => b.weakness - a.weakness || a.index - b.index)
    .map(({ item }) => item)

  if (!lesson.requiredDimensions?.length) return prepared

  const previousLessons = courseLessons.filter((item) => item.order < lesson.order)
  const previousQuestions = previousLessons.flatMap((item) => item.questions)
  const retentionByDimension = new Map<CourseLearningDimension, CourseQuestion>()
  for (const dimension of lesson.requiredDimensions) {
    const candidates = previousQuestions.filter((item) => getCourseQuestionDimension(item) === dimension)
    const selected = candidates.sort((a, b) => {
      const aEvidence = evidenceByQuestion.get(a.id) ?? { correct: 0, incorrect: 0 }
      const bEvidence = evidenceByQuestion.get(b.id) ?? { correct: 0, incorrect: 0 }
      return (bEvidence.incorrect - bEvidence.correct) - (aEvidence.incorrect - aEvidence.correct)
    })[0]
    if (selected) {
      retentionByDimension.set(
        dimension,
        { ...prepareCourseQuestions([selected], `${attemptSeed}:retention:${dimension}`, false)[0], sessionRole: 'retention' },
      )
    }
  }

  const result: CourseQuestion[] = []
  const insertedDimensions = new Set<CourseLearningDimension>()
  for (const item of prepared) {
    result.push(item)
    const dimension = getCourseQuestionDimension(item)
    const retention = retentionByDimension.get(dimension)
    if (retention && !insertedDimensions.has(dimension)) {
      result.push(retention)
      insertedDimensions.add(dimension)
    }
  }
  return result
}

export function createEmptyCourseState(): CourseState {
  return {
    version: 2,
    lessonProgress: [],
    mastery: [],
    evidence: [],
    literacy: createEmptyLiteracyState(),
    updatedAt: new Date().toISOString(),
  }
}

function requiredDimensionsForNode(nodeId: string) {
  return [...new Set(
    courseLessons
      .filter((lesson) => lesson.nodeIds.includes(nodeId))
      .flatMap((lesson) => lesson.requiredDimensions ?? []),
  )]
}

function resolveAnswerDimension(answer: CourseAnswerResult) {
  if (answer.dimension) return answer.dimension
  const question = courseLessons.flatMap((lesson) => lesson.questions).find((item) => item.id === answer.questionId)
  return question ? getCourseQuestionDimension(question) : 'recognition'
}

function hasStableDimensionEvidence(mastery: CourseMastery) {
  const required = requiredDimensionsForNode(mastery.nodeId)
  return required.length === 0 || required.every((dimension) => {
    const progress = mastery.dimensions?.[dimension]
    return Boolean(
      progress &&
      progress.delayedCorrectCount > 0 &&
      progress.confidence >= COURSE_POLICY.reviewingConfidence,
    )
  })
}

export function normalizeCourseState(state: CourseState): CourseState {
  const reviewedNodeIds = new Set(
    state.evidence.filter((item) => item.source === 'review').map((item) => item.nodeId),
  )
  const migrationReviewAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
  const mastery = state.mastery.map((item) => {
    const hasReview = reviewedNodeIds.has(item.nodeId)
    const confidence = hasReview ? item.confidence : Math.min(item.confidence, 0.44)
    const provisionalState = item.state === 'stable' && !hasStableDimensionEvidence(item)
      ? 'reviewing' as const
      : item.state
    return {
      ...item,
      confidence,
      stabilityHours: hasReview ? item.stabilityHours : Math.min(item.stabilityHours, 24),
      state: hasReview
        ? provisionalState
        : confidence >= COURSE_POLICY.reviewingConfidence ? 'reviewing' as const : 'learning' as const,
      nextReviewAt: hasReview || new Date(item.nextReviewAt).getTime() < new Date(migrationReviewAt).getTime()
        ? item.nextReviewAt
        : migrationReviewAt,
    }
  })
  return {
    ...state,
    version: 2,
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

function updateDimensionProgress(
  current: CourseDimensionProgress | undefined,
  answers: CourseAnswerResult[],
  now: Date,
  source: CourseEvidenceSource,
): CourseDimensionProgress {
  const accuracy = answers.filter((answer) => answer.correct).length / answers.length
  const elapsedMs = answers.reduce((sum, answer) => sum + answer.elapsedMs, 0) / answers.length
  const previousConfidence = current?.confidence ?? 0.12
  const previousStability = current?.stabilityHours ?? 6
  const hoursSinceLastReview = current?.lastReviewedAt
    ? Math.max(0, (now.getTime() - new Date(current.lastReviewedAt).getTime()) / 3_600_000)
    : 0
  const responseQuality = elapsedMs > 45_000 ? 0.84 : elapsedMs > 20_000 ? 0.93 : 1
  const passed = accuracy >= COURSE_POLICY.lessonPassScore
  const delayedRecall = source === 'review' && hoursSinceLastReview >= previousStability * 0.7
  const rawConfidence = passed
    ? Math.min(0.99, previousConfidence + (1 - previousConfidence) * 0.28 * accuracy * responseQuality)
    : Math.max(0.04, previousConfidence * (0.4 + accuracy * 0.25))
  const confidence = passed && !delayedRecall
    ? Math.max(previousConfidence, Math.min(rawConfidence, 0.6))
    : rawConfidence
  const stabilityHours = passed
    ? delayedRecall
      ? Math.min(24 * 180, Math.max(12, previousStability * (1.35 + confidence)))
      : Math.max(12, Math.min(previousStability, 24))
    : Math.max(3, previousStability * 0.32)

  return {
    confidence,
    stabilityHours,
    correctCount: (current?.correctCount ?? 0) + answers.filter((answer) => answer.correct).length,
    incorrectCount: (current?.incorrectCount ?? 0) + answers.filter((answer) => !answer.correct).length,
    delayedCorrectCount: (current?.delayedCorrectCount ?? 0) + (delayedRecall && passed ? 1 : 0),
    nextReviewAt: addHours(now, stabilityHours),
    lastReviewedAt: now.toISOString(),
  }
}

function updateMastery(
  current: CourseMastery | undefined,
  nodeId: string,
  answers: CourseAnswerResult[],
  now: Date,
  source: CourseEvidenceSource,
): CourseMastery {
  const accuracy = answers.filter((answer) => answer.correct).length / answers.length
  const elapsedMs = answers.reduce((sum, answer) => sum + answer.elapsedMs, 0) / answers.length
  const answerCount = answers.length
  const previousConfidence = current?.confidence ?? 0.18
  const responseQuality = elapsedMs > 45_000 ? 0.84 : elapsedMs > 20_000 ? 0.93 : 1
  const passed = accuracy >= COURSE_POLICY.lessonPassScore
  const previousStability = current?.stabilityHours ?? 6
  const delayedRecall = source === 'review' && answers.some((answer) => {
    const dimensionProgress = current?.dimensions?.[answer.dimension ?? 'recognition']
    const lastReviewedAt = dimensionProgress?.lastReviewedAt ?? current?.lastReviewedAt
    const dimensionStability = dimensionProgress?.stabilityHours ?? previousStability
    if (!lastReviewedAt) return false
    const hoursSinceLastReview = Math.max(0, (now.getTime() - new Date(lastReviewedAt).getTime()) / 3_600_000)
    return hoursSinceLastReview >= dimensionStability * 0.7
  })
  const rawConfidence = passed
    ? Math.min(0.99, previousConfidence + (1 - previousConfidence) * 0.24 * accuracy * responseQuality)
    : Math.max(0.04, previousConfidence * (0.42 + accuracy * 0.28))
  const confidence = passed && !delayedRecall
    ? Math.max(previousConfidence, Math.min(rawConfidence, 0.6))
    : rawConfidence
  const stabilityHours = passed
    ? delayedRecall
      ? Math.min(24 * 180, Math.max(12, previousStability * (1.35 + confidence)))
      : Math.max(12, Math.min(previousStability, 24))
    : Math.max(3, previousStability * 0.32)

  const dimensions = { ...(current?.dimensions ?? {}) }
  const answersByDimension = new Map<CourseLearningDimension, CourseAnswerResult[]>()
  for (const answer of answers) {
    const dimension = answer.dimension ?? 'recognition'
    answersByDimension.set(dimension, [...(answersByDimension.get(dimension) ?? []), answer])
  }
  for (const [dimension, dimensionAnswers] of answersByDimension) {
    dimensions[dimension] = updateDimensionProgress(dimensions[dimension], dimensionAnswers, now, source)
  }

  const dimensionReviewTimes = Object.values(dimensions).map((item) => new Date(item.nextReviewAt).getTime())
  const nextReviewAt = dimensionReviewTimes.length > 0
    ? new Date(Math.min(...dimensionReviewTimes)).toISOString()
    : addHours(now, stabilityHours)
  const candidateState = getMasteryState(confidence, passed)
  const stableAcrossDimensions = hasStableDimensionEvidence({
    ...(current ?? {
      nodeId,
      confidence,
      stabilityHours,
      correctCount: 0,
      incorrectCount: 0,
      nextReviewAt,
      lastReviewedAt: now.toISOString(),
      state: candidateState,
    }),
    dimensions,
  })

  return {
    nodeId,
    state: candidateState === 'stable' && (!delayedRecall || !stableAcrossDimensions)
      ? 'reviewing'
      : candidateState,
    confidence,
    stabilityHours,
    correctCount: (current?.correctCount ?? 0) + Math.round(accuracy * answerCount),
    incorrectCount: (current?.incorrectCount ?? 0) + Math.round((1 - accuracy) * answerCount),
    nextReviewAt,
    lastReviewedAt: now.toISOString(),
    dimensions,
  }
}

function mergeEvidence(
  state: CourseState,
  answers: CourseAnswerResult[],
  source: CourseEvidenceSource,
  lessonId?: string,
) {
  const now = new Date()
  const resolvedAnswers = answers.map((answer) => ({
    ...answer,
    dimension: resolveAnswerDimension(answer),
  }))
  const masteryMap = new Map(state.mastery.map((item) => [item.nodeId, item]))
  const answersByNode = new Map<string, CourseAnswerResult[]>()
  for (const answer of resolvedAnswers) {
    answersByNode.set(answer.nodeId, [...(answersByNode.get(answer.nodeId) ?? []), answer])
  }
  for (const [nodeId, nodeAnswers] of answersByNode) {
    const independentAnswers = nodeAnswers.filter((answer) => !answer.assisted)
    if (independentAnswers.length > 0) {
      masteryMap.set(nodeId, updateMastery(masteryMap.get(nodeId), nodeId, independentAnswers, now, source))
    }
  }
  const evidence: CourseEvidence[] = resolvedAnswers.map((answer) => {
    return {
      id: crypto.randomUUID(),
      nodeId: answer.nodeId,
      questionId: answer.questionId,
      lessonId,
      source,
      correct: answer.correct,
      elapsedMs: answer.elapsedMs,
      createdAt: now.toISOString(),
      dimension: answer.dimension,
      assisted: answer.assisted,
      response: answer.response,
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

  const independentLessonAnswers = answers.filter((answer) =>
    !answer.assisted && lesson.nodeIds.includes(answer.nodeId),
  )
  if (independentLessonAnswers.length === 0) return state
  const score = independentLessonAnswers.filter((answer) => answer.correct).length / independentLessonAnswers.length
  const dimensionCoverage = (lesson.requiredDimensions ?? []).every((dimension) =>
    independentLessonAnswers.some((answer) => resolveAnswerDimension(answer) === dimension && answer.correct),
  )
  const passed = score >= COURSE_POLICY.lessonPassScore && dimensionCoverage
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

export function getDueCourseDimension(mastery: CourseMastery, now = new Date()) {
  const dueDimensions = Object.entries(mastery.dimensions ?? {})
    .filter(([, progress]) => new Date(progress.nextReviewAt).getTime() <= now.getTime())
    .sort(([, a], [, b]) => a.confidence - b.confidence || new Date(a.nextReviewAt).getTime() - new Date(b.nextReviewAt).getTime())
  return dueDimensions[0]?.[0] as CourseLearningDimension | undefined
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
