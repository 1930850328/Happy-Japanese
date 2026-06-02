import { buildStudyDataFromCues } from './subtitles'
import { createTimedLyricLinesFromLrc } from './lyrics'
import type { LyricLine, SongLesson, TranscriptSegment } from '../types'

interface LrcLibRecord {
  id: number
  trackName: string
  artistName: string
  albumName: string
  duration: number
  instrumental: boolean
  plainLyrics?: string
  syncedLyrics?: string
}

interface ITunesResult {
  trackId?: number
  artistName?: string
  trackName?: string
  previewUrl?: string
  trackViewUrl?: string
  artworkUrl100?: string
  collectionName?: string
  releaseDate?: string
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

function pickBestLrcRecord(records: LrcLibRecord[], song: SongLesson) {
  const lowerTitle = song.title.toLowerCase()
  const lowerArtist = song.artist.toLowerCase()

  return (
    records
      .filter((record) => record.syncedLyrics?.trim())
      .sort((left, right) => {
        const score = (record: LrcLibRecord) => {
          let value = 0
          if (record.trackName.toLowerCase() === lowerTitle) value += 8
          if (record.artistName.toLowerCase().includes(lowerArtist)) value += 5
          if (Math.abs(record.duration * 1000 - song.durationMs) < 3500) value += 3
          return value
        }
        return score(right) - score(left)
      })[0] ?? null
  )
}

function getLrcLibQuery(song: SongLesson) {
  const query = song.lyricSearchTerm ?? `${song.title} ${song.artist}`
  return `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`
}

export async function fetchCommunitySyncedLyrics(song: SongLesson) {
  const response = await fetch(getLrcLibQuery(song), {
    headers: {
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error('同步歌词暂时不可用')
  }

  const records = (await response.json()) as LrcLibRecord[]
  const record = pickBestLrcRecord(records, song)
  if (!record?.syncedLyrics?.trim()) {
    throw new Error('没有找到同步歌词')
  }

  const rawLines = createTimedLyricLinesFromLrc(record.syncedLyrics)
  const studyData = await buildStudyDataFromCues(
    rawLines.map((line) => ({
      startMs: line.startMs,
      endMs: line.endMs,
      jaText: line.ja,
    })),
  )

  return {
    lyricLines: studyData.segments.map(segmentToLyricLine),
    knowledgePoints: studyData.knowledgePoints,
    creditLine: `同步歌词来自 LRCLIB 社区记录：${record.trackName} / ${record.artistName}。中文为学习向翻译。`,
  }
}

function scorePreviewResult(result: ITunesResult, song: SongLesson) {
  const title = result.trackName?.toLowerCase() ?? ''
  const artist = result.artistName?.toLowerCase() ?? ''
  let score = 0
  if (title === song.title.toLowerCase()) score += 8
  if (title.includes(song.title.toLowerCase())) score += 4
  if (artist.includes(song.artist.toLowerCase())) score += 5
  if (result.previewUrl) score += 4
  return score
}

export async function fetchApplePreview(song: SongLesson) {
  const term = song.previewSearchTerm ?? `${song.title} ${song.artist}`
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&country=JP&limit=8`
  const response = await fetch(url)

  if (!response.ok) {
    return null
  }

  const payload = (await response.json()) as { results?: ITunesResult[] }
  const result =
    payload.results
      ?.filter((item) => item.previewUrl)
      .sort((left, right) => scorePreviewResult(right, song) - scorePreviewResult(left, song))[0] ??
    null

  if (!result?.previewUrl) {
    return null
  }

  return {
    appleMusicId: result.trackId ? String(result.trackId) : undefined,
    previewUrl: result.previewUrl,
    sourcePageUrl: result.trackViewUrl,
    artworkUrl: result.artworkUrl100?.replace('100x100bb', '600x600bb'),
  }
}
