import * as wanakana from 'wanakana'

import type { LyricLine } from '../types'

interface ParsedCue {
  startMs: number
  endMs?: number
  text: string
}

function parseTimestamp(value: string) {
  const parts = value.trim().replace(',', '.').split(':').map(Number)
  if (parts.some((part) => Number.isNaN(part))) {
    return 0
  }

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts
    return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000)
  }

  const [minutes, seconds] = parts
  return Math.round((minutes * 60 + seconds) * 1000)
}

function stripCueText(value: string) {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]+\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitBilingualText(text: string) {
  const normalized = text
    .split(/\n+/)
    .map(stripCueText)
    .filter(Boolean)

  if (normalized.length >= 2) {
    return {
      ja: normalized[0],
      zh: normalized.slice(1).join(' '),
    }
  }

  const singleLine = normalized[0] ?? stripCueText(text)
  const delimiterMatch = singleLine.match(/\s*(?:\||／| \/ | - | — | ｜)\s*/)
  if (delimiterMatch) {
    const [ja, ...zhParts] = singleLine.split(delimiterMatch[0])
    return {
      ja: ja.trim(),
      zh: zhParts.join(delimiterMatch[0]).trim(),
    }
  }

  return {
    ja: singleLine,
    zh: '中文翻译待补充',
  }
}

function createLine(cue: ParsedCue, index: number, nextStartMs?: number): LyricLine {
  const { ja, zh } = splitBilingualText(cue.text)
  const kana = wanakana.toHiragana(ja)
  const endMs = cue.endMs ?? nextStartMs ?? cue.startMs + 4200

  return {
    id: `lyric-${index + 1}`,
    startMs: cue.startMs,
    endMs: Math.max(cue.startMs + 1200, endMs),
    ja,
    kana,
    romaji: wanakana.toRomaji(kana),
    zh,
    focusTermIds: [],
  }
}

function parseLrc(text: string) {
  const cues: ParsedCue[] = []
  const timePattern = /\[(\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]/g

  for (const rawLine of text.split(/\r?\n/)) {
    timePattern.lastIndex = 0
    const matches = [...rawLine.matchAll(timePattern)]
    const content = rawLine.replace(timePattern, '').trim()
    for (const match of matches) {
      cues.push({
        startMs: parseTimestamp(match[1]),
        text: content,
      })
    }
  }

  return cues
}

function parseTimedText(text: string) {
  const blocks = text
    .replace(/^WEBVTT[^\n]*(?:\n|$)/i, '')
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)

  const cues: ParsedCue[] = []

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean)
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex < 0) {
      continue
    }

    const [start, end] = lines[timingIndex].split('-->').map((item) => item.trim().split(/\s+/)[0])
    cues.push({
      startMs: parseTimestamp(start),
      endMs: parseTimestamp(end),
      text: lines.slice(timingIndex + 1).join('\n'),
    })
  }

  return cues
}

function parsePlainText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map<ParsedCue>((line, index) => ({
      startMs: index * 4200,
      text: line,
    }))
}

export function parseLyrics(text: string, fileName = '') {
  const lowerName = fileName.toLowerCase()
  const cues =
    lowerName.endsWith('.lrc') || /\[\d{1,2}:\d{2}(?:[.,]\d{1,3})?\]/.test(text)
      ? parseLrc(text)
      : lowerName.endsWith('.srt') || lowerName.endsWith('.vtt') || text.includes('-->')
        ? parseTimedText(text)
        : parsePlainText(text)

  return cues
    .filter((cue) => cue.text.trim())
    .sort((a, b) => a.startMs - b.startMs)
    .map((cue, index, all) => createLine(cue, index, all[index + 1]?.startMs))
}

export function createTimedLyricLinesFromLrc(text: string) {
  return parseLrc(text)
    .filter((cue) => cue.text.trim())
    .sort((a, b) => a.startMs - b.startMs)
    .map((cue, index, all) => createLine(cue, index, all[index + 1]?.startMs))
}
