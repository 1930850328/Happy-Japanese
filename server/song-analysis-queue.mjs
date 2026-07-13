import { Queue } from 'bullmq'

import { createSongAnalysisJobId } from './song-analysis-contract.mjs'

export const SONG_ANALYSIS_QUEUE_NAME = 'song-analysis'
export const SONG_ANALYSIS_JOB_NAME = 'analyze-song'

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getSongAnalysisQueuePrefix() {
  return process.env.SONG_ANALYSIS_QUEUE_PREFIX?.trim() || 'happy-japanese'
}

export function getSongAnalysisWorkerHeartbeatKey() {
  return `${getSongAnalysisQueuePrefix()}:song-analysis-worker-heartbeat`
}

export function getSongAnalysisRedisConnection({ blocking = false } = {}) {
  const rawUrl = process.env.SONG_ANALYSIS_REDIS_URL?.trim() || process.env.REDIS_URL?.trim()
  if (!rawUrl) {
    throw new Error('Missing SONG_ANALYSIS_REDIS_URL')
  }

  const url = new URL(rawUrl)
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error('SONG_ANALYSIS_REDIS_URL must use redis:// or rediss://')
  }

  const database = url.pathname && url.pathname !== '/'
    ? Number.parseInt(url.pathname.slice(1), 10)
    : 0

  return {
    host: url.hostname,
    port: positiveInteger(url.port, url.protocol === 'rediss:' ? 6380 : 6379),
    username: decodeURIComponent(url.username || 'default'),
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isFinite(database) && database >= 0 ? database : 0,
    maxRetriesPerRequest: blocking ? null : 1,
    connectTimeout: positiveInteger(process.env.SONG_ANALYSIS_REDIS_CONNECT_TIMEOUT_MS, 5_000),
    enableReadyCheck: true,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  }
}

export function createSongAnalysisQueue() {
  return new Queue(SONG_ANALYSIS_QUEUE_NAME, {
    connection: getSongAnalysisRedisConnection(),
    prefix: getSongAnalysisQueuePrefix(),
    defaultJobOptions: {
      attempts: positiveInteger(process.env.SONG_ANALYSIS_JOB_ATTEMPTS, 2),
      backoff: {
        type: 'exponential',
        delay: positiveInteger(process.env.SONG_ANALYSIS_RETRY_DELAY_MS, 5_000),
      },
      removeOnComplete: {
        age: positiveInteger(process.env.SONG_ANALYSIS_RESULT_TTL_SECONDS, 7 * 24 * 60 * 60),
        count: positiveInteger(process.env.SONG_ANALYSIS_RESULT_MAX_COUNT, 500),
      },
      removeOnFail: {
        age: positiveInteger(process.env.SONG_ANALYSIS_FAILURE_TTL_SECONDS, 3 * 24 * 60 * 60),
        count: positiveInteger(process.env.SONG_ANALYSIS_FAILURE_MAX_COUNT, 200),
      },
    },
  })
}

const stateProgress = {
  waiting: { phase: 'queued', message: '任务已进入云端学习信息队列' },
  'waiting-children': { phase: 'queued', message: '任务正在等待依赖完成' },
  delayed: { phase: 'retrying', message: '生成失败，正在等待自动重试' },
  active: { phase: 'starting', message: '云端 Worker 已领取任务' },
  completed: { phase: 'completed', message: '学习信息生成完成' },
  failed: { phase: 'failed', message: '学习信息生成失败' },
  paused: { phase: 'queued', message: '学习信息队列暂时暂停' },
}

function normalizeProgress(progress, state) {
  const fallback = stateProgress[state] ?? { phase: state, message: '正在处理学习信息任务' }
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return fallback
  return {
    ...fallback,
    ...progress,
    phase: typeof progress.phase === 'string' && progress.phase ? progress.phase : fallback.phase,
    message: typeof progress.message === 'string' && progress.message ? progress.message : fallback.message,
  }
}

export async function getSongAnalysisJobSnapshot(job) {
  const state = await job.getState()
  const startedAt = job.processedOn || job.timestamp
  return {
    jobId: job.id,
    state,
    progress: {
      ...normalizeProgress(job.progress, state),
      elapsedMs: Math.max(0, Date.now() - startedAt),
    },
    ...(state === 'completed' ? { result: job.returnvalue } : {}),
    ...(state === 'failed' ? { error: job.failedReason || '学习信息生成失败' } : {}),
  }
}

export async function enqueueSongAnalysis(queue, input) {
  const jobId = createSongAnalysisJobId(input)
  const existing = await queue.getJob(jobId)
  if (existing) return { created: false, job: existing }

  const job = await queue.add(SONG_ANALYSIS_JOB_NAME, input, { jobId })
  return { created: true, job }
}
