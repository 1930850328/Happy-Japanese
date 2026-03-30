import type { KnowledgePoint, TranscriptSegment, VideoLesson } from '../types'

interface PublishedManifestClip {
  id: string
  clipTitle: string
  durationMs: number
  videoPath: string
  coverPath?: string
  transcriptZh?: string
  keyNotes?: string[]
  keywords?: string[]
  knowledgePoints?: KnowledgePoint[]
  segments?: TranscriptSegment[]
}

interface PublishedManifest {
  animeTitle: string
  episodeTitle?: string
  generatedAt?: string
  clips: PublishedManifestClip[]
}

interface PublishedIndexEntry {
  slug: string
  animeTitle: string
  episodeTitle?: string
  manifestPath: string
  generatedAt?: string
  clipCount?: number
}

function createFallbackCover(title: string, subtitle: string) {
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const safeSubtitle = subtitle.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffd7c2" />
          <stop offset="50%" stop-color="#fff4dc" />
          <stop offset="100%" stop-color="#dff1e5" />
        </linearGradient>
      </defs>
      <rect width="720" height="960" rx="40" fill="url(#bg)" />
      <circle cx="110" cy="120" r="64" fill="rgba(255,255,255,0.32)" />
      <circle cx="610" cy="820" r="120" fill="rgba(255,255,255,0.24)" />
      <rect x="48" y="680" width="420" height="170" rx="30" fill="rgba(255,255,255,0.78)" />
      <text x="64" y="136" fill="#8d6555" font-size="26" font-family="sans-serif">${safeSubtitle}</text>
      <text x="70" y="760" fill="#4a352d" font-size="42" font-family="sans-serif">${safeTitle}</text>
      <text x="70" y="810" fill="#76584c" font-size="22" font-family="sans-serif">Auto-synced study clip</text>
    </svg>
  `
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
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

function normalizeClip(
  manifest: PublishedManifest,
  indexEntry: PublishedIndexEntry,
  clip: PublishedManifestClip,
  clipIndex: number,
): VideoLesson | null {
  const segments = Array.isArray(clip.segments)
    ? clip.segments.filter(isTranscriptSegment)
    : []
  const knowledgePoints = Array.isArray(clip.knowledgePoints)
    ? clip.knowledgePoints.filter(isKnowledgePoint)
    : []

  if (typeof clip.id !== 'string' || typeof clip.clipTitle !== 'string' || typeof clip.videoPath !== 'string') {
    return null
  }

  if (segments.length === 0) {
    return null
  }

  const theme = manifest.animeTitle
  const episodeLabel = manifest.episodeTitle ? ` / ${manifest.episodeTitle}` : ''
  const cover = clip.coverPath || createFallbackCover(clip.clipTitle, `${theme}${episodeLabel}`)

  return {
    id: `published:${indexEntry.slug}:${clip.id}`,
    sourceType: 'local',
    sourceIdOrBlobKey: clip.videoPath,
    sourceUrl: clip.videoPath,
    sourceProvider: `自动切片 / ${manifest.animeTitle}${episodeLabel}`,
    title: clip.clipTitle,
    cover,
    theme,
    difficulty: 'Custom',
    durationMs: typeof clip.durationMs === 'number' ? clip.durationMs : segments.at(-1)?.endMs ?? 0,
    segments,
    knowledgePoints,
    tags: [...new Set(['自动切片', manifest.animeTitle, ...(clip.keywords ?? [])])],
    description:
      clip.keyNotes?.join(' / ') ||
      clip.transcriptZh ||
      '这条切片已经自动同步到短视频模块，字幕、知识点和例句都会直接跟着片段走。',
    creditLine:
      '由本地 anime-learning-slicer 自动同步到站内短视频模块，刷新页面后就会直接出现在首页流里。',
    sliceLabel: `自动同步 / 第 ${clipIndex + 1} 条`,
    feedPriority: 160,
  }
}

export async function loadPublishedLessons() {
  if (typeof fetch === 'undefined') {
    return [] as VideoLesson[]
  }

  try {
    const indexResponse = await fetch('/generated-slices/index.json', {
      cache: 'no-store',
    })
    if (!indexResponse.ok) {
      return []
    }

    const indexData = (await indexResponse.json()) as unknown
    const entries = Array.isArray(indexData)
      ? indexData.filter((item): item is PublishedIndexEntry => {
          return Boolean(
            item &&
              typeof item === 'object' &&
              typeof (item as PublishedIndexEntry).slug === 'string' &&
              typeof (item as PublishedIndexEntry).manifestPath === 'string' &&
              typeof (item as PublishedIndexEntry).animeTitle === 'string',
          )
        })
      : []

    const manifestResponses = await Promise.all(
      entries.map(async (entry) => {
        const response = await fetch(entry.manifestPath, {
          cache: 'no-store',
        })
        if (!response.ok) {
          return []
        }

        const manifest = (await response.json()) as PublishedManifest
        if (!manifest || typeof manifest.animeTitle !== 'string' || !Array.isArray(manifest.clips)) {
          return []
        }

        return manifest.clips
          .map((clip, clipIndex) => normalizeClip(manifest, entry, clip, clipIndex))
          .filter((lesson): lesson is VideoLesson => Boolean(lesson))
      }),
    )

    return manifestResponses.flat()
  } catch {
    return []
  }
}
