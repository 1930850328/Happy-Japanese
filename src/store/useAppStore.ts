import { create } from 'zustand'

import { defaultGoal, defaultSettings } from '../lib/defaults'
import { getTodayKey } from '../lib/date'
import {
  createReviewFromKnowledgePoint,
  createReviewFromSentence,
  createReviewFromVocab,
  updateReviewSchedule,
} from '../lib/review'
import {
  deleteNote,
  listFavorites,
  listImportedClips,
  listNotes,
  listReviewItems,
  listReviewLogs,
  listStudyEvents,
  listVocabProgress,
  loadGoal,
  loadSettings,
  removeFavorite,
  saveFavorite,
  saveGoal,
  saveImportedClip,
  saveNote,
  saveReviewItem,
  saveReviewItems,
  saveReviewLog,
  saveSettings,
  saveStudyEvent,
  saveVocabProgress,
} from '../lib/storage'
import type {
  AppSettings,
  DailyGoal,
  ImportedClip,
  KnowledgePoint,
  ReviewItem,
  ReviewLog,
  ReviewResult,
  SavedNote,
  StudyEvent,
  StudyEventType,
  VocabCard,
  VocabProgress,
  VideoLesson,
} from '../types'
import { videoLessons } from '../data/videoLessons'

function clipToLesson(clip: ImportedClip): VideoLesson {
  return {
    id: clip.id,
    sourceType: clip.sourceType,
    sourceIdOrBlobKey: clip.sourceIdOrBlobKey,
    sourceUrl: clip.sourceUrl,
    sourceProvider: clip.sourceProvider,
    sourceStartSec: 0,
    title: clip.title,
    cover: clip.cover,
    theme: clip.theme,
    difficulty: clip.difficulty,
    durationMs: clip.durationMs,
    segments: clip.segments,
    knowledgePoints: clip.knowledgePoints,
    tags: clip.tags,
    description: clip.description,
    creditLine: clip.creditLine,
    sliceLabel: `${Math.max(10, Math.round(clip.durationMs / 1000))} 秒私有片段`,
    feedPriority: 120,
  }
}

function buildLessons(importedClips: ImportedClip[]) {
  return [...importedClips.map(clipToLesson), ...videoLessons]
}

function mapVocabProgress(records: VocabProgress[]) {
  return records.reduce<Record<string, VocabProgress>>((acc, item) => {
    acc[item.id] = item
    return acc
  }, {})
}

