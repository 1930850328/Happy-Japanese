import type { KnowledgePoint, TranscriptSegment } from '../types'

export interface SlicerManifestClip {
  id: string
  clipTitle: string
  startMs: number
  endMs: number
  durationMs: number
  videoPath: string
  coverPath?: string
  subtitlePath?: string
  metadataPath?: string
  transcriptJa: string
  transcriptZh: string
  subtitleSource?: 'external' | 'auto'
  exampleJa: string
  exampleZh: string
  keyNotes: string[]
  keywords: string[]
  knowledgePoints: KnowledgePoint[]
  segments: TranscriptSegment[]
}

export interface SlicerManifestData {
  animeTitle: string
  episodeTitle?: string
  sourceVideo?: string
  subtitleSource?: 'external' | 'auto'
  generatedAt?: string
  clipCount?: number
  clips: SlicerManifestClip[]
}

function basenameFromPath(input: string) {
  return input.split(/[/\\]/).pop() ?? input
}

function normalizeFileKey(input: string) {
  return basenameFromPath(input).trim().toLowerCase()
}

function isTranscriptSegment(value: unknown): value is TranscriptSegment {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as TranscriptSegment
  return (
    typeof item.startMs === 'number' &&
    typeof item.endMs === 'number' &&
    typeof item.ja === 'string' &&
    typeof item.kana === 'string' &&
    typeof item.romaji === 'string' &&
    typeof item.zh === 'string' &&
    Array.isArray(item.focusTermIds)
  )
}

function isKnowledgePoint(value: unknown): value is KnowledgePoint {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as KnowledgePoint
  return (
    typeof item.id === 'string' &&
    typeof item.kind === 'string' &&
    typeof item.expression === 'string' &&
    typeof item.reading === 'string' &&
    typeof item.meaningZh === 'string' &&
    typeof item.partOfSpeech === 'string' &&
    typeof item.explanationZh === 'string' &&
    typeof item.exampleJa === 'string' &&
    typeof item.exampleZh === 'string'
  )
}

function normalizeClip(value: unknown): SlicerManifestClip | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.clipTitle !== 'string') {
    return null
  }

  const segments = Array.isArray(item.segments)
    ? item.segments.filter(isTranscriptSegment)
    : []
  const knowledgePoints = Array.isArray(item.knowledgePoints)
    ? item.knowledgePoints.filter(isKnowledgePoint)
    : []

  if (segments.length === 0) {
    return null
  }

  return {
    id: item.id,
    clipTitle: item.clipTitle,
    startMs: typeof item.startMs === 'number' ? item.startMs : 0,
    endMs: typeof item.endMs === 'number' ? item.endMs : 0,
    durationMs: typeof item.durationMs === 'number' ? item.durationMs : 0,
    videoPath: typeof item.videoPath === 'string' ? item.videoPath : '',
    coverPath: typeof item.coverPath === 'string' ? item.coverPath : undefined,
    subtitlePath: typeof item.subtitlePath === 'string' ? item.subtitlePath : undefined,
    metadataPath: typeof item.metadataPath === 'string' ? item.metadataPath : undefined,
    transcriptJa: typeof item.transcriptJa === 'string' ? item.transcriptJa : segments.map((segment) => segment.ja).join(' '),
    transcriptZh: typeof item.transcriptZh === 'string' ? item.transcriptZh : segments.map((segment) => segment.zh).join(' '),
    subtitleSource:
      item.subtitleSource === 'external' || item.subtitleSource === 'auto'
        ? item.subtitleSource
        : undefined,
    exampleJa: typeof item.exampleJa === 'string' ? item.exampleJa : segments[0].ja,
    exampleZh: typeof item.exampleZh === 'string' ? item.exampleZh : segments[0].zh,
    keyNotes: Array.isArray(item.keyNotes)
      ? item.keyNotes.filter((note): note is string => typeof note === 'string')
      : [],
    keywords: Array.isArray(item.keywords)
      ? item.keywords.filter((keyword): keyword is string => typeof keyword === 'string')
      : [],
    knowledgePoints,
    segments,
  }
}

export async function parseSlicerManifest(file: File): Promise<SlicerManifestData> {
  const raw = JSON.parse(await file.text()) as Record<string, unknown>

  if (typeof raw.animeTitle !== 'string' || !Array.isArray(raw.clips)) {
    throw new Error('切片 manifest 缺少 animeTitle 或 clips。')
  }

  const clips = raw.clips.map(normalizeClip).filter((clip): clip is SlicerManifestClip => Boolean(clip))
  if (clips.length === 0) {
    throw new Error('切片 manifest 里没有可导入的 clips。')
  }

  return {
    animeTitle: raw.animeTitle,
    episodeTitle: typeof raw.episodeTitle === 'string' ? raw.episodeTitle : undefined,
    sourceVideo: typeof raw.sourceVideo === 'string' ? raw.sourceVideo : undefined,
    subtitleSource:
      raw.subtitleSource === 'external' || raw.subtitleSource === 'auto'
        ? raw.subtitleSource
        : undefined,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : undefined,
    clipCount: typeof raw.clipCount === 'number' ? raw.clipCount : undefined,
    clips,
  }
}

export function buildManifestClipFileMap(files: File[]) {
  return files.reduce<Record<string, File>>((acc, file) => {
    acc[normalizeFileKey(file.name)] = file
    return acc
  }, {})
}

export function getManifestClipFileName(clip: SlicerManifestClip) {
  return basenameFromPath(clip.videoPath)
}

export function getManifestSubtitleSource(
  manifest: SlicerManifestData,
  clip: SlicerManifestClip,
): 'manual' | 'auto' | undefined {
  const source = clip.subtitleSource ?? manifest.subtitleSource
  if (source === 'external') {
    return 'manual'
  }
  if (source === 'auto') {
    return 'auto'
  }
  return undefined
}
