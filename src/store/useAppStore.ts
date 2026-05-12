import { create } from 'zustand'

import { defaultGoal, defaultSettings } from '../lib/defaults'
import { getTodayKey } from '../lib/date'
import { buildLessonsFromImportedClip } from '../lib/lessonSlices'
import { loadPublishedLessons } from '../lib/publishedLessons'
import {
  buildGrammarStudyLessons,
  buildStudyIndex,
  buildTermStudyLessons,
  type GrammarStudyRequest,
  type TermStudyRequest,
} from '../lib/studyIndex'
import {
  buildManifestClipFileMap,
  getManifestCoverFileName,
  getManifestClipFileName,
  getManifestSubtitleFileName,
  getMissingManifestAssetMessages,
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
  deleteLocalVideoBlob,
  createLocalVideoBlobKey,
  isLocalVideoBlobKey,
  deleteNote,
  listFavorites,
  listImportedClips,
  listNotes,
  listReviewItems,
  listReviewLogs,
  listStudyEvents,
  listVocabProgress,
  loadLocalVideoFile,
  loadGoal,
  loadSettings,
  removeFavorite,
  saveFavorite,
  saveGoal,
  saveImportedClip,
  saveImportedClips,
  saveLocalVideoBlob,
  saveNote,
  saveReviewItem,
  saveReviewItems,
  saveReviewLog,
  saveSettings,
  saveStudyEvent,
  saveVocabProgress,
} from '../lib/storage'
import {
  deleteSiteVideos,
  isManagedSiteVideoUrl,
  uploadVideoToSite,
} from '../lib/siteVideoStorage'
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
  TranscriptSegment,
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

    if (clip.importMode === 'raw') {
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

const COVER_MAX_WIDTH = 640
const COVER_MAX_HEIGHT = 360
const COVER_JPEG_QUALITY = 0.76

function getCoverSize(sourceWidth: number, sourceHeight: number) {
  const width = sourceWidth || 1280
  const height = sourceHeight || 720
  const scale = Math.min(1, COVER_MAX_WIDTH / width, COVER_MAX_HEIGHT / height)

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function captureVideoCover(
  video: HTMLVideoElement,
  title: string,
  theme: string,
  durationMs: number,
) {
  try {
    const sourceWidth = video.videoWidth || 1280
    const sourceHeight = video.videoHeight || 720
    const coverSize = getCoverSize(sourceWidth, sourceHeight)
    const canvas = document.createElement('canvas')
    canvas.width = coverSize.width
    canvas.height = coverSize.height
    const context = canvas.getContext('2d')
    if (!context) {
      return createCoverSvg(title, theme)
    }

    context.drawImage(video, 0, 0, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
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
    return canvas.toDataURL('image/jpeg', COVER_JPEG_QUALITY)
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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error(`无法读取文件：${file.name}`))
    }
    reader.onerror = () => reject(new Error(`无法读取文件：${file.name}`))
    reader.readAsDataURL(file)
  })
}

function mergeTags(...groups: Array<Array<string | undefined>>) {
  return [...new Set(groups.flat().filter((item): item is string => Boolean(item && item.trim())))]
}

function stableClipId(prefix: string, rawId: string) {
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return `${prefix}-${safeId}`.slice(0, 160)
}

function buildGeneratedStudyClips({
  lessons,
  baseClips,
  idPrefix,
  extraTag,
}: {
  lessons: VideoLesson[]
  baseClips: ImportedClip[]
  idPrefix: string
  extraTag: string
}) {
  const createdAt = new Date().toISOString()
  const existingById = new Map(baseClips.map((clip) => [clip.id, clip]))
  const sourceClipById = new Map(baseClips.map((clip) => [clip.id, clip]))

  return lessons.map<ImportedClip>((lesson) => {
    const id = stableClipId(idPrefix, lesson.id)
    const existing = existingById.get(id)
    const sourceClip = lesson.originClipId ? sourceClipById.get(lesson.originClipId) : undefined
    const clipStartMs = lesson.clipStartMs ?? 0
    const clipEndMs = lesson.clipEndMs ?? clipStartMs + lesson.durationMs

    return {
      id,
      title: lesson.title,
      theme: lesson.theme,
      difficulty: lesson.difficulty,
      importMode: 'sliced',
      sourceAnimeTitle: sourceClip?.title ?? lesson.theme,
      sourceSliceId: lesson.id,
      sourceClipId: lesson.originClipId,
      sourceType: 'local',
      sourceIdOrBlobKey: lesson.sourceIdOrBlobKey,
      sourceFileName: lesson.sourceFileName,
      sourceUrl: lesson.sourceUrl,
      sourceProvider: `${lesson.sourceProvider} / 按需生成`,
      cover: lesson.cover,
      durationMs: lesson.durationMs,
      clipStartMs,
      clipEndMs,
      fileType: sourceClip?.fileType ?? 'video/mp4',
      subtitleFileName: sourceClip?.subtitleFileName,
      subtitleSource: lesson.tags.includes('可信字幕') ? 'manual' : 'auto',
      blob: sourceClip?.blob,
      createdAt: existing?.createdAt ?? createdAt,
      segments: lesson.segments,
      knowledgePoints: lesson.knowledgePoints,
      tags: mergeTags(lesson.tags, [extraTag]),
      description: lesson.description,
      creditLine: lesson.creditLine,
    }
  })
}

