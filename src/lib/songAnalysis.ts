import type { LyricLine, StudyStage } from '../types'
import { getCloudProfileId } from './cloudProfile'

export interface SongAnalysisItem {
  expression: string
  reading: string
  meaningZh: string
  kind: 'word' | 'grammar'
  explanationZh: string
  stage: StudyStage
  confidence: number
}

export interface SongAnalysisLine {
  lineId: string
  translationZh: string
  items: SongAnalysisItem[]
}

export interface SongAnalysis {
  version: 1
  songId: string
  lines: SongAnalysisLine[]
}

export interface SongAnalysisProgress {
  phase: string
  message: string
  elapsedMs?: number
  queuePosition?: number
  model?: string
}

interface SongAnalysisJobResponse {
  jobId?: string
  state?: string
  progress?: SongAnalysisProgress
  result?: SongAnalysis
  error?: string
}

const endpoint = String(import.meta.env.VITE_SONG_ANALYSIS_API_URL || '/api/song-analysis')
const configuredTimeout = Number(import.meta.env.VITE_SONG_ANALYSIS_TIMEOUT_MS)
const requestTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
  ? configuredTimeout
  : 20 * 60 * 1000
const pendingAnalyses = new Map<string, {
  promise: Promise<SongAnalysis>
  listeners: Set<(progress: SongAnalysisProgress) => void>
}>()
const pendingSiteGenerations = new Map<string, {
  promise: Promise<void>
  listeners: Set<(progress: SongAnalysisProgress) => void>
}>()

function hashText(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function analysisKey(songId: string, lyricLines: LyricLine[]) {
  const signature = lyricLines.map(({ id, ja, zh }) => `${id}:${ja}:${zh}`).join('|')
  return `${songId}:${lyricLines.length}:${hashText(signature)}`
}

function waitForNextPoll(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, 1_500)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

async function readJobResponse(response: Response) {
  const body = await response.json().catch(() => null) as SongAnalysisJobResponse | null
  if (!response.ok) {
    throw new Error(body?.error || `学习信息请求失败 (${response.status})`)
  }
  return body ?? {}
}

function consumeJobResponse(body: SongAnalysisJobResponse, notify: (progress: SongAnalysisProgress) => void) {
  if (body.progress) notify(body.progress)
  if (body.state === 'failed') throw new Error(body.error || '学习信息生成失败')
  if (body.state === 'completed' && body.result?.lines) return body.result
  return null
}

async function requestSongAnalysis(
  songId: string,
  lyricLines: LyricLine[],
  title: string,
  artist: string,
  notify: (progress: SongAnalysisProgress) => void,
) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs)
  try {
    notify({ phase: 'connecting', message: '正在连接云端学习信息服务' })
    const initial = await readJobResponse(await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        songId,
        title,
        artist,
        lyricLines: lyricLines.map(({ id, ja, zh }) => ({ id, ja, zh })),
      }),
      signal: controller.signal,
    }))
    const initialResult = consumeJobResponse(initial, notify)
    if (initialResult) return initialResult
    if (!initial.jobId) throw new Error('学习信息服务没有返回任务 ID')

    while (!controller.signal.aborted) {
      await waitForNextPoll(controller.signal)
      const statusUrl = new URL(endpoint, window.location.href)
      statusUrl.searchParams.set('jobId', initial.jobId)
      const status = await readJobResponse(await fetch(statusUrl, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }))
      const result = consumeJobResponse(status, notify)
      if (result) return result
    }
    throw new DOMException('Aborted', 'AbortError')
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('云端 Codex 学习信息生成等待超时')
    }
    if (error instanceof TypeError) {
      throw new Error('云端学习信息服务暂时不可用，请稍后重试')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

async function requestSiteSongLearningGeneration(
  profileId: string,
  songId: string,
  notify: (progress: SongAnalysisProgress) => void,
) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs)
  try {
    notify({ phase: 'submitting', message: '歌曲已保存，正在创建学习信息任务' })
    let status = await readJobResponse(await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId, songId }),
      signal: controller.signal,
    }))

    while (!controller.signal.aborted) {
      if (status.progress) notify(status.progress)
      if (status.state === 'failed') throw new Error(status.error || '学习信息生成失败')
      if (status.state === 'completed') return
      if (!status.jobId) throw new Error('学习信息服务没有返回任务 ID')

      await waitForNextPoll(controller.signal)
      const statusUrl = new URL(endpoint, window.location.href)
      statusUrl.searchParams.set('jobId', status.jobId)
      status = await readJobResponse(await fetch(statusUrl, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }))
    }
    throw new DOMException('Aborted', 'AbortError')
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('云端学习信息生成等待超时')
    }
    if (error instanceof TypeError) {
      throw new Error('云端学习信息服务暂时不可用，请稍后重试')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export function generateSiteSongLearningInfo(
  songId: string,
  onProgress?: (progress: SongAnalysisProgress) => void,
) {
  const profileId = getCloudProfileId()
  const key = `${profileId}:${songId}`
  const existing = pendingSiteGenerations.get(key)
  if (existing) {
    if (onProgress) existing.listeners.add(onProgress)
    return existing.promise
  }

  const listeners = new Set<(progress: SongAnalysisProgress) => void>()
  if (onProgress) listeners.add(onProgress)
  const request = requestSiteSongLearningGeneration(profileId, songId, (progress) => {
    listeners.forEach((listener) => listener(progress))
  })
  pendingSiteGenerations.set(key, { promise: request, listeners })
  void request.finally(() => {
    if (pendingSiteGenerations.get(key)?.promise === request) pendingSiteGenerations.delete(key)
  }).catch(() => {})
  return request
}

export function analyzeSongWithAgent(
  songId: string,
  lyricLines: LyricLine[],
  title = '',
  artist = '',
  onProgress?: (progress: SongAnalysisProgress) => void,
) {
  const key = analysisKey(songId, lyricLines)
  const existing = pendingAnalyses.get(key)
  if (existing) {
    if (onProgress) existing.listeners.add(onProgress)
    return existing.promise
  }

  const listeners = new Set<(progress: SongAnalysisProgress) => void>()
  if (onProgress) listeners.add(onProgress)
  const request = requestSongAnalysis(songId, lyricLines, title, artist, (progress) => {
    listeners.forEach((listener) => listener(progress))
  })
  pendingAnalyses.set(key, { promise: request, listeners })
  void request.finally(() => {
    if (pendingAnalyses.get(key)?.promise === request) pendingAnalyses.delete(key)
  }).catch(() => {})
  return request
}
