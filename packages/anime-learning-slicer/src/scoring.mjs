const DEFAULTS = {
  minDurationMs: 8000,
  targetDurationMs: 18000,
  maxDurationMs: 42000,
  maxSegmentsPerClip: 8,
  maxClips: 8,
}

function unique(items) {
  return [...new Set(items)]
}

function pointsForWindow(segments, knowledgePoints, startIndex, endIndex) {
  const ids = new Set(segments.slice(startIndex, endIndex + 1).flatMap((segment) => segment.focusTermIds))
  return knowledgePoints.filter((point) => ids.has(point.id))
}

function nearestDistance(events, ms, kind) {
  const distances = events
    .filter((event) => event.kind === kind)
    .map((event) => Math.abs(event.ms - ms))
  return distances.length > 0 ? Math.min(...distances) : Infinity
}

function scoreWindow({ durationMs, points, startMs, endMs, silences, targetDurationMs }) {
  const grammarCount = points.filter((point) => point.kind === 'grammar').length
  const wordCount = points.filter((point) => point.kind === 'word').length
  const phraseCount = points.filter((point) => point.kind === 'phrase').length
  const durationCloseness = 1 - Math.min(1, Math.abs(durationMs - targetDurationMs) / targetDurationMs)
  const startBoundary = Math.max(0, 1 - nearestDistance(silences, startMs, 'end') / 2200)
  const endBoundary = Math.max(0, 1 - nearestDistance(silences, endMs, 'start') / 2200)

  return grammarCount * 5 + wordCount * 2 + phraseCount + durationCloseness * 2 + startBoundary + endBoundary
}

function overlaps(left, right) {
  return left.startMs < right.endMs && right.startMs < left.endMs
}

function normalizeSegments(segments, offsetMs) {
  return segments.map((segment) => ({
    ...segment,
    startMs: Math.max(0, segment.startMs - offsetMs),
    endMs: Math.max(0, segment.endMs - offsetMs),
  }))
}

function makeClipId(slug, startMs, endMs) {
  return `${slug}-${String(Math.round(startMs / 1000)).padStart(5, '0')}-${String(Math.round(endMs / 1000)).padStart(5, '0')}`
}

export function selectClipWindows({
  slug,
  segments,
  knowledgePoints,
  silences,
  minDurationMs = DEFAULTS.minDurationMs,
  targetDurationMs = DEFAULTS.targetDurationMs,
  maxDurationMs = DEFAULTS.maxDurationMs,
  maxSegmentsPerClip = DEFAULTS.maxSegmentsPerClip,
  maxClips = DEFAULTS.maxClips,
}) {
  const validSegments = segments.filter((segment) => segment.endMs > segment.startMs)
  const candidates = []

  for (let startIndex = 0; startIndex < validSegments.length; startIndex += 1) {
    for (
      let endIndex = startIndex;
      endIndex < Math.min(validSegments.length, startIndex + maxSegmentsPerClip);
      endIndex += 1
    ) {
      const startMs = validSegments[startIndex].startMs
      const endMs = validSegments[endIndex].endMs
      const durationMs = endMs - startMs
      if (durationMs < minDurationMs || durationMs > maxDurationMs) {
        continue
      }

      const points = pointsForWindow(validSegments, knowledgePoints, startIndex, endIndex)
      if (points.length === 0) {
        continue
      }

      const hasStudyValue =
        points.some((point) => point.kind === 'grammar') ||
        points.filter((point) => point.kind !== 'phrase').length >= 2
      if (!hasStudyValue) {
        continue
      }

      candidates.push({
        startIndex,
        endIndex,
        startMs,
        endMs,
        durationMs,
        points,
        score: scoreWindow({
          durationMs,
          points,
          startMs,
          endMs,
          silences,
          targetDurationMs,
        }),
      })
    }
  }

  const selected = []
  for (const candidate of candidates.sort((left, right) => right.score - left.score)) {
    if (selected.some((window) => overlaps(window, candidate))) {
      continue
    }
    selected.push(candidate)
    if (selected.length >= maxClips) {
      break
    }
  }

  return selected.sort((left, right) => left.startMs - right.startMs).map((window, index) => {
    const clipSegments = normalizeSegments(
      validSegments.slice(window.startIndex, window.endIndex + 1),
      window.startMs,
    )
    const clipPointIds = new Set(clipSegments.flatMap((segment) => segment.focusTermIds))
    const clipPoints = knowledgePoints.filter((point) => clipPointIds.has(point.id))
    const lead = clipPoints[0]?.expression

    return {
      ...window,
      id: makeClipId(slug, window.startMs, window.endMs),
      titleSuffix: lead ? `${lead}` : `切片 ${index + 1}`,
      segments: clipSegments,
      knowledgePoints: clipPoints,
      keywords: unique(clipPoints.slice(0, 6).map((point) => point.expression)),
      keyNotes: clipPoints.slice(0, 3).map((point) => `${point.kind === 'grammar' ? '语法' : '词'} ${point.expression}: ${point.meaningZh}`),
    }
  })
}