async function uploadManagedVideo(
  file: File,
  title: string,
  uploadPassword?: string,
  onUploadProgress?: RemoteUploadStatusCallback,
) {
  onUploadProgress?.('正在上传视频到网站…', 0)

  const uploaded = await uploadVideoToSite({
    file,
    title,
    uploadPassword,
    onUploadProgress: (event) => {
      onUploadProgress?.(
        `正在上传视频到网站… ${Math.round(event.percentage)}%`,
        event.percentage,
      )
    },
  })

  onUploadProgress?.('视频已上传到网站，正在写入学习资料…', 100)
  return uploaded
}

async function attachCachedLocalVideos(importedClips: ImportedClip[]) {
  return Promise.all(
    importedClips.map(async (clip) => {
      if (!isLocalVideoBlobKey(clip.sourceIdOrBlobKey) || clip.blob) {
        return clip
      }

      const file = await loadLocalVideoFile(
        clip.sourceIdOrBlobKey,
        clip.sourceFileName || `${clip.id}.mp4`,
        clip.fileType,
      )
      return file ? { ...clip, blob: file } : clip
    }),
  )
}

function markSourceProviderUploaded(sourceProvider: string) {
  const base = sourceProvider
    .split(' / ')
    .filter((item) => item && item !== '本地草稿' && item !== '本地待上传' && item !== '浏览器本地暂存')
  return [...new Set([...base, '站内存储'])].join(' / ')
}

function markTagsUploaded(tags: string[]) {
  return mergeTags(
    tags.filter((tag) => tag !== '本地草稿' && tag !== '本地待上传' && tag !== '浏览器本地暂存'),
    ['站内存储'],
  )
}

function markClipUploaded(
  clip: ImportedClip,
  uploaded: Awaited<ReturnType<typeof uploadManagedVideo>>,
) {
  const next: ImportedClip = {
    ...clip,
    sourceIdOrBlobKey: uploaded.pathname,
    sourceUrl: uploaded.url,
    sourceProvider: markSourceProviderUploaded(clip.sourceProvider),
    fileType: clip.fileType || uploaded.contentType || 'video/mp4',
    tags: markTagsUploaded(clip.tags),
    creditLine:
      '视频文件已上传到网站存储；当前浏览器保留学习信息、字幕分析结果和切片配置。',
  }
  delete next.blob
  return next
}

const runtimeStudyIndexCache = new Map<string, NonNullable<ImportedClip['studyIndex']>>()

function buildSegmentsCacheHash(segments: TranscriptSegment[]) {
  let hash = 0

  for (const segment of segments) {
    const value = `${segment.startMs}|${segment.endMs}|${segment.ja}|${segment.zh}`
    for (let index = 0; index < value.length; index += 1) {
      hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
    }
  }

  return (hash >>> 0).toString(36)
}

function getRuntimeStudyIndexCacheKey(clip: ImportedClip) {
  return [
    clip.id,
    clip.subtitleSource ?? 'none',
    clip.studyIndex?.quality ?? 'none',
    clip.segments.length,
    buildSegmentsCacheHash(clip.segments),
  ].join(':')
}

function applyStoredIndexQuality(clip: ImportedClip, studyIndex: NonNullable<ImportedClip['studyIndex']>) {
  if (clip.studyIndex?.quality !== 'trusted') {
    return studyIndex
  }

  return {
    ...studyIndex,
    status: 'ready' as const,
    quality: 'trusted' as const,
    sourceLabel: `${studyIndex.sourceLabel} / 用户已确认`,
    summary: {
      ...studyIndex.summary,
      trusted: true,
    },
  }
}

async function buildRuntimeIndexedClips(importedClips: ImportedClip[]) {
  return Promise.all(
    importedClips.map(async (clip) => {
      if (clip.importMode === 'sliced' || !clip.subtitleSource || clip.segments.length === 0) {
        return clip
      }

      const cacheKey = getRuntimeStudyIndexCacheKey(clip)
      const cachedStudyIndex = runtimeStudyIndexCache.get(cacheKey)
      const studyIndex =
        cachedStudyIndex ??
        (await buildStudyIndex({
          videoId: clip.id,
          segments: clip.segments,
          subtitleSource: clip.subtitleSource,
        }))

      if (!cachedStudyIndex) {
        runtimeStudyIndexCache.set(cacheKey, studyIndex)
      }

      return {
        ...clip,
        studyIndex: applyStoredIndexQuality(clip, studyIndex),
      }
    }),
  )
}

