import { createHash, timingSafeEqual } from 'node:crypto'

import { readSongIndex, writeSongIndex } from './_tos-storage.mjs'
import {
  persistSongAnalysisResult,
  SONG_ANALYSIS_CALLBACK_TYPE,
} from '../server/song-analysis-callback.mjs'
import {
  createSongAnalysisJobId,
  isSongAnalysisJobId,
  normalizeSongAnalysisInput,
  SongAnalysisInputError,
} from '../server/song-analysis-contract.mjs'
import {
  createSongAnalysisQueue,
  enqueueSongAnalysis,
  getSongAnalysisJobSnapshot,
  getSongAnalysisWorkerHeartbeatKey,
} from '../server/song-analysis-queue.mjs'

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
    throw new HttpError(429, '歌曲分析请求过于频繁，请稍后再试')
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
  if (!isSongAnalysisJobId(jobId)) throw new HttpError(400, '无效的歌曲分析任务 ID')

  const job = await queue.getJob(jobId)
  if (!job) throw new HttpError(404, '歌曲分析任务不存在或结果已过期')
  res.status(200).json(await getSongAnalysisJobSnapshot(job))
}

async function handlePost(req, res, queue, body) {
  const input = normalizeSongAnalysisInput(body)
  const jobId = createSongAnalysisJobId(input)
  const existing = await queue.getJob(jobId)
  if (existing) {
    const state = await existing.getState()
    if (state === 'failed') {
      await enforceRateLimit(queue, req)
      if (!await workerIsAvailable(queue)) throw new HttpError(503, '歌曲分析 Worker 暂未上线')
      await existing.retry('failed')
    }
    const snapshot = await getSongAnalysisJobSnapshot(existing)
    res.status(snapshot.state === 'completed' ? 200 : 202).json(snapshot)
    return
  }

  await enforceRateLimit(queue, req)
  if (!await workerIsAvailable(queue)) throw new HttpError(503, '歌曲分析 Worker 暂未上线')
  const { job } = await enqueueSongAnalysis(queue, input)
  res.status(202).json(await getSongAnalysisJobSnapshot(job))
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
    throw new HttpError(503, '歌曲分析回调尚未配置')
  }
  if (!callbackIsAuthorized(req)) throw new HttpError(401, '歌曲分析回调鉴权失败')

  const result = await persistSongAnalysisResult({
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
    if (body?.type === SONG_ANALYSIS_CALLBACK_TYPE) {
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
      error: error instanceof Error ? error.message : '歌曲分析请求失败',
    })
  } finally {
    await queue?.close().catch(() => undefined)
  }
}
