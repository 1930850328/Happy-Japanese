import { createHash } from 'node:crypto'

export const SONG_ANALYSIS_JOB_VERSION = 1
export const SONG_ANALYSIS_MAX_LINES = 250

export class SongAnalysisInputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SongAnalysisInputError'
  }
}

function text(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength)
}

export function normalizeSongAnalysisInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SongAnalysisInputError('请求格式不正确')
  }

  const songId = text(value.songId, 200)
  const title = text(value.title, 300)
  const artist = text(value.artist, 300)
  if (!songId) throw new SongAnalysisInputError('缺少 songId')
  if (!Array.isArray(value.lyricLines) || value.lyricLines.length === 0) {
    throw new SongAnalysisInputError('缺少歌词')
  }
  if (value.lyricLines.length > SONG_ANALYSIS_MAX_LINES) {
    throw new SongAnalysisInputError(`歌词不能超过 ${SONG_ANALYSIS_MAX_LINES} 行`)
  }

  const lyricLines = value.lyricLines.map((line, index) => {
    const id = text(line?.id || `line-${index + 1}`, 200)
    const ja = text(line?.ja, 1000)
    const zh = text(line?.zh, 1000)
    if (!id || !ja) throw new SongAnalysisInputError(`第 ${index + 1} 行歌词不完整`)
    return { id, ja, zh }
  })

  return {
    version: SONG_ANALYSIS_JOB_VERSION,
    songId,
    title,
    artist,
    lyricLines,
  }
}

export function createSongAnalysisJobId(input) {
  const normalized = normalizeSongAnalysisInput(input)
  const digest = createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
  return `song-${digest}`
}

export function isSongAnalysisJobId(value) {
  return /^song-[a-f0-9]{64}$/u.test(String(value ?? ''))
}