async function loadClipProcessingFile(clip: ImportedClip) {
  if (clip.blob instanceof File) {
    return clip.blob
  }

  if (clip.blob) {
    return new File([clip.blob], clip.sourceFileName || `${clip.id}.mp4`, {
      type: clip.blob.type || clip.fileType || 'video/mp4',
      lastModified: 0,
    })
  }

  if (isLocalVideoBlobKey(clip.sourceIdOrBlobKey)) {
    const localFile = await loadLocalVideoFile(
      clip.sourceIdOrBlobKey,
      clip.sourceFileName || `${clip.id}.mp4`,
      clip.fileType,
    )
    if (localFile) {
      return localFile
    }
  }

  if (!clip.sourceUrl) {
    return null
  }

  try {
    const response = await fetch(clip.sourceUrl)
    if (!response.ok) {
      throw new Error(`站内存储返回 ${response.status}`)
    }

    const blob = await response.blob()
    return new File([blob], clip.sourceFileName || `${clip.id}.mp4`, {
      type: blob.type || clip.fileType || 'video/mp4',
      lastModified: Date.now(),
    })
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : '网络请求失败'
    throw new Error(`无法读取用于自动字幕的视频文件：${message}。请刷新后重试，或重新导入原视频。`)
  }
}

async function purgeFavorites(lessonIds: string[], favorites: string[]) {
  const idsToRemove = lessonIds.filter((id) => favorites.includes(id))
  await Promise.all(idsToRemove.map((id) => removeFavorite(id)))
  return idsToRemove
}

function collectGeneratedStudyChildIds(importedClips: ImportedClip[], sourceClipId: string) {
  return importedClips
    .filter(
      (item) =>
        item.sourceClipId === sourceClipId &&
        item.importMode === 'sliced' &&
        (item.tags.includes('按需语法切片') || item.tags.includes('按需单词切片')),
    )
    .map((item) => item.id)
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
  uploadPassword?: string
  onUploadProgress?: RemoteUploadStatusCallback
}

interface ImportSlicerManifestInput {
  manifestFile: File
  clipFiles: File[]
  theme?: string
  uploadPassword?: string
  onUploadProgress?: RemoteUploadStatusCallback
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
  uploadPassword?: string
  onUploadProgress?: RemoteUploadStatusCallback
}

