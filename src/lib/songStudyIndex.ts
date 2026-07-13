import type {
  KnowledgePoint,
  LyricLine,
  LyricWordTiming,
  SongKnowledge,
  SongStudyIndex,
  SongStudyLine,
  SongStudyLinePart,
  SongStudyOccurrence,
  StudyIndexQuality,
  StudyStage,
} from '../types'
import { toRomaji } from 'wanakana'
import { analyzeSongWithAgent, type SongAnalysisProgress } from './songAnalysis'

interface TextTimingRange {
  startOffset: number
  endOffset: number
  startMs: number
  endMs: number
}

interface BuildSongStudyIndexInput {
  songId: string
  title?: string
  artist?: string
  lyricLines: LyricLine[]
  quality?: StudyIndexQuality
  onProgress?: (progress: SongAnalysisProgress) => void
}

const studyStages: StudyStage[] = ['beginner', 'intermediate', 'advanced']

function hashText(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function createSongLyricVersion(lyricLines: LyricLine[]) {
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

export function isSongStudyIndexFresh(index: SongStudyIndex | undefined, songId: string, lyricLines: LyricLine[]) {
  return Boolean(index && index.songId === songId && index.lyricVersion === createSongLyricVersion(lyricLines))
}

function buildTimedTextRanges(text: string, timings: LyricWordTiming[] = []) {
  const ranges: TextTimingRange[] = []
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

function getTimingForRange(startOffset: number, endOffset: number, ranges: TextTimingRange[]) {
  const overlapping = ranges.filter((range) => range.startOffset < endOffset && range.endOffset > startOffset)
  if (overlapping.length === 0) return {}

  return {
    startMs: Math.min(...overlapping.map((range) => range.startMs)),
    endMs: Math.max(...overlapping.map((range) => range.endMs)),
  }
}

function findTextRange(text: string, target: string, cursor: number) {
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

function addBoundary(boundaries: Set<number>, offset: number, textLength: number) {
  if (offset >= 0 && offset <= textLength) {
    boundaries.add(offset)
  }
}

function createLineParts({
  songId,
  line,
  lineOccurrences,
}: {
  songId: string
  line: LyricLine
  lineOccurrences: SongStudyOccurrence[]
}) {
  const textLength = line.ja.length
  const boundaries = new Set([0, textLength])

  lineOccurrences.forEach((occurrence) => {
    addBoundary(boundaries, occurrence.startOffset, textLength)
    addBoundary(boundaries, occurrence.endOffset, textLength)
  })

  const sortedBoundaries = [...boundaries].sort((left, right) => left - right)
  const parts: SongStudyLinePart[] = []

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

function buildStagePlans(occurrences: SongStudyOccurrence[]) {
  return studyStages.reduce<SongStudyIndex['stagePlans']>((acc, stage) => {
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
    acc[stage] = {
      focusOccurrenceIds,
    }
    return acc
  }, {
    beginner: { focusOccurrenceIds: [] },
    intermediate: { focusOccurrenceIds: [] },
    advanced: { focusOccurrenceIds: [] },
  })
}

function buildSummary(lines: SongStudyLine[], occurrences: SongStudyOccurrence[]) {
  return {
    lineCount: lines.length,
    wordCount: occurrences.filter((occurrence) => occurrence.kind === 'word').length,
    grammarCount: occurrences.filter((occurrence) => occurrence.kind === 'grammar').length,
    beginnerCount: occurrences.filter((occurrence) => occurrence.stage === 'beginner').length,
    intermediateCount: occurrences.filter((occurrence) => occurrence.stage === 'intermediate').length,
    advancedCount: occurrences.filter((occurrence) => occurrence.stage === 'advanced').length,
  }
}

export async function buildSongStudyIndex({
  songId,
  title,
  artist,
  lyricLines,
  quality = 'draft',
  onProgress,
}: BuildSongStudyIndexInput): Promise<SongStudyIndex> {
  const lyricVersion = createSongLyricVersion(lyricLines)
  const lines: SongStudyLine[] = []
  const occurrences: SongStudyOccurrence[] = []
  const knowledge: Record<string, SongKnowledge> = {}
  const analysis = await analyzeSongWithAgent(songId, lyricLines, title, artist, onProgress)
  const analysisByLineId = new Map(analysis.lines.map((line) => [line.lineId, line]))

  for (const [lineIndex, line] of lyricLines.entries()) {
    const ja = line.ja.trim()
    if (!ja) continue

    const lineAnalysis = analysisByLineId.get(line.id)
    const lineOccurrences: SongStudyOccurrence[] = []
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
        sources: [{ kind: 'codex-agent' as const, label: 'Codex Agent 歌词分析' }],
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
      const occurrence: SongStudyOccurrence = {
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

    if (lineIndex % 12 === 11) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
    }
  }

  return {
    version: 1,
    songId,
    lyricVersion,
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

export function getActiveSongStudyPartId(studyLine: SongStudyLine | undefined, currentMs: number) {
  const timedParts = studyLine?.parts.filter((part) => (
    part.wordOccurrenceId &&
    typeof part.startMs === 'number' &&
    typeof part.endMs === 'number' &&
    part.endMs > part.startMs
  )) ?? []

  const timedPart = timedParts.find((part) => currentMs >= part.startMs! && currentMs < part.endMs!)
  if (timedPart) return timedPart.id

  const focusParts = studyLine?.parts.filter((part) => part.wordOccurrenceId || part.grammarOccurrenceIds.length > 0) ?? []
  if (!studyLine || focusParts.length === 0) return ''

  const durationMs = Math.max(1200, studyLine.endMs - studyLine.startMs)
  const ratio = Math.min(0.999, Math.max(0, (currentMs - studyLine.startMs) / durationMs))
  return focusParts[Math.floor(ratio * focusParts.length)]?.id ?? ''
}

export function songKnowledgeToKnowledgePoint(knowledge: SongKnowledge): KnowledgePoint {
  return {
    id: knowledge.id,
    kind: knowledge.kind,
    expression: knowledge.expression,
    reading: knowledge.reading,
    meaningZh: knowledge.meaningZh,
    partOfSpeech: knowledge.kind === 'word' ? knowledge.partOfSpeech : '语法',
    explanationZh: knowledge.explanationZh,
    exampleJa: knowledge.exampleJa,
    exampleZh: knowledge.exampleZh,
  }
}
