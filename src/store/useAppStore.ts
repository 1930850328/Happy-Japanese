import { create } from 'zustand'

import { defaultGoal, defaultSettings } from '../lib/defaults'
import { getTodayKey } from '../lib/date'
import { buildLessonsFromImportedClip } from '../lib/lessonSlices'
import { loadPublishedLessons } from '../lib/publishedLessons'
import {
  buildManifestClipFileMap,
  getManifestClipFileName,
  getManifestSubtitleSource,
  parseSlicerManifest,
} from '../lib/slicerManifest'
import {
  createReviewFromKnowledgePoint,
  createReviewFromSentence,
  createReviewFromVocab,
  updateReviewSchedule,
} from '../lib/review'
import {
  deleteImportedClip,
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
import { buildStudyDataFromCues, parseSubtitleFile } from '../lib/subtitles'
import type {
  AppSettings,
  DailyGoal,
  ImportedClip,
  KnowledgePoint,
  ReviewItem,
  ReviewLog,
  ReviewResult,
  SavedNote,
  SlicePreviewDraft,
  SliceTaskState,
  StudyEvent,
  StudyEventType,
  VocabCard,
  VocabProgress,
  VideoLesson,
} from '../types'

const idleSliceTask: SliceTaskState = {
  status: 'idle',
  percent: 0,
  detail: '',
}

function clipToLesson(clip: ImportedClip): VideoLesson {
  const clipStartMs = clip.clipStartMs ?? 0
  const clipEndMs = clip.clipEndMs ?? clipStartMs + clip.durationMs

  return {
    id: clip.id,
    originClipId: clip.sourceClipId ?? clip.id,
    sourceType: clip.sourceType,
    sourceIdOrBlobKey: clip.sourceIdOrBlobKey,
    sourceFileName: clip.sourceFileName,
    sourceUrl: clip.sourceUrl,
    sourceProvider: clip.sourceProvider,
    sourceStartSec: clipStartMs / 1000,
    clipStartMs,
    clipEndMs,
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
    sliceLabel: `${Math.max(10, Math.round(clip.durationMs / 1000))} 秒学习切片`,
    feedPriority: 120,
  }
}

void clipToLesson

function dedupeLessons(lessons: VideoLesson[]) {
  return lessons.filter((lesson, index, all) => {
    return all.findIndex((item) => item.id === lesson.id) === index
  })
}

function buildLessons(importedClips: ImportedClip[], publishedLessons: VideoLesson[]) {
  const importedLessons = importedClips.flatMap((clip) => {
    if (clip.importMode === 'source') {
      return []
    }

    return clip.importMode === 'sliced' ? [clipToLesson(clip)] : buildLessonsFromImportedClip(clip)
  })

  return dedupeLessons([...importedLessons, ...publishedLessons])
}

function mapVocabProgress(records: VocabProgress[]) {
  return records.reduce<Record<string, VocabProgress>>((acc, item) => {
    acc[item.id] = item
    return acc
  }, {})
}

function createCoverSvg(title: string, theme: string) {
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const safeTheme = theme.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffd7c2" />
          <stop offset="50%" stop-color="#fff2d7" />
          <stop offset="100%" stop-color="#d7ecdf" />
        </linearGradient>
      </defs>
      <rect width="640" height="360" rx="30" fill="url(#bg)" />
      <circle cx="92" cy="92" r="58" fill="rgba(255,255,255,0.42)" />
      <circle cx="546" cy="278" r="92" fill="rgba(255,255,255,0.28)" />
      <rect x="44" y="214" width="292" height="98" rx="24" fill="rgba(255,255,255,0.76)" />
      <text x="48" y="78" fill="#815848" font-size="18" font-family="sans-serif">${safeTheme}</text>
      <text x="60" y="258" fill="#4b362d" font-size="30" font-family="sans-serif">${safeTitle}</text>
    </svg>
  `
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function captureVideoCover(
  video: HTMLVideoElement,
  title: string,
  theme: string,
  durationMs: number,
) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const context = canvas.getContext('2d')
    if (!context) {
      return createCoverSvg(title, theme)
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    context.fillStyle = 'rgba(20, 14, 12, 0.14)'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = 'rgba(255, 252, 249, 0.92)'
    context.fillRect(26, canvas.height - 156, Math.min(canvas.width - 52, 430), 106)
    context.fillStyle = '#4f382f'
    context.font = '600 34px sans-serif'
    context.fillText(title, 50, canvas.height - 96)
    context.fillStyle = '#866457'
    context.font = '22px sans-serif'
    context.fillText(
      `${theme} · ${Math.max(10, Math.round(durationMs / 1000))} 秒`,
      50,
      canvas.height - 58,
    )
    return canvas.toDataURL('image/jpeg', 0.9)
  } catch {
    return createCoverSvg(title, theme)
  }
}

function readVideoMeta(file: File, title: string, theme: string) {
  return new Promise<{ durationMs: number; cover: string }>((resolve) => {
    const objectUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    let durationMs = 30000
    let settled = false
    let timeoutId = 0

    const cleanup = () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
      video.pause()
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(objectUrl)
    }

    const finalize = (cover: string) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve({ durationMs, cover })
    }

    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.src = objectUrl

    video.onloadedmetadata = () => {
      durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 30000
      const targetTime = Math.max(0.15, Math.min(video.duration / 3 || 0.6, 1.2))
      timeoutId = window.setTimeout(() => {
        finalize(createCoverSvg(title, theme))
      }, 1400)

      try {
        video.currentTime = Number.isFinite(targetTime) ? targetTime : 0.6
      } catch {
        finalize(createCoverSvg(title, theme))
      }
    }

    video.onseeked = () => {
      finalize(captureVideoCover(video, title, theme, durationMs))
    }

    video.onerror = () => {
      finalize(createCoverSvg(title, theme))
    }
  })
}

function mergeTags(...groups: Array<Array<string | undefined>>) {
  return [...new Set(groups.flat().filter((item): item is string => Boolean(item && item.trim())))]
}

async function purgeFavorites(lessonIds: string[], favorites: string[]) {
  const idsToRemove = lessonIds.filter((id) => favorites.includes(id))
  await Promise.all(idsToRemove.map((id) => removeFavorite(id)))
  return idsToRemove
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

interface ImportClipInput {
  file: File
  subtitleFile?: File | null
  title?: string
  theme?: string
}

interface ImportSlicerManifestInput {
  manifestFile: File
  clipFiles: File[]
  theme?: string
}

interface ImportSelectedSlicesInput {
  file: File
  title: string
  theme: string
  cover: string
  durationMs: number
  subtitleFileName?: string
  subtitleSource?: ImportedClip['subtitleSource']
  sourceProvider: string
  sourceAnimeTitle?: string
  sourceEpisodeTitle?: string
  baseSegments: ImportedClip['segments']
  baseKnowledgePoints: ImportedClip['knowledgePoints']
  selectedLessons: VideoLesson[]
}

type SubtitleStatusCallback = (message: string) => void

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
  publishedLessons: VideoLesson[]
  sliceTask: SliceTaskState
  slicePreviewDraft: SlicePreviewDraft | null
  settings: AppSettings
  initialize: () => Promise<void>
  refreshPublishedLessons: () => Promise<void>
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
  importClip: (payload: ImportClipInput) => Promise<ImportedClip>
  importSlicerManifest: (payload: ImportSlicerManifestInput) => Promise<ImportedClip[]>
  importSelectedSlices: (payload: ImportSelectedSlicesInput) => Promise<ImportedClip[]>
  deleteLocalLesson: (lessonId: string) => Promise<boolean>
  setSliceTask: (payload: SliceTaskState) => void
  setSlicePreviewDraft: (payload: SlicePreviewDraft | null) => void
  clearSliceWorkflow: () => void
  generateAutoSubtitles: (
    clipId: string,
    onStatus?: SubtitleStatusCallback,
  ) => Promise<ImportedClip | null>
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>
}

export const useAppStore = create<AppStore>((set, get) => ({
  initialized: false,
  initializing: false,
  lessons: [],
  favorites: [],
  notes: [],
  goal: defaultGoal,
  studyEvents: [],
  reviewItems: [],
  reviewLogs: [],
  vocabProgress: {},
  importedClips: [],
  publishedLessons: [],
  sliceTask: idleSliceTask,
  slicePreviewDraft: null,
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
      publishedLessons,
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
      loadPublishedLessons(),
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
      publishedLessons,
      lessons: buildLessons(importedClips, publishedLessons),
      settings: settings ? { ...defaultSettings, ...settings } : defaultSettings,
    })
  },

  async refreshPublishedLessons() {
    const publishedLessons = await loadPublishedLessons()
    set((state) => ({
      publishedLessons,
      lessons: buildLessons(state.importedClips, publishedLessons),
    }))
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

  setSliceTask(payload) {
    set({ sliceTask: payload })
  },

  setSlicePreviewDraft(payload) {
    set({ slicePreviewDraft: payload })
  },

  clearSliceWorkflow() {
    set({
      sliceTask: idleSliceTask,
      slicePreviewDraft: null,
    })
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
    const next: DailyGoal = {
      ...get().goal,
      ...updates,
      id: 'daily-goals',
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
    const exists = get().reviewItems.some(
      (item) => item.expression === expression && item.meaningZh === meaningZh,
    )
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

  async importClip({ file, subtitleFile, title, theme }) {
    const clipTitle = title?.trim() || file.name.replace(/\.[^.]+$/, '')
    const clipTheme = theme?.trim() || '自定义片段'
    const { durationMs, cover } = await readVideoMeta(file, clipTitle, clipTheme)
    const now = new Date().toISOString()

    let segments = [
      {
        startMs: 0,
        endMs: durationMs,
        ja: '正在等待字幕。你可以先看原片，也可以让系统自动识别日语字幕并生成学习向中文字幕。',
        kana: 'じまく を じどう せいせい すると、 ここ に げんぶん が でます。',
        romaji: 'jimaku o jidou seisei suru to, koko ni genbun ga demasu.',
        zh: '导入完成后，如果没有外部字幕，系统可以继续自动识别并生成中日双语字幕。',
        focusTermIds: ['local-subtitle-tip'],
      },
    ]

    let knowledgePoints: KnowledgePoint[] = [
      {
        id: 'local-subtitle-tip',
        kind: 'phrase',
        expression: '自动字幕',
        reading: 'じどうじまく',
        meaningZh: '自动识别生成字幕',
        partOfSpeech: '学习提示',
        explanationZh:
          '如果你没有现成字幕，系统会先从视频里提取音频，再自动生成日语时间轴字幕，并补出学习向中文提示。',
        exampleJa: '字幕がなくても、このあと自動生成できる。',
        exampleZh: '就算没有现成字幕，后面也可以自动生成。',
      },
    ]

    let subtitleFileName: string | undefined
    let subtitleSource: ImportedClip['subtitleSource']
    let sourceProvider = '本地原片'
    let description =
      '你导入的是本地原片。系统支持自动识别日语字幕，并进一步生成学习向中文字幕、词法高亮和知识点解析。'
    let creditLine =
      '只存储在当前设备，不会上传。自动字幕生成依赖浏览器端本地推理，首次运行会下载模型并缓存。'
    let tags = ['私有原片', clipTheme, '待生成字幕']

    if (subtitleFile) {
      try {
        const cues = await parseSubtitleFile(subtitleFile)
        const studyData = await buildStudyDataFromCues(cues)
        if (studyData.segments.length > 0) {
          segments = studyData.segments
          knowledgePoints = studyData.knowledgePoints
          subtitleFileName = subtitleFile.name
          subtitleSource = 'manual'
          sourceProvider = '本地原片 + 外部字幕'
          description =
            '你导入的是本地原片和外部字幕，播放器会直接显示片中日语字幕，并补充学习向中文字幕和知识点。'
          creditLine = '仅存储在当前设备，不会上传。片中例句和知识点都直接来自你导入的字幕。'
          tags = ['私有原片', clipTheme, '外部字幕']
        }
      } catch (error) {
        console.warn('Failed to parse subtitle file for imported clip.', error)
      }
    }

    const clip: ImportedClip = {
      id: `clip-${crypto.randomUUID()}`,
      title: clipTitle,
      theme: clipTheme,
      difficulty: 'Custom',
      importMode: 'raw',
      sourceType: 'local',
      sourceIdOrBlobKey: `blob-${crypto.randomUUID()}`,
      sourceFileName: file.name,
      sourceUrl: '',
      sourceProvider,
      cover,
      durationMs,
      fileType: file.type,
      subtitleFileName,
      subtitleSource,
      blob: file,
      createdAt: now,
      segments,
      knowledgePoints,
      tags,
      description,
      creditLine,
    }

    await saveImportedClip(clip)
    set((state) => {
      const importedClips = [clip, ...state.importedClips]
      return {
        importedClips,
        lessons: buildLessons(importedClips, state.publishedLessons),
      }
    })

    return clip
  },

  async importSelectedSlices({
    file,
    title,
    theme,
    cover,
    durationMs,
    subtitleFileName,
    subtitleSource,
    sourceProvider,
    sourceAnimeTitle,
    sourceEpisodeTitle,
    baseSegments,
    baseKnowledgePoints,
    selectedLessons,
  }) {
    if (selectedLessons.length === 0) {
      return []
    }

    const importedAt = new Date().toISOString()
    const sourceClipId = `clip-${crypto.randomUUID()}`
    const sourceBlobKey = `blob-${crypto.randomUUID()}`
    const sourceTitle = title.trim() || file.name.replace(/\.[^.]+$/, '')
    const sourceTheme = theme.trim() || '自定义片段'

    const sourceClip: ImportedClip = {
      id: sourceClipId,
      title: sourceTitle,
      theme: sourceTheme,
      difficulty: 'Custom',
      importMode: 'source',
      sourceAnimeTitle,
      sourceEpisodeTitle,
      sourceType: 'local',
      sourceIdOrBlobKey: sourceBlobKey,
      sourceFileName: file.name,
      sourceUrl: '',
      sourceProvider,
      cover,
      durationMs,
      fileType: file.type || 'video/mp4',
      subtitleFileName,
      subtitleSource,
      blob: file,
      createdAt: importedAt,
      segments: baseSegments,
      knowledgePoints: baseKnowledgePoints,
      tags: mergeTags(['页面自动切片源片', sourceTheme], sourceAnimeTitle ? [sourceAnimeTitle] : []),
      description: '这是页面内自动切片时保存的原片源，仅用于支撑后续切片播放，不会直接出现在首页短视频流。',
      creditLine: '仅保存在当前设备。切片预览确认后，首页会直接播放你勾选导入的学习片段。',
    }

    const importedSlices: ImportedClip[] = selectedLessons.map((lesson, index) => {
      const clipStartMs = lesson.clipStartMs ?? 0
      const clipEndMs = lesson.clipEndMs ?? clipStartMs + lesson.durationMs

      return {
        id: `clip-${crypto.randomUUID()}`,
        title: lesson.title,
        theme: lesson.theme || sourceTheme,
        difficulty: lesson.difficulty,
        importMode: 'sliced',
        sourceAnimeTitle: sourceAnimeTitle ?? sourceTitle,
        sourceEpisodeTitle,
        sourceSliceId: lesson.id || `preview-slice-${index + 1}`,
        sourceClipId,
        sourceType: 'local',
        sourceIdOrBlobKey: sourceBlobKey,
        sourceFileName: file.name,
        sourceUrl: '',
        sourceProvider: `${sourceProvider} · 页面自动切片`,
        cover: lesson.cover || cover,
        durationMs: lesson.durationMs,
        clipStartMs,
        clipEndMs,
        fileType: file.type || 'video/mp4',
        subtitleFileName,
        subtitleSource,
        createdAt: importedAt,
        segments: lesson.segments,
        knowledgePoints: lesson.knowledgePoints,
        tags: mergeTags(lesson.tags, ['页面自动切片', sourceTheme]),
        description: lesson.description,
        creditLine: '由页面内自动字幕与切片逻辑生成，可直接进入首页短视频模块学习。',
      }
    })

    await Promise.all([saveImportedClip(sourceClip), ...importedSlices.map((clip) => saveImportedClip(clip))])
    set((state) => {
      const importedClips = [sourceClip, ...importedSlices, ...state.importedClips]
      return {
        importedClips,
        lessons: buildLessons(importedClips, state.publishedLessons),
      }
    })

    return importedSlices
  },

  async deleteLocalLesson(lessonId) {
    const lesson = get().lessons.find((item) => item.id === lessonId)
    if (!lesson || lesson.sourceType !== 'local') {
      return false
    }

    const currentClips = get().importedClips
    const directClip = currentClips.find((clip) => clip.id === lessonId)
    const sourceClip = lesson.originClipId
      ? currentClips.find((clip) => clip.id === lesson.originClipId)
      : undefined

    const clipIdsToRemove = new Set<string>()
    if (directClip) {
      clipIdsToRemove.add(directClip.id)
      if (directClip.importMode === 'source') {
        currentClips
          .filter((clip) => clip.sourceClipId === directClip.id)
          .forEach((clip) => clipIdsToRemove.add(clip.id))
      }
    } else if (sourceClip) {
      clipIdsToRemove.add(sourceClip.id)
      if (sourceClip.importMode === 'source') {
        currentClips
          .filter((clip) => clip.sourceClipId === sourceClip.id)
          .forEach((clip) => clipIdsToRemove.add(clip.id))
      }
    }

    if (clipIdsToRemove.size === 0) {
      return false
    }

    await Promise.all([...clipIdsToRemove].map((id) => deleteImportedClip(id)))

    const nextImportedClips = currentClips.filter((clip) => !clipIdsToRemove.has(clip.id))
    const nextLessons = buildLessons(nextImportedClips, get().publishedLessons)
    const removedFavoriteIds = await purgeFavorites(
      get().lessons
        .filter(
          (item) =>
            item.id === lessonId ||
            clipIdsToRemove.has(item.id) ||
            (item.originClipId ? clipIdsToRemove.has(item.originClipId) : false),
        )
        .map((item) => item.id),
      get().favorites,
    )

    set((state) => ({
      importedClips: nextImportedClips,
      lessons: nextLessons,
      favorites: state.favorites.filter((id) => !removedFavoriteIds.includes(id)),
    }))

    return true
  },

  async importSlicerManifest({ manifestFile, clipFiles, theme }) {
    const manifest = await parseSlicerManifest(manifestFile)
    const fileMap = buildManifestClipFileMap(clipFiles)
    const importedAt = new Date().toISOString()
    const currentClips = get().importedClips
    const prepared: ImportedClip[] = []
    const missingFiles: string[] = []

    for (const manifestClip of manifest.clips) {
      const videoFileName = getManifestClipFileName(manifestClip)
      const matchedFile = fileMap[videoFileName.trim().toLowerCase()]

      if (!matchedFile) {
        missingFiles.push(videoFileName)
        continue
      }

      const sourceTag = theme?.trim() || manifest.animeTitle
      const { durationMs: detectedDurationMs, cover } = await readVideoMeta(
        matchedFile,
        manifestClip.clipTitle,
        sourceTag,
      )

      const existing = currentClips.find(
        (clip) =>
          clip.importMode === 'sliced' &&
          clip.sourceAnimeTitle === manifest.animeTitle &&
          clip.sourceEpisodeTitle === manifest.episodeTitle &&
          clip.sourceSliceId === manifestClip.id,
      )

      prepared.push({
        id: existing?.id ?? `clip-${crypto.randomUUID()}`,
        title: manifestClip.clipTitle,
        theme: sourceTag,
        difficulty: 'Custom',
        importMode: 'sliced',
        sourceAnimeTitle: manifest.animeTitle,
        sourceEpisodeTitle: manifest.episodeTitle,
        sourceSliceId: manifestClip.id,
        sourceType: 'local',
        sourceIdOrBlobKey: existing?.sourceIdOrBlobKey ?? `blob-${crypto.randomUUID()}`,
        sourceFileName: matchedFile.name,
        sourceUrl: '',
        sourceProvider: `切片导入 / ${manifest.animeTitle}${
          manifest.episodeTitle ? ` / ${manifest.episodeTitle}` : ''
        }`,
        cover,
        durationMs:
          manifestClip.durationMs > 0 ? manifestClip.durationMs : detectedDurationMs,
        fileType: matchedFile.type || 'video/mp4',
        subtitleFileName: manifestClip.subtitlePath
          ? getManifestClipFileName({
              ...manifestClip,
              videoPath: manifestClip.subtitlePath,
            })
          : manifestFile.name,
        subtitleSource: getManifestSubtitleSource(manifest, manifestClip),
        blob: matchedFile,
        createdAt: existing?.createdAt ?? importedAt,
        segments: manifestClip.segments,
        knowledgePoints: manifestClip.knowledgePoints,
        tags: mergeTags(
          ['切片导入', manifest.animeTitle, sourceTag],
          manifest.episodeTitle ? [manifest.episodeTitle] : [],
          manifestClip.keywords,
        ),
        description:
          manifestClip.keyNotes.join(' / ') ||
          manifestClip.transcriptZh ||
          '这条切片已经带好片中字幕、知识点和例句，可直接进入首页短视频流学习。',
        creditLine:
          '由 anime-learning-slicer 导出后导入本站，仅保存在当前设备；首页会直接按切片播放，不再二次切片。',
      })
    }

    if (prepared.length === 0) {
      throw new Error(
        missingFiles.length > 0
          ? `manifest 已读取，但没有匹配到切片视频文件：${missingFiles.join('、')}`
          : 'manifest 已读取，但没有可导入的切片。',
      )
    }

    await Promise.all(prepared.map((clip) => saveImportedClip(clip)))
    set((state) => {
      const replacedIds = new Set(prepared.map((clip) => clip.id))
      const importedClips = [
        ...prepared,
        ...state.importedClips.filter((clip) => !replacedIds.has(clip.id)),
      ]

      return {
        importedClips,
        lessons: buildLessons(importedClips, state.publishedLessons),
      }
    })

    return prepared
  },

  async generateAutoSubtitles(clipId, onStatus) {
    const clip = get().importedClips.find((item) => item.id === clipId)
    if (!clip || !clip.blob || !(clip.blob instanceof File)) {
      return null
    }

    onStatus?.('准备自动字幕…')
    const { generateStudyDataFromVideo } = await import('../lib/autoSubtitles')
    const studyData = await generateStudyDataFromVideo(clip.blob as File, clip.durationMs, onStatus)

    const updatedClip: ImportedClip = {
      ...clip,
      subtitleFileName: '自动生成字幕',
      subtitleSource: 'auto',
      sourceProvider: `本地原片 + 自动字幕 (${studyData.modelLabel})`,
      segments: studyData.segments,
      knowledgePoints: studyData.knowledgePoints,
      description:
        '系统已从视频自动识别出日语时间轴字幕，并补充学习向中文字幕、高亮词法和知识点解析。',
      creditLine:
        '自动字幕仅供个人学习校对使用，数据仍然只存储在当前设备。首次运行会下载并缓存本地语音识别模型。',
      tags: mergeTags(
        [ ...clip.tags.filter((tag) => tag !== '待生成字幕' && tag !== '外部字幕') ],
        ['自动字幕'],
        clip.theme ? [clip.theme] : [],
      ),
    }

    await saveImportedClip(updatedClip)
    set((state) => {
      const importedClips = state.importedClips.map((item) =>
        item.id === clipId ? updatedClip : item,
      )
      return {
        importedClips,
        lessons: buildLessons(importedClips, state.publishedLessons),
      }
    })

    onStatus?.('自动字幕已生成')
    return updatedClip
  },

  async updateSettings(updates) {
    const next: AppSettings = {
      ...get().settings,
      ...updates,
      id: 'settings',
    }
    await saveSettings(next)
    set({ settings: next })
  },
}))
