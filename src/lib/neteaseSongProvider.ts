import { buildStudyDataFromCues } from './subtitles'
import type { LyricLine, TranscriptSegment } from '../types'

const NETEASE_MATCH_ENDPOINT = '/api/netease-song-match'
const FALLBACK_API_ORIGIN = 'https://yuru-nihongo-study.vercel.app'

interface NeteaseMatchRequest {
  title: string
  artist: string
  durationMs: number
}

interface NeteaseMatchRecord {
  id: string
  title: string
  artist: string
  album?: string
  durationMs: number
  cover?: string
  score: number
  lrc: string
  tlyric?: string
  romalrc?: string
}

interface NeteaseMatchResponse {
  provider: 'netease'
  match: NeteaseMatchRecord
}

interface ParsedLrcLine {
  startMs: number
  text: string
}

export interface MatchedNeteaseSong {
  id: string
  title: string
  artist: string
  album?: string
  durationMs: number
  cover?: string
  lyricLines: LyricLine[]
  rawLyricText: string
  score: number
}

function getApiEndpoint(pathname: string) {
  if (typeof window === 'undefined') {
    return pathname
  }

  const { origin, hostname } = window.location
  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    return `${FALLBACK_API_ORIGIN}${pathname}`
  }

  return `${origin}${pathname}`
}

function parseFractionMs(value: string) {
  return Number(value.padEnd(3, '0').slice(0, 3))
}

function parseTimestamp(value: string) {
  const parts = value.trim().replace(',', '.').split(':')

  if (parts.length === 2) {
    const [minutes, seconds] = parts.map(Number)
    return Number.isNaN(minutes) || Number.isNaN(seconds) ? 0 : Math.round((minutes * 60 + seconds) * 1000)
  }

  if (parts.length === 3) {
    const [first, second, third] = parts
    const firstNumber = Number(first)
    const secondNumber = Number(second)
    if (Number.isNaN(firstNumber) || Number.isNaN(secondNumber)) {
      return 0
    }

    if (/^\d{1,3}$/.test(third)) {
      return Math.round((firstNumber * 60 + secondNumber) * 1000 + parseFractionMs(third))
    }

    const seconds = Number(third)
    return Number.isNaN(seconds) ? 0 : Math.round(((firstNumber * 60 + secondNumber) * 60 + seconds) * 1000)
  }

  return 0
}

function stripLrcText(value: string) {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]+\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isCreditLine(value: string) {
  return /^(作词|作詞|作曲|编曲|編曲|制作|混音|母带|母帶|监制|監製|演唱|歌手|by[:：])/i.test(value.trim())
}

function hasLyricContent(value: string) {
  const text = stripLrcText(value)
  return Boolean(text) && !isCreditLine(text)
}

function parseLrc(text: string) {
  const lines: ParsedLrcLine[] = []
  const timePattern = /\[((?:\d{1,2}:){1,2}\d{1,3}(?:[.,]\d{1,3})?)\]/g

  for (const rawLine of text.split(/\r?\n/)) {
    timePattern.lastIndex = 0
    const matches = [...rawLine.matchAll(timePattern)]
    if (matches.length === 0) {
      continue
    }

    const content = stripLrcText(rawLine.replace(timePattern, ''))
    if (!hasLyricContent(content)) {
      continue
    }

    for (const match of matches) {
      lines.push({
        startMs: parseTimestamp(match[1]),
        text: content,
      })
    }
  }

  return lines.sort((left, right) => left.startMs - right.startMs)
}

function findTranslatedLine(startMs: number, translatedLines: ParsedLrcLine[]) {
  let bestLine: ParsedLrcLine | null = null
  let bestGap = Number.POSITIVE_INFINITY

  for (const line of translatedLines) {
    const gap = Math.abs(line.startMs - startMs)
    if (gap < bestGap) {
      bestLine = line
      bestGap = gap
    }
  }

  return bestLine && bestGap <= 900 ? bestLine.text : undefined
}

function segmentToLyricLine(segment: TranscriptSegment, index: number): LyricLine {
  return {
    id: `lyric-${index + 1}`,
    startMs: segment.startMs,
    endMs: segment.endMs,
    ja: segment.ja,
    kana: segment.kana,
    romaji: segment.romaji,
    zh: segment.zh,
    focusTermIds: segment.focusTermIds,
  }
}

async function buildLyricLinesFromNetease(match: NeteaseMatchRecord) {
  const rawLines = parseLrc(match.lrc)
  if (rawLines.length === 0) {
    return []
  }

  const translatedLines = match.tlyric ? parseLrc(match.tlyric) : []
  const cues = rawLines.map((line, index, all) => {
    const nextStartMs = all[index + 1]?.startMs
    const fallbackEndMs = line.startMs + 4200

    return {
      startMs: line.startMs,
      endMs: Math.max(line.startMs + 1200, nextStartMs ?? fallbackEndMs),
      jaText: line.text,
      zhText: findTranslatedLine(line.startMs, translatedLines),
      zhSource: translatedLines.length > 0 ? ('subtitle-file' as const) : undefined,
    }
  })

  const studyData = await buildStudyDataFromCues(cues, {
    includeKnowledge: false,
  })
  return studyData.segments.map(segmentToLyricLine)
}

function createRawLyricText(match: NeteaseMatchRecord) {
  const blocks = [
    match.lrc.trim(),
    match.tlyric?.trim() ? `[translation]\n${match.tlyric.trim()}` : '',
    match.romalrc?.trim() ? `[romaji]\n${match.romalrc.trim()}` : '',
  ].filter(Boolean)

  return blocks.join('\n\n')
}

export async function matchNeteaseSongForUpload(input: NeteaseMatchRequest): Promise<MatchedNeteaseSong | null> {
  const response = await fetch(getApiEndpoint(NETEASE_MATCH_ENDPOINT), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    return null
  }

  const payload = (await response.json()) as NeteaseMatchResponse
  const match = payload.match
  const lyricLines = await buildLyricLinesFromNetease(match)

  if (lyricLines.length === 0) {
    return null
  }

  return {
    id: match.id,
    title: match.title,
    artist: match.artist,
    album: match.album,
    durationMs: match.durationMs,
    cover: match.cover,
    lyricLines,
    rawLyricText: createRawLyricText(match),
    score: match.score,
  }
}
