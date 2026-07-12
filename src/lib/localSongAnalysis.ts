import type { LyricLine, StudyStage } from '../types'

export interface LocalSongAnalysisItem {
  expression: string
  reading: string
  meaningZh: string
  kind: 'word' | 'grammar'
  explanationZh: string
  stage: StudyStage
  confidence: number
}

export interface LocalSongAnalysisLine {
  lineId: string
  translationZh: string
  items: LocalSongAnalysisItem[]
}

export interface LocalSongAnalysis {
  version: 1
  songId: string
  lines: LocalSongAnalysisLine[]
}

const workerUrl = String(import.meta.env.VITE_SONG_ANALYSIS_URL || 'http://127.0.0.1:4319').replace(/\/$/, '')
const pendingAnalyses = new Map<string, Promise<LocalSongAnalysis>>()

async function requestSongAnalysis(songId: string, lyricLines: LyricLine[], title: string, artist: string) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8 * 60 * 1000)
  try {
    const response = await fetch(`${workerUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songId,
        title,
        artist,
        lyricLines: lyricLines.map(({ id, ja, zh }) => ({ id, ja, zh })),
      }),
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null) as LocalSongAnalysis | { error?: string } | null
    if (!response.ok) {
      throw new Error(body && 'error' in body && body.error ? body.error : `本地歌词分析失败 (${response.status})`)
    }
    if (!body || !('lines' in body) || !Array.isArray(body.lines)) {
      throw new Error('本地歌词分析服务返回了无效结果')
    }
    return body as LocalSongAnalysis
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('本地 Codex 歌词分析超时')
    }
    if (error instanceof TypeError) {
      throw new Error('本地歌词分析服务未启动，请先运行 pnpm worker:song-analysis')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export function analyzeSongWithLocalCodex(songId: string, lyricLines: LyricLine[], title = '', artist = '') {
  const existing = pendingAnalyses.get(songId)
  if (existing) return existing

  const request = requestSongAnalysis(songId, lyricLines, title, artist)
  pendingAnalyses.set(songId, request)
  void request.finally(() => {
    if (pendingAnalyses.get(songId) === request) pendingAnalyses.delete(songId)
  }).catch(() => {})
  return request
}
