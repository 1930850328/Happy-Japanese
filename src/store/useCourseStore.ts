import { create } from 'zustand'

import {
  createEmptyCourseState,
  advanceCourseForLiteracy,
  getPlacementStageIndex,
  normalizeCourseState,
  startCourseAtStage,
  submitCourseReview,
  submitLessonAttempt,
  type CourseAnswerResult,
} from '../lib/courseEngine'
import { recordLiteracyAnswer, recordReadingAttempt } from '../lib/literacyEngine'
import { loadCourseState, saveCourseState } from '../lib/storage'
import type { CourseState, LiteracyItemKind, ReadingAttempt } from '../types'

interface CourseStore {
  initialized: boolean
  initializing: boolean
  courseState: CourseState
  initialize: () => Promise<void>
  startFromBeginning: () => Promise<void>
  finishPlacement: (answers: CourseAnswerResult[]) => Promise<void>
  saveLessonAttempt: (lessonId: string, answers: CourseAnswerResult[]) => Promise<CourseState>
  saveReviewAnswer: (answer: CourseAnswerResult) => Promise<CourseState>
  saveLiteracyAnswer: (answer: {
    itemId: string
    kind: LiteracyItemKind
    level: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
    correct: boolean
    meaningZh?: string
  }) => Promise<void>
  saveReadingAttempt: (attempt: Omit<ReadingAttempt, 'id' | 'completedAt'>) => Promise<void>
  restartPlacement: () => Promise<void>
}

const emptyState = createEmptyCourseState()

export const useCourseStore = create<CourseStore>((set, get) => ({
  initialized: false,
  initializing: false,
  courseState: emptyState,

  async initialize() {
    if (get().initialized || get().initializing) return
    set({ initializing: true })
    const saved = await loadCourseState()
    set({
      initialized: true,
      initializing: false,
      courseState: saved ? normalizeCourseState({ ...emptyState, ...saved }) : createEmptyCourseState(),
    })
  },

  async startFromBeginning() {
    const next = startCourseAtStage(get().courseState, 0)
    set({ courseState: next })
    await saveCourseState(next)
  },

  async finishPlacement(answers) {
    const stageIndex = getPlacementStageIndex(answers)
    const next = startCourseAtStage(get().courseState, stageIndex, answers)
    set({ courseState: next })
    await saveCourseState(next)
  },

  async saveLessonAttempt(lessonId, answers) {
    const next = submitLessonAttempt(get().courseState, lessonId, answers)
    set({ courseState: next })
    await saveCourseState(next)
    return next
  },

  async saveReviewAnswer(answer) {
    const next = submitCourseReview(get().courseState, answer)
    set({ courseState: next })
    await saveCourseState(next)
    return next
  },

  async saveLiteracyAnswer(answer) {
    const current = get().courseState
    const next = advanceCourseForLiteracy({
      ...current,
      literacy: recordLiteracyAnswer(current.literacy, answer),
      updatedAt: new Date().toISOString(),
    })
    set({ courseState: next })
    await saveCourseState(next)
  },

  async saveReadingAttempt(attempt) {
    const current = get().courseState
    const next = advanceCourseForLiteracy({
      ...current,
      literacy: recordReadingAttempt(current.literacy, attempt),
      updatedAt: new Date().toISOString(),
    })
    set({ courseState: next })
    await saveCourseState(next)
  },

  async restartPlacement() {
    const next = createEmptyCourseState()
    set({ courseState: next })
    await saveCourseState(next)
  },
}))
