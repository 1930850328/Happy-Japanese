import type { ImportedClip, KnowledgePoint, TranscriptSegment, VideoLesson } from '../types'
import { hasReliableMeaning } from './textAnalysis'

interface CandidateWindow {
  startIndex: number
  endIndex: number
  startMs: number
  endMs: number
  durationMs: number
  score: number
  knowledgePoints: KnowledgePoint[]
}

const MIN_SLICE_MS = 5000
const TARGET_SLICE_MS = 18000
const MAX_SLICE_MS = 42000
const MAX_SEGMENTS_PER_SLICE = 4
const MAX_SLICES_PER_CLIP = 8
const MAX_RAW_FALLBACK_MS = 90000

function uniquePoints(points: KnowledgePoint[]) {
  const map = new Map<string, KnowledgePoint>()
  for (const point of points) {
    map.set(point.id, point)
  }
  return [...map.values()]
}

function pickPointsForWindow(
  clip: ImportedClip,
  segments: TranscriptSegment[],
  startIndex: number,
  endIndex: number,
) {
  const ids = new Set(
    segments.slice(startIndex, endIndex + 1).flatMap((segment) => segment.focusTermIds),
  )
  return clip.knowledgePoints.filter((point) => ids.has(point.id))
}

function scoreWindow(durationMs: number, points: KnowledgePoint[]) {
  const grammarCount = points.filter((point) => point.kind === 'grammar').length
  const wordCount = points.filter((point) => point.kind === 'word').length
  const phraseCount = points.filter((point) => point.kind === 'phrase').length
  const closeness = 1 - Math.min(1, Math.abs(durationMs - TARGET_SLICE_MS) / TARGET_SLICE_MS)
  return grammarCount * 5 + wordCount * 2 + phraseCount + closeness * 2
}

function buildCandidateWindows(clip: ImportedClip) {
  const windows: CandidateWindow[] = []
  const segments = clip.segments.filter((segment) => segment.endMs > segment.startMs)

  for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
    for (
      let endIndex = startIndex;
      endIndex < Math.min(segments.length, startIndex + MAX_SEGMENTS_PER_SLICE);
      endIndex += 1
    ) {
      const startMs = segments[startIndex].startMs
      const endMs = segments[endIndex].endMs
      const durationMs = endMs - startMs

      if (durationMs < MIN_SLICE_MS || durationMs > MAX_SLICE_MS) {
        continue
      }

      const points = uniquePoints(pickPointsForWindow(clip, segments, startIndex, endIndex))
      if (points.length === 0) {
        continue
      }

      const hasStudyValue =
        points.some((point) => point.kind === 'grammar') ||
        points.filter((point) => point.kind !== 'phrase').length >= 2

      if (!hasStudyValue) {
        continue
      }

      windows.push({
        startIndex,
        endIndex,
        startMs,
        endMs,
        durationMs,
        score: scoreWindow(durationMs, points),
        knowledgePoints: points,
      })
    }
  }

  return windows.sort((left, right) => right.score - left.score)
}

function normalizeSegments(segments: TranscriptSegment[], offsetMs: number) {
  return segments.map((segment) => ({
    ...segment,
    startMs: Math.max(0, segment.startMs - offsetMs),
    endMs: Math.max(0, segment.endMs - offsetMs),
  }))
}

function shortenTitle(input: string) {
  if (input.length <= 22) {
    return input
  }
  return `${input.slice(0, 22)}...`
}

function buildSliceTitle(clip: ImportedClip, index: number, points: KnowledgePoint[]) {
  const lead = points.slice(0, 1).map((point) => point.expression).join(' / ')
  const baseTitle = shortenTitle(clip.sourceAnimeTitle ?? clip.title)
  return lead ? `${baseTitle} - ${lead}` : `${baseTitle} - 切片 ${index + 1}`
}

function summarizePoint(point: KnowledgePoint) {
  if (point.kind === 'grammar') {
    return `语法 ${point.expression} = ${point.meaningZh}`
  }

  if (hasReliableMeaning(point.meaningZh)) {
    return `${point.expression} = ${point.meaningZh}`
  }

  return point.expression
}

function buildSliceDescription(points: KnowledgePoint[]) {
  const summary = points.slice(0, 3).map(summarizePoint).join(' / ')
  return summary ? `学习重点：${summary}` : '先从片中原句入手，再带着知识点往下学。'
}

function overlap(a: CandidateWindow, b: CandidateWindow) {
  return a.startMs < b.endMs && b.startMs < a.endMs
}

function buildFallbackLesson(clip: ImportedClip): VideoLesson {
  return {
    id: clip.id,
    originClipId: clip.id,
    sourceType: clip.sourceType,
    sourceIdOrBlobKey: clip.sourceIdOrBlobKey,
    sourceFileName: clip.sourceFileName,
    sourceUrl: clip.sourceUrl,
    sourceProvider: clip.sourceProvider,
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
    sliceLabel: `${Math.max(10, Math.round(clip.durationMs / 1000))} 秒完整片段`,
    feedPriority: 120,
  }
}

function hasMeaningfulStudyContent(clip: ImportedClip) {
  return clip.knowledgePoints.some(
    (point) => point.id !== 'local-subtitle-tip' && (point.kind === 'grammar' || point.kind === 'word'),
  )
}

export function buildLessonsFromImportedClip(clip: ImportedClip) {
  const candidates = buildCandidateWindows(clip)
  const selected: CandidateWindow[] = []

  for (const candidate of candidates) {
    if (selected.some((existing) => overlap(existing, candidate))) {
      continue
    }
    selected.push(candidate)
    if (selected.length >= MAX_SLICES_PER_CLIP) {
      break
    }
  }

  if (selected.length === 0) {
    if (
      clip.importMode === 'raw' &&
      (!hasMeaningfulStudyContent(clip) || clip.durationMs > MAX_RAW_FALLBACK_MS)
    ) {
      return []
    }
    return [buildFallbackLesson(clip)]
  }

  return selected
    .sort((left, right) => left.startMs - right.startMs)
    .map((window, index) => {
      const sliceSegments = clip.segments.slice(window.startIndex, window.endIndex + 1)
      const normalizedSegments = normalizeSegments(sliceSegments, window.startMs)
      const knowledgePoints = uniquePoints(window.knowledgePoints)
      const title = buildSliceTitle(clip, index, knowledgePoints)

      return {
        id: `${clip.id}::slice-${index + 1}`,
        originClipId: clip.id,
        sourceType: clip.sourceType,
        sourceIdOrBlobKey: clip.sourceIdOrBlobKey,
        sourceFileName: clip.sourceFileName,
        sourceUrl: clip.sourceUrl,
        sourceProvider:
          clip.subtitleSource === 'auto'
            ? `${clip.sourceProvider} / 自动切片`
            : `${clip.sourceProvider} / 字幕切片`,
        title,
        cover: clip.cover,
        theme: clip.theme,
        difficulty: clip.difficulty,
        durationMs: window.durationMs,
        clipStartMs: window.startMs,
        clipEndMs: window.endMs,
        segments: normalizedSegments,
        knowledgePoints,
        tags: [...new Set([...clip.tags.filter((tag) => tag !== '待生成字幕'), '学习切片'])],
        description: buildSliceDescription(knowledgePoints),
        creditLine: clip.creditLine,
        sliceLabel: `${Math.round(window.durationMs / 1000)} 秒学习切片`,
        feedPriority: 140 - index,
      } satisfies VideoLesson
    })
}
