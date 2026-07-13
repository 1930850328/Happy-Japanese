import { createHash, timingSafeEqual } from 'node:crypto'

import {
  readSongIndex,
  sanitizeProfileId,
  sanitizeSongId,
  writeSongIndex,
} from './_tos-storage.mjs'
import {
  persistSongAnalysisFailure,
  persistSongAnalysisResult,
  SONG_ANALYSIS_CALLBACK_TYPE,
  SONG_ANALYSIS_FAILURE_CALLBACK_TYPE,
} from '../server/song-analysis-callback.mjs'
import {
  createSongAnalysisJobId,
  isSongAnalysisJobId,
  normalizeSongAnalysisInput,
  SongAnalysisInputError,
} from '../server/song-analysis-contract.mjs'
import {
  createStoredSongAnalysisInput,
  updateSongLearningGenerationStatus,
} from '../server/song-analysis-lifecycle.mjs'
import {
  createSongAnalysisQueue,
  enqueueSongAnalysis,
  getSongAnalysisJobSnapshot,
  getSongAnalysisWorkerHeartbeatKey,
} from '../server/song-analysis-queue.mjs'
import {
  createSongLyricVersion,
  isSongStudyIndexFresh,
} from '../server/song-study-index.mjs'

const defaultAllowedOrigins = new Set([
  'https://hxf-yuri.cn',
  'https://www.hxf-yuri.cn',
  'https://yuru-nihongo-study.vercel.app',
])

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function allowedOrigins() {
  return new Set([
    ...defaultAllowedOrigins,
    ...String(process.env.SONG_ANALYSIS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ])
}

function isAllowedOrigin(origin) {
  if (!origin) return true
  if (allowedOrigins().has(origin)) return true
  try {
    const url = new URL(origin)
    return (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && (url.protocol === 'http:' || url.protocol === 'https:')
  } catch {
    return false
  }
}

function setHeaders(req, res) {
  const origin = req.headers.origin
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Vary', 'Origin')
}

function readBody(req) {
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body)
  return req.body ?? {}
}

function clientFingerprint(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  const address = forwarded || String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown')
  return createHash('sha256').update(address).digest('hex').slice(0, 24)
}

async function enforceRateLimit(queue, req) {
  const maxRequests = positiveInteger(process.env.SONG_ANALYSIS_RATE_LIMIT_MAX, 10)
  const windowSeconds = positiveInteger(process.env.SONG_ANALYSIS_RATE_LIMIT_WINDOW_SECONDS, 60 * 60)
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000))
  const key = `${getSongAnalysisWorkerHeartbeatKey()}:rate:${bucket}:${clientFingerprint(req)}`
  const client = await queue.client
  const transaction = client.multi()
  transaction.incr(key)
  transaction.expire(key, windowSeconds + 60)
  const result = await transaction.exec()
  const count = Number(result?.[0]?.[1] ?? 0)
  if (count > maxRequests) {
    throw new HttpError(429, '学习信息生成请求过于频繁，请稍后再试')
  }
}

async function workerIsAvailable(queue) {
  const client = await queue.client
  return Boolean(await client.get(getSongAnalysisWorkerHeartbeatKey()))
}

async function handleGet(req, res, queue) {
  const jobId = String(req.query?.jobId || '')
  if (!jobId) {
    res.status(200).json({ ok: true, workerAvailable: await workerIsAvailable(queue) })
    return
  }
  if (!isSongAnalysisJobId(jobId)) throw new HttpError(400, '无效的学习信息任务 ID')

  const job = await queue.getJob(jobId)
  if (!job) throw new HttpError(404, '学习信息任务不存在或结果已过期')
  res.status(200).json(await getSongAnalysisJobSnapshot(job))
}

function isStoredSongGenerationRequest(body) {
  return Boolean(body?.profileId && body?.songId && !Array.isArray(body?.lyricLines))
}

async function readStoredSongGeneration(body) {
  const profileId = sanitizeProfileId(body.profileId)
  const songId = sanitizeSongId(body.songId)
  if (!profileId) throw new HttpError(400, '缺少 profileId')
  if (!songId) throw new HttpError(400, '缺少 songId')

  const index = await readSongIndex(profileId)
  const song = index.songs.find((item) => item.id === songId)
  if (!song) throw new HttpError(404, '歌曲不存在')
  if (!Array.isArray(song.lyricLines) || song.lyricLines.length === 0) {
    throw new HttpError(400, '歌曲还没有可用于生成学习信息的歌词')
  }

  const input = createStoredSongAnalysisInput(profileId, song)
  return {
    profileId,
    song,
    input,
    jobId: createSongAnalysisJobId(input),
    lyricVersion: createSongLyricVersion(song.lyricLines),
  }
}

async function updateStoredGenerationStatus(generation, status, error) {
  return await updateSongLearningGenerationStatus({
    profileId: generation.profileId,
    songId: generation.song.id,
    jobId: generation.jobId,
    lyricVersion: generation.lyricVersion,
    status,
    error,
    readSongIndex,
    writeSongIndex,
  })
}

