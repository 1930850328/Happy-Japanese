import { Worker } from 'bullmq'

import { CodexSongAnalyzer } from '../server/codex-song-analyzer.mjs'
import { normalizeSongAnalysisInput } from '../server/song-analysis-contract.mjs'
import {
  getSongAnalysisQueuePrefix,
  getSongAnalysisRedisConnection,
  getSongAnalysisWorkerHeartbeatKey,
  SONG_ANALYSIS_QUEUE_NAME,
} from '../server/song-analysis-queue.mjs'

const HEARTBEAT_INTERVAL_MS = 10_000
const HEARTBEAT_TTL_SECONDS = 30
const analyzer = new CodexSongAnalyzer()

const worker = new Worker(
  SONG_ANALYSIS_QUEUE_NAME,
  async (job) => {
    const input = normalizeSongAnalysisInput(job.data)
    return analyzer.analyze(input, (progress) => job.updateProgress(progress))
  },
  {
    connection: getSongAnalysisRedisConnection({ blocking: true }),
    prefix: getSongAnalysisQueuePrefix(),
    concurrency: 1,
    lockDuration: 7 * 60 * 1000,
    skipVersionCheck: true,
  },
)

const redis = await worker.client
const heartbeatKey = getSongAnalysisWorkerHeartbeatKey()
const writeHeartbeat = () => redis.set(heartbeatKey, String(Date.now()), 'EX', HEARTBEAT_TTL_SECONDS)
await writeHeartbeat()
const heartbeatTimer = setInterval(() => {
  void writeHeartbeat().catch((error) => console.error('[song-analysis-worker] heartbeat failed', error))
}, HEARTBEAT_INTERVAL_MS)

worker.on('completed', (job) => {
  console.log(`[song-analysis-worker] completed ${job.id}`)
})
worker.on('failed', (job, error) => {
  console.error(`[song-analysis-worker] failed ${job?.id || 'unknown'}: ${error.message}`)
})
worker.on('error', (error) => {
  console.error('[song-analysis-worker] worker error', error)
})

console.log(`[song-analysis-worker] listening on BullMQ queue ${SONG_ANALYSIS_QUEUE_NAME}`)
console.log('[song-analysis-worker] Codex authentication is loaded from the Worker host; OPENAI_API_KEY is not required')

let closing = false
async function shutdown(signal) {
  if (closing) return
  closing = true
  console.log(`[song-analysis-worker] shutting down after ${signal}`)
  clearInterval(heartbeatTimer)
  await worker.close()
  await analyzer.close()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