function createCoverSvg(title: string, theme: string) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffd3be" />
          <stop offset="60%" stop-color="#fff3d5" />
          <stop offset="100%" stop-color="#d9ebff" />
        </linearGradient>
      </defs>
      <rect width="640" height="360" rx="28" fill="url(#g)" />
      <circle cx="96" cy="94" r="54" fill="rgba(255,255,255,0.48)" />
      <circle cx="520" cy="272" r="82" fill="rgba(255,255,255,0.32)" />
      <text x="48" y="102" fill="#835744" font-size="18" font-family="sans-serif">${theme}</text>
      <text x="48" y="176" fill="#4b372d" font-size="36" font-family="sans-serif">${title}</text>
      <text x="48" y="232" fill="#6f5a4c" font-size="18" font-family="sans-serif">Local Clip</text>
    </svg>
  `
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function readVideoDurationMs(file: File) {
  return new Promise<number>((resolve) => {
    const objectUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = objectUrl
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 30000
      URL.revokeObjectURL(objectUrl)
      resolve(duration)
    }
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(30000)
    }
  })
}

interface RecordStudyEventInput {
  type: StudyEventType
  sourceId: string
  title: string
  count?: number
  dedupeKey: string
  date?: string
}

interface SaveNoteInput {
  input: string
  note: string
  targetType: SavedNote['targetType']
  tokenSurface?: string
  analysisSnapshot?: SavedNote['analysisSnapshot']
  id?: string
}

interface AppStore {
  initialized: boolean
  initializing: boolean
  lessons: VideoLesson[]
  favorites: string[]
  notes: SavedNote[]
  goal: DailyGoal
  studyEvents: StudyEvent[]
  reviewItems: ReviewItem[]
  reviewLogs: ReviewLog[]
  vocabProgress: Record<string, VocabProgress>
  importedClips: ImportedClip[]
  settings: AppSettings
  initialize: () => Promise<void>
  toggleFavorite: (lessonId: string) => Promise<void>
  saveNoteEntry: (payload: SaveNoteInput) => Promise<void>
  deleteNoteEntry: (id: string) => Promise<void>
  updateGoal: (updates: Partial<DailyGoal>) => Promise<void>
  recordStudyEvent: (payload: RecordStudyEventInput) => Promise<boolean>
  addKnowledgeToReview: (points: KnowledgePoint[], sourceId: string, lessonId?: string) => Promise<number>
  addSentenceToReview: (expression: string, reading: string, meaningZh: string) => Promise<void>
  addVocabToReview: (card: VocabCard) => Promise<void>
  answerReview: (itemId: string, result: ReviewResult) => Promise<void>
  touchVocab: (card: VocabCard, mastered?: boolean) => Promise<void>
  addThemeBatchToReview: (cards: VocabCard[]) => Promise<number>
  importClip: (file: File, title?: string, theme?: string) => Promise<void>
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>
}

export const useAppStore = create<AppStore>((set, get) => ({
  initialized: false,
  initializing: false,
  lessons: videoLessons,
  favorites: [],
  notes: [],
  goal: defaultGoal,
  studyEvents: [],
  reviewItems: [],
  reviewLogs: [],
  vocabProgress: {},
  importedClips: [],
  settings: defaultSettings,

  async initialize() {
    if (get().initialized || get().initializing) {
      return
    }

    set({ initializing: true })
    const [
      favorites,
      notes,
      goal,
      studyEvents,
      reviewItems,
      reviewLogs,
      vocabProgress,
      importedClips,
      settings,
    ] = await Promise.all([
      listFavorites(),
      listNotes(),
      loadGoal(),
      listStudyEvents(),
      listReviewItems(),
      listReviewLogs(),
      listVocabProgress(),
      listImportedClips(),
      loadSettings(),
    ])

    set({
      initialized: true,
      initializing: false,
      favorites: favorites.map((record) => record.id),
      notes,
      goal: goal ?? defaultGoal,
      studyEvents,
      reviewItems,
      reviewLogs,
      vocabProgress: mapVocabProgress(vocabProgress),
      importedClips,
      lessons: buildLessons(importedClips),
      settings: settings ?? defaultSettings,
    })
  },

  async toggleFavorite(lessonId) {
    const exists = get().favorites.includes(lessonId)
    if (exists) {
      await removeFavorite(lessonId)
      set((state) => ({
        favorites: state.favorites.filter((id) => id !== lessonId),
      }))
      return
    }

    await saveFavorite(lessonId)
    set((state) => ({
      favorites: [...state.favorites, lessonId],
    }))
  },

  async saveNoteEntry(payload) {
    const now = new Date().toISOString()
    const next: SavedNote = {
      id: payload.id ?? crypto.randomUUID(),
      input: payload.input.trim(),
      note: payload.note.trim(),
      targetType: payload.targetType,
      tokenSurface: payload.tokenSurface,
      analysisSnapshot: payload.analysisSnapshot,
      createdAt: payload.id
        ? get().notes.find((item) => item.id === payload.id)?.createdAt ?? now
        : now,
      updatedAt: now,
    }

    await saveNote(next)
    set((state) => {
      const exists = state.notes.some((item) => item.id === next.id)
      return {
        notes: exists
          ? state.notes.map((item) => (item.id === next.id ? next : item))
          : [next, ...state.notes],
      }
    })
  },

  async deleteNoteEntry(id) {
    await deleteNote(id)
    set((state) => ({
      notes: state.notes.filter((item) => item.id !== id),
    }))
  },

  async updateGoal(updates) {
    const next = {
      ...get().goal,
      ...updates,
      id: 'daily-goals' as const,
      updatedAt: new Date().toISOString(),
    }
    await saveGoal(next)
    set({ goal: next })
  },

  async recordStudyEvent(payload) {
    const date = payload.date ?? getTodayKey()
    const dedupeKey = `${payload.dedupeKey}:${date}`
    const exists = get().studyEvents.some((event) => event.dedupeKey === dedupeKey)
    if (exists) {
      return false
    }

    const next: StudyEvent = {
      id: crypto.randomUUID(),
      type: payload.type,
      sourceId: payload.sourceId,
      title: payload.title,
      count: payload.count ?? 1,
      date,
      dedupeKey,
      createdAt: new Date().toISOString(),
    }
    await saveStudyEvent(next)
    set((state) => ({
      studyEvents: [next, ...state.studyEvents],
    }))
    return true
  },

  async addKnowledgeToReview(points, sourceId, lessonId) {
    const current = get().reviewItems
    const toCreate = points.filter((point) => {
      return !current.some(
        (item) => item.sourceId === sourceId && item.expression === point.expression,
      )
    })
    const nextItems = toCreate.map((point) =>
      createReviewFromKnowledgePoint(point, sourceId, lessonId),
    )
    if (nextItems.length === 0) {
      return 0
    }

    await saveReviewItems(nextItems)
    set((state) => ({
      reviewItems: [...nextItems, ...state.reviewItems],
    }))
    return nextItems.length
  },

  async addSentenceToReview(expression, reading, meaningZh) {
    const current = get().reviewItems
    const exists = current.some((item) => item.expression === expression && item.meaningZh === meaningZh)
    if (exists) {
      return
    }

    const next = createReviewFromSentence(expression, reading, meaningZh)
    await saveReviewItem(next)
    set((state) => ({
      reviewItems: [next, ...state.reviewItems],
    }))
  },

  async addVocabToReview(card) {
    const exists = get().reviewItems.some((item) => item.sourceId === card.id)
    const currentProgress = get().vocabProgress[card.id] ?? {
      id: card.id,
      mastered: false,
      reviewAdded: false,
      flippedCount: 0,
    }

    if (!exists) {
      const nextReview = createReviewFromVocab(card)
      await saveReviewItem(nextReview)
      set((state) => ({
        reviewItems: [nextReview, ...state.reviewItems],
      }))
    }

    const nextProgress: VocabProgress = {
      ...currentProgress,
      reviewAdded: true,
    }
    await saveVocabProgress(nextProgress)
    set((state) => ({
      vocabProgress: {
        ...state.vocabProgress,
        [card.id]: nextProgress,
      },
    }))
  },

  async answerReview(itemId, result) {
    const item = get().reviewItems.find((entry) => entry.id === itemId)
    if (!item) {
      return
    }

    const nextItem = updateReviewSchedule(item, result)
    const log: ReviewLog = {
      id: crypto.randomUUID(),
      reviewItemId: itemId,
      result,
      reviewedAt: new Date().toISOString(),
    }

    await Promise.all([saveReviewItem(nextItem), saveReviewLog(log)])
    set((state) => ({
      reviewItems: state.reviewItems.map((entry) => (entry.id === itemId ? nextItem : entry)),
      reviewLogs: [log, ...state.reviewLogs],
    }))

    await get().recordStudyEvent({
      type: 'review',
      sourceId: item.sourceId,
      title: item.expression,
      dedupeKey: `review:${itemId}`,
    })
  },

  async touchVocab(card, mastered = false) {
    const current = get().vocabProgress[card.id] ?? {
      id: card.id,
      mastered: false,
      reviewAdded: false,
      flippedCount: 0,
    }

    const next: VocabProgress = {
      ...current,
      mastered: mastered || current.mastered,
      flippedCount: current.flippedCount + 1,
      lastStudiedAt: new Date().toISOString(),
    }
    await saveVocabProgress(next)
    set((state) => ({
      vocabProgress: {
        ...state.vocabProgress,
        [card.id]: next,
      },
    }))

    await get().recordStudyEvent({
      type: 'word',
      sourceId: card.id,
      title: card.term,
      dedupeKey: `word:${card.id}`,
    })
  },

  async addThemeBatchToReview(cards) {
    let count = 0
    for (const card of cards) {
      await get().addVocabToReview(card)
      await get().touchVocab(card)
      count += 1
    }
    return count
  },

  async importClip(file, title, theme) {
    const durationMs = await readVideoDurationMs(file)
    const clipTitle = title?.trim() || file.name.replace(/\.[^.]+$/, '')
    const clipTheme = theme?.trim() || '自定义片段'
    const now = new Date().toISOString()
    const clip: ImportedClip = {
      id: `clip-${crypto.randomUUID()}`,
      title: clipTitle,
      theme: clipTheme,
      difficulty: 'Custom',
      sourceType: 'local',
      sourceIdOrBlobKey: `blob-${crypto.randomUUID()}`,
      sourceUrl: '',
      sourceProvider: '本地导入',
      cover: createCoverSvg(clipTitle, clipTheme),
      durationMs,
      fileType: file.type,
      blob: file,
      createdAt: now,
      description: '你导入的私人学习片段，可结合备注页自行补充台词与记忆点。',
      creditLine: '仅存储在当前设备，不会上传。',
      tags: ['私有片段', clipTheme],
      segments: [
        {
          startMs: 0,
          endMs: durationMs,
          ja: '私有导入片段，建议边看边在备注页补充台词。',
          kana: 'しゆうどうにゅうへん、べんりにめもをのこしましょう。',
          romaji: 'shiyuu dounyuu hen, benri ni memo o nokoshimashou',
          zh: '这是你导入的私人片段，建议边看边写备注。',
          focusTermIds: ['local-note'],
        },
      ],
      knowledgePoints: [
        {
          id: 'local-note',
          kind: 'phrase',
          expression: '気になる表現',
          reading: 'きになるひょうげん',
          meaningZh: '你想重点记住的表达',
          partOfSpeech: '占位提醒',
          explanationZh: '这条私有片段默认会生成一个占位知识点，方便你加入复习。',
          exampleJa: '気になる表現はメモしておこう。',
          exampleZh: '把值得注意的表达先记下来吧。',
        },
      ],
    }

    await saveImportedClip(clip)
    set((state) => {
      const importedClips = [clip, ...state.importedClips]
      return {
        importedClips,
        lessons: buildLessons(importedClips),
      }
    })
  },

  async updateSettings(updates) {
    const next = {
      ...get().settings,
      ...updates,
      id: 'settings' as const,
    }
    await saveSettings(next)
    set({ settings: next })
  },
}))