type SubtitleStatusCallback = (message: string) => void
type RemoteUploadStatusCallback = (message: string, percent?: number) => void

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
  uploadClipToSite: (
    clipId: string,
    uploadPassword?: string,
    onUploadProgress?: RemoteUploadStatusCallback,
  ) => Promise<ImportedClip | null>
  importSlicerManifest: (payload: ImportSlicerManifestInput) => Promise<ImportedClip[]>
  importSelectedSlices: (payload: ImportSelectedSlicesInput) => Promise<ImportedClip[]>
  generateGrammarStudyBatch: (payload: GrammarStudyRequest) => Promise<ImportedClip[]>
  generateTermStudyBatch: (payload: TermStudyRequest) => Promise<ImportedClip[]>
  markClipStudyIndexTrusted: (clipId: string) => Promise<boolean>
  replaceClipSubtitle: (clipId: string, subtitleFile: File) => Promise<ImportedClip | null>
  updateClipTranscript: (
    clipId: string,
    segments: TranscriptSegment[],
    trusted: boolean,
  ) => Promise<ImportedClip | null>
  deleteLocalLesson: (lessonId: string, uploadPassword?: string) => Promise<boolean>
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
    const hydratedImportedClips = await attachCachedLocalVideos(importedClips)

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
      importedClips: hydratedImportedClips,
      publishedLessons,
      lessons: buildLessons(hydratedImportedClips, publishedLessons),
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

  async importClip({ file, subtitleFile, title, theme, uploadPassword, onUploadProgress }) {
    const clipTitle = title?.trim() || file.name.replace(/\.[^.]+$/, '')
    const clipTheme = theme?.trim() || '自定义片段'
    const { durationMs, cover } = await readVideoMeta(file, clipTitle, clipTheme)
    const now = new Date().toISOString()
    const clipId = `clip-${crypto.randomUUID()}`
    const localVideoKey = createLocalVideoBlobKey(clipId)

    let segments: TranscriptSegment[] = [
      {
        startMs: 0,
        endMs: durationMs,
        ja: '正在等待字幕。你可以先看原片，也可以让系统自动识别日语字幕并生成学习向中文字幕。',
        kana: 'じまく を じどう せいせい すると、 ここ に げんぶん が でます。',
        romaji: 'jimaku o jidou seisei suru to, koko ni genbun ga demasu.',
        zh: '导入完成后，如果没有外部字幕，系统可以继续自动识别并生成中日双语字幕。',
        focusTermIds: [],
      },
    ]

    let knowledgePoints: KnowledgePoint[] = []

    let subtitleFileName: string | undefined
    let subtitleSource: ImportedClip['subtitleSource']
    let sourceProvider = '本地原片'
    let description =
      '你导入的是本地原片。系统会先生成中日字幕时间轴，单词和语法切片会在后续执行学习计划时动态生成。'
    let creditLine =
      '视频会先暂存在当前浏览器，不会立刻上传。自动字幕生成依赖浏览器端本地推理，首次运行会下载模型并缓存。'
    let tags = ['私有原片', clipTheme, '待生成字幕']

    if (subtitleFile) {
      try {
        const cues = await parseSubtitleFile(subtitleFile)
        const studyData = await buildStudyDataFromCues(cues, { includeKnowledge: false })
        if (studyData.segments.length > 0) {
          segments = studyData.segments
          knowledgePoints = studyData.knowledgePoints
          subtitleFileName = subtitleFile.name
          subtitleSource = 'manual'
          sourceProvider = '本地原片 + 外部字幕'
          description =
            '你导入的是本地原片和外部字幕，系统只保存中日字幕时间轴，后续按学习计划动态匹配单词和语法。'
          creditLine = '视频会先暂存在当前浏览器，不会立刻上传。片中例句直接来自你导入的字幕。'
          tags = ['私有原片', clipTheme, '外部字幕']
        }
      } catch (error) {
        console.warn('Failed to parse subtitle file for imported clip.', error)
      }
    }

    const studyIndex = subtitleSource
      ? await buildStudyIndex({
          videoId: clipId,
          segments,
          subtitleSource,
          includeOccurrences: false,
        })
      : undefined

    void uploadPassword
    await saveLocalVideoBlob(localVideoKey, file, file.name)
    onUploadProgress?.('视频已暂存到当前浏览器，正在写入字幕时间轴…', 100)

    const clip: ImportedClip = {
      id: clipId,
      title: clipTitle,
      theme: clipTheme,
      difficulty: 'Custom',
      importMode: 'raw',
      sourceType: 'local',
      sourceIdOrBlobKey: localVideoKey,
      sourceFileName: file.name,
      sourceUrl: '',
      sourceProvider: `${sourceProvider} / 本地草稿`,
      cover,
      durationMs,
      fileType: file.type || 'video/mp4',
      subtitleFileName,
      subtitleSource,
      blob: file,
      studyIndex,
      createdAt: now,
      segments,
      knowledgePoints,
      tags: mergeTags(tags, ['本地草稿'], studyIndex ? ['字幕时间轴'] : []),
      description,
      creditLine: `${creditLine} 你可以先预览和编辑字幕，确认后再上传整片到网站存储。`,
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

  async uploadClipToSite(clipId, uploadPassword, onUploadProgress) {
    const clip = get().importedClips.find((item) => item.id === clipId)
    if (!clip) {
      return null
    }

    if (clip.sourceUrl && !isLocalVideoBlobKey(clip.sourceIdOrBlobKey)) {
      return clip
    }

    if (clip.importMode === 'raw' && clip.studyIndex?.quality !== 'trusted') {
      throw new Error('请先预览并确认字幕可信后，再上传整片到站点。')
    }

    const file = await loadClipProcessingFile(clip)
    if (!file) {
      throw new Error('当前浏览器没有找到原视频文件。请重新导入视频后再上传。')
    }

    const uploadedVideo = await uploadManagedVideo(
      file,
      clip.title,
      uploadPassword,
      onUploadProgress,
    )
    const affectedClips = get().importedClips
      .filter(
        (item) =>
          item.id === clip.id ||
          item.sourceClipId === clip.id ||
          item.sourceIdOrBlobKey === clip.sourceIdOrBlobKey,
      )
      .map((item) => markClipUploaded(item, uploadedVideo))

    await saveImportedClips(affectedClips)
    await deleteLocalVideoBlob(clip.sourceIdOrBlobKey)

    const affectedById = new Map(affectedClips.map((item) => [item.id, item]))
    set((state) => {
      const importedClips = state.importedClips.map((item) => affectedById.get(item.id) ?? item)
      return {
        importedClips,
        lessons: buildLessons(importedClips, state.publishedLessons),
      }
    })

    return affectedById.get(clip.id) ?? null
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
    uploadPassword,
    onUploadProgress,
  }) {
    if (selectedLessons.length === 0) {
      return []
    }

    const importedAt = new Date().toISOString()
    const sourceClipId = `clip-${crypto.randomUUID()}`
    const sourceTitle = title.trim() || file.name.replace(/\.[^.]+$/, '')
    const sourceTheme = theme.trim() || '自定义片段'
    const uploadedVideo = await uploadManagedVideo(
      file,
      sourceTitle,
      uploadPassword,
      onUploadProgress,
    )
    const sourceStudyIndex = await buildStudyIndex({
      videoId: sourceClipId,
      segments: baseSegments,
      subtitleSource,
      includeOccurrences: false,
    })

    const sourceClip: ImportedClip = {
      id: sourceClipId,
      title: sourceTitle,
      theme: sourceTheme,
      difficulty: 'Custom',
      importMode: 'source',
      sourceAnimeTitle,
      sourceEpisodeTitle,
      sourceType: 'local',
      sourceIdOrBlobKey: uploadedVideo.pathname,
      sourceFileName: file.name,
      sourceUrl: uploadedVideo.url,
      sourceProvider: `${sourceProvider} / 站内存储`,
      cover,
      durationMs,
      fileType: file.type || uploadedVideo.contentType || 'video/mp4',
      subtitleFileName,
      subtitleSource,
      blob: file,
      studyIndex: sourceStudyIndex,
      createdAt: importedAt,
      segments: baseSegments,
      knowledgePoints: baseKnowledgePoints,
      tags: mergeTags(
        ['页面自动切片源片', sourceTheme, '站内存储'],
        sourceAnimeTitle ? [sourceAnimeTitle] : [],
      ),
      description: '这是页面内自动切片时保存的原片源，仅用于支撑后续切片播放，不会直接出现在首页短视频流。',
      creditLine:
        '视频文件已上传到网站存储，当前浏览器只保留切片配置与学习信息，确认导入后首页会直接播放这些片段。',
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
        sourceIdOrBlobKey: uploadedVideo.pathname,
        sourceFileName: file.name,
        sourceUrl: uploadedVideo.url,
        sourceProvider: `${sourceProvider} / 页面自动切片 / 站内存储`,
        cover: lesson.cover || cover,
        durationMs: lesson.durationMs,
        clipStartMs,
        clipEndMs,
        fileType: file.type || uploadedVideo.contentType || 'video/mp4',
        subtitleFileName,
        subtitleSource,
        createdAt: importedAt,
        segments: lesson.segments,
        knowledgePoints: lesson.knowledgePoints,
        tags: mergeTags(lesson.tags, ['页面自动切片', sourceTheme, '站内存储']),
        description: lesson.description,
        creditLine:
          '视频文件已上传到网站存储，播放器会直接按切片时间段播放，不再依赖当前浏览器本地文件。',
      }
    })

    await saveImportedClips([sourceClip, ...importedSlices])
    set((state) => {
      const importedClips = [sourceClip, ...importedSlices, ...state.importedClips]
      return {
        importedClips,
        lessons: buildLessons(importedClips, state.publishedLessons),
      }
    })

    return importedSlices
  },

  async generateGrammarStudyBatch(payload) {
    const baseClips = await buildRuntimeIndexedClips(get().importedClips)
    const generatedLessons = buildGrammarStudyLessons(baseClips, payload)
    if (generatedLessons.length === 0) {
      return []
    }

    const generatedClips = buildGeneratedStudyClips({
      lessons: generatedLessons,
      baseClips,
      idPrefix: 'clip-grammar',
      extraTag: '按需语法切片',
    })

    await saveImportedClips(generatedClips)
    set((state) => {
      const generatedIds = new Set(generatedClips.map((clip) => clip.id))
      const importedClips = [
        ...generatedClips,
        ...state.importedClips.filter((clip) => !generatedIds.has(clip.id)),
      ]
      return {
        importedClips,
        lessons: buildLessons(importedClips, state.publishedLessons),
      }
    })

    return generatedClips
  },

  async generateTermStudyBatch(payload) {
    const baseClips = await buildRuntimeIndexedClips(get().importedClips)
    const generatedLessons = buildTermStudyLessons(baseClips, payload)
    if (generatedLessons.length === 0) {
      return []
    }

    const generatedClips = buildGeneratedStudyClips({
      lessons: generatedLessons,
      baseClips,
      idPrefix: 'clip-term',
      extraTag: '按需单词切片',
    })

    await saveImportedClips(generatedClips)
    set((state) => {
      const generatedIds = new Set(generatedClips.map((clip) => clip.id))
      const importedClips = [
        ...generatedClips,
        ...state.importedClips.filter((clip) => !generatedIds.has(clip.id)),
      ]
      return {
        importedClips,
        lessons: buildLessons(importedClips, state.publishedLessons),
      }
    })

    return generatedClips
  },

  async markClipStudyIndexTrusted(clipId) {
    const clip = get().importedClips.find((item) => item.id === clipId)
    if (!clip?.studyIndex) {
      return false
    }

    const updatedClip: ImportedClip = {
      ...clip,
      studyIndex: {
        ...clip.studyIndex,
        status: 'ready',
        quality: 'trusted',
        sourceLabel: `${clip.studyIndex.sourceLabel} / 用户已确认`,
        summary: {
          ...clip.studyIndex.summary,
          trusted: true,
        },
      },
      tags: mergeTags(
        clip.tags.filter((tag) => tag !== '字幕待校对'),
        ['字幕已确认'],
      ),
    }
    const updatedChildren = get().importedClips
      .filter((item) => item.sourceClipId === clipId)
      .map<ImportedClip>((item) => ({
        ...item,
        subtitleSource: 'manual',
        tags: mergeTags(
          item.tags.filter((tag) => tag !== '字幕待校对'),
          ['可信字幕', '字幕已确认'],
        ),
        creditLine: item.creditLine.replace('自动字幕草稿', '已确认字幕时间轴'),
      }))

    await saveImportedClips([updatedClip, ...updatedChildren])
    set((state) => {
      const importedClips = state.importedClips.map((item) => {
        if (item.id === clipId) {
          return updatedClip
        }

        return updatedChildren.find((child) => child.id === item.id) ?? item
      })
      return {
        importedClips,
        lessons: buildLessons(importedClips, state.publishedLessons),
      }
    })

    return true
  },

  async replaceClipSubtitle(clipId, subtitleFile) {
    const clip = get().importedClips.find((item) => item.id === clipId)
    if (!clip || clip.importMode === 'sliced') {
      return null
    }

    const cues = await parseSubtitleFile(subtitleFile)
    const studyData = await buildStudyDataFromCues(cues, { includeKnowledge: false })
    if (studyData.segments.length === 0) {
      throw new Error('字幕文件里没有可用的日文时间轴，请检查字幕格式或内容。')
    }

    const studyIndex = await buildStudyIndex({
      videoId: clip.id,
      segments: studyData.segments,
      subtitleSource: 'manual',
      includeOccurrences: false,
    })
    const updatedClip: ImportedClip = {
      ...clip,
      subtitleFileName: subtitleFile.name,
      subtitleSource: 'manual',
      studyIndex,
      sourceProvider: `${clip.sourceProvider} / 外部字幕`,
      segments: studyData.segments,
      knowledgePoints: studyData.knowledgePoints,
      tags: mergeTags(
        clip.tags.filter(
          (tag) =>
            ![
              '待生成字幕',
              '自动字幕',
              '字幕兜底',
              '字幕待校对',
              '外部字幕',
              '字幕索引',
              '字幕时间轴',
              '字幕已确认',
            ].includes(tag),
        ),
        ['外部字幕', '字幕时间轴', '字幕已确认'],
      ),
      description:
        '这部整片已绑定外部字幕，后续单词和语法切片会从中日字幕时间轴动态生成。',
      creditLine:
        '视频文件保存在网站存储中；字幕来自你上传的外部字幕文件，学习切片会直接播放原视频的对应时间段。',
    }
    const generatedChildIds = collectGeneratedStudyChildIds(get().importedClips, clipId)

    await saveImportedClip(updatedClip)
    await Promise.all(generatedChildIds.map((id) => deleteImportedClip(id)))
    const removedFavoriteIds = await purgeFavorites(generatedChildIds, get().favorites)

    set((state) => {
      const generatedIdSet = new Set(generatedChildIds)
      const importedClips = state.importedClips
        .map((item) => (item.id === clipId ? updatedClip : item))
        .filter((item) => !generatedIdSet.has(item.id))

      return {
        importedClips,
        lessons: buildLessons(importedClips, state.publishedLessons),
        favorites: state.favorites.filter((id) => !removedFavoriteIds.includes(id)),
      }
    })

    return updatedClip
  },

  async updateClipTranscript(clipId, segments, trusted) {
    const clip = get().importedClips.find((item) => item.id === clipId)
    if (!clip) {
      return null
    }

    const cleanSegments = segments
      .map((segment) => ({
        ...segment,
        ja: segment.ja.trim(),
        zh: segment.zh.trim(),
        kana: segment.kana.trim(),
        romaji: segment.romaji.trim(),
        focusTermIds: [],
      }))
      .filter((segment) => segment.ja && segment.endMs > segment.startMs)

    if (cleanSegments.length === 0) {
      return null
    }

    const subtitleSource: ImportedClip['subtitleSource'] = trusted ? 'manual' : clip.subtitleSource ?? 'auto'
    const studyIndex = await buildStudyIndex({
      videoId: clip.id,
      segments: cleanSegments,
      subtitleSource,
      includeOccurrences: false,
    })
    const updatedClip: ImportedClip = {
      ...clip,
      subtitleSource,
      subtitleFileName: trusted ? clip.subtitleFileName ?? '手动校对字幕' : clip.subtitleFileName,
      studyIndex: trusted
        ? {
            ...studyIndex,
            status: 'ready',
            quality: 'trusted',
            sourceLabel: `${studyIndex.sourceLabel} / 用户已校对`,
            summary: {
              ...studyIndex.summary,
              trusted: true,
            },
          }
        : studyIndex,
      segments: cleanSegments,
      tags: mergeTags(
        clip.tags.filter(
          (tag) =>
            tag !== '字幕兜底' &&
            tag !== '待生成字幕' &&
            tag !== '字幕待校对' &&
            tag !== '字幕索引',
        ),
        ['字幕时间轴'],
        trusted ? ['字幕已确认'] : ['字幕待校对'],
      ),
      description: trusted
        ? '这部整片的字幕已经过人工复核，后续单词和语法切片会从中日字幕时间轴动态生成。'
        : clip.description,
    }

    const generatedChildIds = collectGeneratedStudyChildIds(get().importedClips, clipId)

    await saveImportedClip(updatedClip)
    await Promise.all(generatedChildIds.map((id) => deleteImportedClip(id)))
    const removedFavoriteIds = await purgeFavorites(generatedChildIds, get().favorites)

    set((state) => {
      const generatedIdSet = new Set(generatedChildIds)
      const importedClips = state.importedClips
        .map((item) => (item.id === clipId ? updatedClip : item))
        .filter((item) => !generatedIdSet.has(item.id))

      return {
        importedClips,
        lessons: buildLessons(importedClips, state.publishedLessons),
        favorites: state.favorites.filter((id) => !removedFavoriteIds.includes(id)),
      }
    })

    return updatedClip
  },

  async deleteLocalLesson(lessonId, uploadPassword) {
    const currentClips = get().importedClips
    const directClip = currentClips.find((clip) => clip.id === lessonId)
    const lesson = get().lessons.find((item) => item.id === lessonId)
    if (!directClip && (!lesson || lesson.sourceType !== 'local')) {
      return false
    }

    const sourceClip = lesson?.originClipId
      ? currentClips.find((clip) => clip.id === lesson.originClipId)
      : undefined

    const clipIdsToRemove = new Set<string>()
    if (directClip) {
      clipIdsToRemove.add(directClip.id)
      currentClips
        .filter((clip) => clip.sourceClipId === directClip.id)
        .forEach((clip) => clipIdsToRemove.add(clip.id))
    } else if (sourceClip) {
      clipIdsToRemove.add(sourceClip.id)
      currentClips
        .filter((clip) => clip.sourceClipId === sourceClip.id)
        .forEach((clip) => clipIdsToRemove.add(clip.id))
    }

    if (clipIdsToRemove.size === 0) {
      return false
    }

    const clipsToRemove = currentClips.filter((clip) => clipIdsToRemove.has(clip.id))
    const remainingClips = currentClips.filter((clip) => !clipIdsToRemove.has(clip.id))
    const remoteUrls = [
      ...new Set(
        clipsToRemove
          .map((clip) => clip.sourceUrl)
          .filter(
            (url) =>
              isManagedSiteVideoUrl(url) &&
              !remainingClips.some((clip) => clip.sourceUrl === url),
          ),
      ),
    ]

    if (remoteUrls.length > 0) {
      await deleteSiteVideos(remoteUrls, uploadPassword).catch((error) => {
        console.warn('Failed to delete site-hosted videos.', error)
      })
    }

    const localVideoKeys = [
      ...new Set(
        clipsToRemove
          .map((clip) => clip.sourceIdOrBlobKey)
          .filter((key) => isLocalVideoBlobKey(key)),
      ),
    ]
    await Promise.all(localVideoKeys.map((key) => deleteLocalVideoBlob(key)))

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

  async importSlicerManifest({ manifestFile, clipFiles, theme, uploadPassword, onUploadProgress }) {
    const manifest = await parseSlicerManifest(manifestFile)
    if (manifest.version !== 2) {
      throw new Error('请使用切片工具导出的 manifest v2。旧版 manifest 缺少封面、字幕、高亮和质量闸门信息，不能作为可发布切片导入。')
    }

    const fileMap = buildManifestClipFileMap(clipFiles)
    const missingAssetMessages = getMissingManifestAssetMessages(manifest, clipFiles)
    if (missingAssetMessages.length > 0) {
      throw new Error(`切片工具产物缺少必要文件：\n- ${missingAssetMessages.join('\n- ')}`)
    }

    const importedAt = new Date().toISOString()
    const currentClips = get().importedClips
    const prepared: ImportedClip[] = []
    const missingFiles: string[] = []
    const replacedRemoteUrls = new Set<string>()
    const uploadableClips = manifest.clips.filter((manifestClip) => {
      const videoFileName = getManifestClipFileName(manifestClip)
      return Boolean(fileMap[videoFileName.trim().toLowerCase()])
    })
    const totalUploads = Math.max(1, uploadableClips.length)
    let completedUploads = 0

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
      const coverFileName = getManifestCoverFileName(manifestClip)
      const matchedCoverFile = coverFileName ? fileMap[coverFileName.trim().toLowerCase()] : undefined
      const importedCover =
        matchedCoverFile && matchedCoverFile.type.startsWith('image/')
          ? await readFileAsDataUrl(matchedCoverFile)
          : cover
      const subtitleFileName = getManifestSubtitleFileName(manifestClip)

      const existing = currentClips.find(
        (clip) =>
          clip.importMode === 'sliced' &&
          clip.sourceAnimeTitle === manifest.animeTitle &&
          clip.sourceEpisodeTitle === manifest.episodeTitle &&
          clip.sourceSliceId === manifestClip.id,
      )

      const uploadedVideo = await uploadVideoToSite({
        file: matchedFile,
        title: manifestClip.clipTitle,
        uploadPassword,
        onUploadProgress: (event) => {
          const overallPercent = Math.round(
            ((completedUploads + event.percentage / 100) / totalUploads) * 100,
          )
          onUploadProgress?.(
            `正在上传切片到网站… ${completedUploads + 1}/${totalUploads}（${Math.round(
              event.percentage,
            )}%）`,
            overallPercent,
          )
        },
      })
      completedUploads += 1

      if (
        existing?.sourceUrl &&
        existing.sourceUrl !== uploadedVideo.url &&
        isManagedSiteVideoUrl(existing.sourceUrl)
      ) {
        replacedRemoteUrls.add(existing.sourceUrl)
      }

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
        sourceIdOrBlobKey: uploadedVideo.pathname,
        sourceFileName: matchedFile.name,
        sourceUrl: uploadedVideo.url,
        sourceProvider: `切片导入 / ${manifest.animeTitle}${
          manifest.episodeTitle ? ` / ${manifest.episodeTitle}` : ''
        } / 站内存储`,
        cover: importedCover,
        durationMs:
          manifestClip.durationMs > 0 ? manifestClip.durationMs : detectedDurationMs,
        fileType: matchedFile.type || uploadedVideo.contentType || 'video/mp4',
        subtitleFileName: subtitleFileName ?? manifestFile.name,
        subtitleSource: getManifestSubtitleSource(manifest, manifestClip),
        createdAt: existing?.createdAt ?? importedAt,
        segments: manifestClip.segments,
        knowledgePoints: manifestClip.knowledgePoints,
        tags: mergeTags(
          ['切片导入', manifest.animeTitle, sourceTag, '站内存储'],
          manifest.episodeTitle ? [manifest.episodeTitle] : [],
          manifestClip.keywords,
        ),
        description:
          manifestClip.keyNotes.join(' / ') ||
          manifestClip.transcriptZh ||
          '这条切片已经带好片中字幕、知识点和例句，可直接进入首页短视频流学习。',
        creditLine:
          '切片视频文件已上传到网站存储，当前浏览器只保留学习资料和导入记录。',
      })
    }

    if (prepared.length === 0) {
      throw new Error(
        missingFiles.length > 0
          ? `manifest 已读取，但没有匹配到切片视频文件：${missingFiles.join('、')}`
          : 'manifest 已读取，但没有可导入的切片。',
      )
    }

    onUploadProgress?.('切片视频已上传到网站，正在写入导入记录…', 100)

    await saveImportedClips(prepared)

    if (replacedRemoteUrls.size > 0) {
      await deleteSiteVideos([...replacedRemoteUrls], uploadPassword).catch((error) => {
        console.warn('Failed to clean up replaced site-hosted videos.', error)
      })
    }
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
    if (!clip) {
      return null
    }

    onStatus?.('准备自动字幕…')
    const clipFile = await loadClipProcessingFile(clip)
    if (!clipFile) {
      return null
    }

    const { generateStudyDataFromVideo } = await import('../lib/autoSubtitlesChunked')
    const studyData = await generateStudyDataFromVideo(clipFile, clip.durationMs, onStatus)
    const studyIndex = await buildStudyIndex({
      videoId: clip.id,
      segments: studyData.segments,
      subtitleSource: 'auto',
      includeOccurrences: false,
    })

    const updatedClip: ImportedClip = {
      ...clip,
      subtitleFileName:
        studyData.modelLabel.startsWith('视频自带字幕轨')
          ? studyData.modelLabel
          : '自动生成字幕',
      subtitleSource: 'auto',
      studyIndex,
      sourceProvider: `站内视频 + 字幕解析 (${studyData.modelLabel})`,
      segments: studyData.segments,
      knowledgePoints: studyData.knowledgePoints,
      description:
        '系统已优先尝试提取视频自带字幕轨，再尝试识别画面底部硬字幕；必要时才自动识别日语时间轴字幕，并补充学习向中文字幕。',
      creditLine:
        '视频文件保存在网站存储中；自动字幕仅供个人学习校对使用，首次运行会下载并缓存本地语音识别模型。',
      tags: mergeTags(
        [ ...clip.tags.filter((tag) => tag !== '待生成字幕' && tag !== '外部字幕' && tag !== '字幕已确认') ],
        ['自动字幕', '字幕时间轴', '字幕待校对'],
        clip.theme ? [clip.theme] : [],
        studyData.usedFallback ? ['字幕兜底'] : [],
      ),
    }
    const generatedChildIds = collectGeneratedStudyChildIds(get().importedClips, clipId)

    await saveImportedClip(updatedClip)
    await Promise.all(generatedChildIds.map((id) => deleteImportedClip(id)))
    const removedFavoriteIds = await purgeFavorites(generatedChildIds, get().favorites)
    set((state) => {
      const generatedIdSet = new Set(generatedChildIds)
      const importedClips = state.importedClips
        .map((item) => (item.id === clipId ? updatedClip : item))
        .filter((item) => !generatedIdSet.has(item.id))
      return {
        importedClips,
        lessons: buildLessons(importedClips, state.publishedLessons),
        favorites: state.favorites.filter((id) => !removedFavoriteIds.includes(id)),
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
