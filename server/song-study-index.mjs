import { toRomaji } from 'wanakana'

const studyStages = ['beginner', 'intermediate', 'advanced']

function hashText(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function createSongLyricVersion(lyricLines) {
  const signature = lyricLines
    .map((line) => [
      line.id,
      Math.round(line.startMs),
      Math.round(line.endMs),
      line.ja,
      line.zh,
      line.wordTimings?.map((word) => `${word.text}:${word.startMs}:${word.endMs}`).join(',') ?? '',
    ].join(':'))
    .join('|')

  return `lyrics-codex-v3:${lyricLines.length}:${hashText(signature)}`
}

export function isSongStudyIndexFresh(index, songId, lyricLines) {
  return Boolean(index && index.songId === songId && index.lyricVersion === createSongLyricVersion(lyricLines))
}

function buildTimedTextRanges(text, timings = []) {
  const ranges = []
  let cursor = 0

  timings.forEach((timing) => {
    const value = timing.text
    if (!value || timing.endMs <= timing.startMs) return

    const start = text.indexOf(value, cursor)
    const startOffset = start >= 0 ? start : cursor
    const endOffset = Math.min(text.length, startOffset + value.length)
    if (endOffset <= startOffset) return

    ranges.push({
      startOffset,
      endOffset,
      startMs: timing.startMs,
      endMs: timing.endMs,
    })
    cursor = endOffset
  })

  return ranges
}

function getTimingForRange(startOffset, endOffset, ranges) {
  const overlapping = ranges.filter((range) => range.startOffset < endOffset && range.endOffset > startOffset)
  if (overlapping.length === 0) return {}

  return {
    startMs: Math.min(...overlapping.map((range) => range.startMs)),
    endMs: Math.max(...overlapping.map((range) => range.endMs)),
  }
}

function findTextRange(text, target, cursor) {
  const value = target.trim()
  if (!value) return null

  const fromCursor = text.indexOf(value, cursor)
  const startOffset = fromCursor >= 0 ? fromCursor : text.indexOf(value)
  if (startOffset < 0) return null

  return {
    startOffset,
    endOffset: startOffset + value.length,
  }
}

function addBoundary(boundaries, offset, textLength) {
  if (offset >= 0 && offset <= textLength) boundaries.add(offset)
}

function createLineParts({ songId, line, lineOccurrences }) {
  const textLength = line.ja.length
  const boundaries = new Set([0, textLength])

  lineOccurrences.forEach((occurrence) => {
    addBoundary(boundaries, occurrence.startOffset, textLength)
    addBoundary(boundaries, occurrence.endOffset, textLength)
  })

  const sortedBoundaries = [...boundaries].sort((left, right) => left - right)
  const parts = []

  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const startOffset = sortedBoundaries[index]
    const endOffset = sortedBoundaries[index + 1]
    const text = line.ja.slice(startOffset, endOffset)
    if (!text) continue

    const wordOccurrence = lineOccurrences.find((occurrence) => (
      occurrence.kind === 'word' &&
      occurrence.startOffset <= startOffset &&
      occurrence.endOffset >= endOffset
    ))
    const grammarOccurrenceIds = lineOccurrences
      .filter((occurrence) => (
        occurrence.kind === 'grammar' &&
        occurrence.startOffset < endOffset &&
        occurrence.endOffset > startOffset
      ))
      .map((occurrence) => occurrence.id)
    const timing = wordOccurrence?.startMs !== undefined && wordOccurrence.endMs !== undefined
      ? { startMs: wordOccurrence.startMs, endMs: wordOccurrence.endMs }
      : {}

    parts.push({
      id: `${songId}:${line.id}:part-${index + 1}`,
      text,
      startOffset,
      endOffset,
      wordOccurrenceId: wordOccurrence?.id,
      grammarOccurrenceIds,
      ...timing,
    })
  }

  return parts.length > 0
    ? parts
    : [{
        id: `${songId}:${line.id}:part-1`,
        text: line.ja,
        startOffset: 0,
        endOffset: line.ja.length,
        grammarOccurrenceIds: [],
      }]
}

