import type { LyricWordTiming } from '../types'

export interface ParsedWordTimedLyricLine {
  startMs: number
  endMs: number
  text: string
  wordTimings: LyricWordTiming[]
}

function normalizeKrcWord(value: string) {
  return value.replace(/<[^>]+>/gu, '').replace(/\s+/gu, ' ')
}

export function parseKrcWordTimedLines(text: string) {
  const lines: ParsedWordTimedLyricLine[] = []
  const linePattern = /^\[(\d+),(\d+)\](.*)$/
  const wordPattern = /<(\d+),(\d+)(?:,\d+)?>([^<]*)/g

  for (const rawLine of text.split(/\r?\n/)) {
    const lineMatch = rawLine.match(linePattern)
    if (!lineMatch) continue

    const lineStartMs = Number(lineMatch[1])
    const lineDurationMs = Number(lineMatch[2])
    if (!Number.isFinite(lineStartMs) || !Number.isFinite(lineDurationMs)) continue

    const lineEndMs = Math.max(lineStartMs + 60, lineStartMs + lineDurationMs)
    const wordTimings: LyricWordTiming[] = []
    let textValue = ''
    wordPattern.lastIndex = 0

    for (const wordMatch of lineMatch[3].matchAll(wordPattern)) {
      const relativeStartMs = Number(wordMatch[1])
      const durationMs = Number(wordMatch[2])
      const wordText = normalizeKrcWord(wordMatch[3])
      if (!Number.isFinite(relativeStartMs) || !Number.isFinite(durationMs) || !wordText) continue

      const startMs = lineStartMs + relativeStartMs
      const endMs = Math.max(startMs + 20, Math.min(lineEndMs, startMs + Math.max(20, durationMs)))
      textValue += wordText
      wordTimings.push({
        id: `krc-${lines.length + 1}-${wordTimings.length + 1}`,
        text: wordText,
        startMs,
        endMs,
      })
    }

    const cleanLineText = textValue.replace(/\s+/gu, ' ').trim()
    if (!cleanLineText || wordTimings.length === 0) continue
    lines.push({
      startMs: lineStartMs,
      endMs: lineEndMs,
      text: cleanLineText,
      wordTimings,
    })
  }

  return lines.sort((left, right) => left.startMs - right.startMs)
}
