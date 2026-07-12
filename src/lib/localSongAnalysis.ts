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

export interface LocalSongAnalysisProgress {
  phase: string
  message: string
  elapsedMs?: number
  queuePosition?: number
  model?: string
}

const workerUrl = String(import.meta.env.VITE_SONG_ANALYSIS_URL || 'http://127.0.0.1:4319').replace(/\/$/, '')
const pendingAnalyses = new Map<string, {
  promise: Promise<LocalSongAnalysis>
  listeners: Set<(progress: LocalSongAnalysisProgress) => void>
}>()

async function requestSongAnalysis(
  songId: string,
  lyricLines: LyricLine[],
  title: string,
  artist: string,
  notify: (progress: LocalSongAnalysisProgress) => void,
) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 6 * 60 * 1000)
  let readingStatus = false
  const readStatus = async () => {
    if (readingStatus) return
    readingStatus = true
    try {
      const response = await fetch(`${workerUrl}/status?songId=${encodeURIComponent(songId)}`)
      if (response.ok) notify(await response.json() as LocalSongAnalysisProgress)
    } catch {
      // The main analysis request reports connection failures.
    } finally {
      readingStatus = false
    }
  }
  notify({ phase: 'connecting', message: '正在连接本地歌词分析服务' })
  const statusTimer = window.setInterval(() => void readStatus(), 1_500)
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
    window.clearInterval(statusTimer)
  }
}

export function analyzeSongWithLocalCodex(
  songId: string,
  lyricLines: LyricLine[],
  title = '',
  artist = '',
  onProgress?: (progress: LocalSongAnalysisProgress) => void,
) {
  const existing = pendingAnalyses.get(songId)
  if (existing) {
    if (onProgress) existing.listeners.add(onProgress)
    return existing.promise
  }

  const listeners = new Set<(progress: LocalSongAnalysisProgress) => void>()
  if (onProgress) listeners.add(onProgress)
  const request = requestSongAnalysis(songId, lyricLines, title, artist, (progress) => {
    listeners.forEach((listener) => listener(progress))
  })
  pendingAnalyses.set(songId, { promise: request, listeners })
  void request.finally(() => {
    if (pendingAnalyses.get(songId)?.promise === request) pendingAnalyses.delete(songId)
  }).catch(() => {})
  return request
}