async function handlePost(req, res, queue, body) {
  const storedGeneration = isStoredSongGenerationRequest(body)
    ? await readStoredSongGeneration(body)
    : null
  const input = storedGeneration?.input ?? normalizeSongAnalysisInput(body)
  const jobId = createSongAnalysisJobId(input)
  const existing = await queue.getJob(jobId)
  if (existing) {
    const state = await existing.getState()
    if (state === 'failed' && !storedGeneration) {
      await enforceRateLimit(queue, req)
      if (!await workerIsAvailable(queue)) throw new HttpError(503, '学习信息 Worker 暂未上线')
      await existing.retry('failed')
    }
    if (storedGeneration) {
      if (state === 'failed') {
        await updateStoredGenerationStatus(storedGeneration, 'failed', existing.failedReason || '学习信息生成失败')
      } else if (state !== 'completed') {
        await updateStoredGenerationStatus(storedGeneration, 'queued')
      }
    }
    const snapshot = await getSongAnalysisJobSnapshot(existing)
    res.status(snapshot.state === 'completed' ? 200 : 202).json(snapshot)
    return
  }

  if (
    storedGeneration
    && isSongStudyIndexFresh(storedGeneration.song.studyIndex, storedGeneration.song.id, storedGeneration.song.lyricLines)
  ) {
    res.status(200).json({
      jobId,
      state: 'completed',
      persisted: true,
      progress: { phase: 'completed', message: '学习信息已保存' },
    })
    return
  }

  await enforceRateLimit(queue, req)
  if (!await workerIsAvailable(queue)) throw new HttpError(503, '学习信息 Worker 暂未上线')
  if (storedGeneration) {
    const statusUpdate = await updateStoredGenerationStatus(storedGeneration, 'queued')
    if (!statusUpdate.updated) {
      if (statusUpdate.reason === 'already-ready') {
        res.status(200).json({
          jobId,
          state: 'completed',
          persisted: true,
          progress: { phase: 'completed', message: '学习信息已保存' },
        })
        return
      }
      throw new HttpError(409, '歌曲或歌词已更新，请按最新内容重新创建学习信息任务')
    }
  }
  try {
    const { job } = await enqueueSongAnalysis(queue, input)
    res.status(202).json(await getSongAnalysisJobSnapshot(job))
  } catch (error) {
    if (storedGeneration) {
      await updateStoredGenerationStatus(storedGeneration, 'pending', '任务暂未进入队列，将在下次打开页面时重试')
    }
    throw error
  }
}

function callbackIsAuthorized(req) {
  const expected = process.env.SONG_ANALYSIS_CALLBACK_SECRET?.trim() || ''
  const authorization = String(req.headers.authorization || '')
  const provided = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!expected || !provided) return false
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer)
}

async function handleAnalysisCallback(req, res, body) {
  if (!process.env.SONG_ANALYSIS_CALLBACK_SECRET?.trim()) {
    throw new HttpError(503, '学习信息回调尚未配置')
  }
  if (!callbackIsAuthorized(req)) throw new HttpError(401, '学习信息回调鉴权失败')

  const result = body.type === SONG_ANALYSIS_FAILURE_CALLBACK_TYPE
    ? await persistSongAnalysisFailure({
        jobId: String(body.jobId || ''),
        input: body.input,
        error: body.error,
        readSongIndex,
        writeSongIndex,
      })
    : await persistSongAnalysisResult({
        jobId: String(body.jobId || ''),
        input: body.input,
        analysis: body.analysis,
        readSongIndex,
        writeSongIndex,
      })
  res.status(200).json({ ok: true, ...result })
}

export default async function handler(req, res) {
  setHeaders(req, res)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (!isAllowedOrigin(req.headers.origin)) {
    res.status(403).json({ error: '不允许的请求来源' })
    return
  }

  let queue
  try {
    const body = req.method === 'POST' ? readBody(req) : null
    if ([SONG_ANALYSIS_CALLBACK_TYPE, SONG_ANALYSIS_FAILURE_CALLBACK_TYPE].includes(body?.type)) {
      await handleAnalysisCallback(req, res, body)
      return
    }
    queue = createSongAnalysisQueue()
    if (req.method === 'GET') {
      await handleGet(req, res, queue)
      return
    }
    if (req.method === 'POST') {
      await handlePost(req, res, queue, body)
      return
    }
    res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    const statusCode = error instanceof SongAnalysisInputError
      ? 400
      : error instanceof HttpError
        ? error.statusCode
        : /SONG_ANALYSIS_REDIS_URL/u.test(error instanceof Error ? error.message : '')
          ? 503
          : 500
    if (statusCode >= 500) console.error('[song-analysis-api]', error)
    res.status(statusCode).json({
      error: error instanceof Error ? error.message : '学习信息请求失败',
    })
  } finally {
    await queue?.close().catch(() => undefined)
  }
}