function buildStagePlans(occurrences) {
  return studyStages.reduce((acc, stage) => {
    const stageOccurrences = occurrences.filter((occurrence) => occurrence.stage === stage)
    const focusOccurrenceIds = [...new Set(stageOccurrences.map((occurrence) => occurrence.lineId))]
      .flatMap((lineId) => stageOccurrences
        .filter((occurrence) => occurrence.lineId === lineId)
        .sort((left, right) => {
          if (left.kind !== right.kind) return left.kind === 'grammar' ? -1 : 1
          if (left.confidence !== right.confidence) return right.confidence - left.confidence
          return (right.endOffset - right.startOffset) - (left.endOffset - left.startOffset)
        })
        .slice(0, 4)
        .map((occurrence) => occurrence.id))
    acc[stage] = { focusOccurrenceIds }
    return acc
  }, {
    beginner: { focusOccurrenceIds: [] },
    intermediate: { focusOccurrenceIds: [] },
    advanced: { focusOccurrenceIds: [] },
  })
}

function buildSummary(lines, occurrences) {
  return {
    lineCount: lines.length,
    wordCount: occurrences.filter((occurrence) => occurrence.kind === 'word').length,
    grammarCount: occurrences.filter((occurrence) => occurrence.kind === 'grammar').length,
    beginnerCount: occurrences.filter((occurrence) => occurrence.stage === 'beginner').length,
    intermediateCount: occurrences.filter((occurrence) => occurrence.stage === 'intermediate').length,
    advancedCount: occurrences.filter((occurrence) => occurrence.stage === 'advanced').length,
  }
}

export function buildSongStudyIndexFromAnalysis({
  songId,
  lyricLines,
  analysis,
  quality = 'draft',
}) {
  const lines = []
  const occurrences = []
  const knowledge = {}
  const analysisByLineId = new Map(analysis.lines.map((line) => [line.lineId, line]))

  for (const line of lyricLines) {
    const ja = line.ja.trim()
    if (!ja) continue

    const lineAnalysis = analysisByLineId.get(line.id)
    const lineOccurrences = []
    const timingRanges = buildTimedTextRanges(line.ja, line.wordTimings)
    let itemCursor = 0

    for (const [itemIndex, item] of (lineAnalysis?.items ?? []).entries()) {
      const range = findTextRange(line.ja, item.expression, itemCursor)
      if (!range) continue
      itemCursor = range.endOffset
      const knowledgeId = `codex:${item.kind}:${hashText(`${item.expression}:${item.meaningZh}`)}`
      const baseKnowledge = {
        id: knowledgeId,
        expression: item.expression,
        reading: item.reading,
        meaningZh: item.meaningZh,
        explanationZh: item.explanationZh,
        exampleJa: line.ja,
        exampleZh: lineAnalysis?.translationZh || line.zh,
        stage: item.stage,
        confidence: item.confidence,
        sources: [{ kind: 'codex-agent', label: 'Codex Agent 歌词分析' }],
      }
      knowledge[knowledgeId] = item.kind === 'word'
        ? {
            ...baseKnowledge,
            kind: 'word',
            lemma: item.expression,
            kana: item.reading,
            romaji: toRomaji(item.reading),
            partOfSpeech: '词语 / 固定搭配',
          }
        : {
            ...baseKnowledge,
            kind: 'grammar',
            grammarId: knowledgeId,
            pattern: item.expression,
          }
      const occurrence = {
        id: `${songId}:${line.id}:${item.kind}-${itemIndex + 1}`,
        kind: item.kind,
        lineId: line.id,
        knowledgeId,
        text: line.ja.slice(range.startOffset, range.endOffset),
        ...range,
        ...getTimingForRange(range.startOffset, range.endOffset, timingRanges),
        stage: item.stage,
        confidence: item.confidence,
      }
      lineOccurrences.push(occurrence)
      occurrences.push(occurrence)
    }

    lines.push({
      lineId: line.id,
      startMs: line.startMs,
      endMs: line.endMs,
      ja: line.ja,
      zh: lineAnalysis?.translationZh || line.zh,
      parts: createLineParts({ songId, line, lineOccurrences }),
      occurrenceIds: lineOccurrences.map((occurrence) => occurrence.id),
    })
  }

  return {
    version: 1,
    songId,
    lyricVersion: createSongLyricVersion(lyricLines),
    status: lines.length > 0 ? 'ready' : 'empty',
    quality,
    generatedAt: new Date().toISOString(),
    lines,
    occurrences,
    knowledge,
    stagePlans: buildStagePlans(occurrences),
    summary: buildSummary(lines, occurrences),
  }
}
