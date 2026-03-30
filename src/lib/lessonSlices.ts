import type { ImportedClip, KnowledgePoint, TranscriptSegment, VideoLesson } from '../types'

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

function buildSliceTitle(clip: ImportedClip, index: number, points: KnowledgePoint[]) {
  const lead = points.slice(0, 2).map((point) => point.expression).join(' / ')
  return lead ? `${clip.title} · ${lead}` : `${clip.title} · 第 ${index + 1} 段`
}

function buildSliceDescription(points: KnowledgePoint[]) {
  const summary = points
    .slice(0, 3)
    .map((point) => `${point.expression}(${point.meaningZh})`)
    .join(' / ')
  return summary
    ? `这段切片重点学习 ${summary}，适合先看一遍原句，再暂停跟读。`
    : '这段切片适合暂停跟读并对照字幕整理词法。'
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
        sourceUrl: clip.sourceUrl,
        sourceProvider:
          clip.subtitleSource === 'auto'
            ? `${clip.sourceProvider} · 自动切片`
            : `${clip.sourceProvider} · 字幕切片`,
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
