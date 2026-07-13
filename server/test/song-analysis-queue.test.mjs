import assert from 'node:assert/strict'
import test from 'node:test'

import {
  enqueueSongAnalysis,
  getSongAnalysisJobSnapshot,
  getSongAnalysisRedisConnection,
} from '../song-analysis-queue.mjs'

const analysisInput = {
  songId: 'song-1',
  title: '曲名',
  artist: '歌手',
  lyricLines: [{ id: 'line-1', ja: '君が好き', zh: '我喜欢你' }],
}

test('does not add a second BullMQ job for the same song lyrics', async () => {
  const existing = { id: 'existing-job' }
  let additions = 0
  const queue = {
    getJob: async () => existing,
    add: async () => { additions += 1 },
  }

  const result = await enqueueSongAnalysis(queue, analysisInput)

  assert.deepEqual(result, { created: false, job: existing })
  assert.equal(additions, 0)
})

test('uses fail-fast Redis retries for API producers and blocking retries for Workers', () => {
  const previous = process.env.SONG_ANALYSIS_REDIS_URL
  process.env.SONG_ANALYSIS_REDIS_URL = 'rediss://worker:secret@redis.example.com:6380/2'
  try {
    const producer = getSongAnalysisRedisConnection()
    const worker = getSongAnalysisRedisConnection({ blocking: true })
    assert.deepEqual({
      host: producer.host,
      port: producer.port,
      username: producer.username,
      password: producer.password,
      db: producer.db,
      tls: producer.tls,
      maxRetriesPerRequest: producer.maxRetriesPerRequest,
    }, {
      host: 'redis.example.com',
      port: 6380,
      username: 'worker',
      password: 'secret',
      db: 2,
      tls: {},
      maxRetriesPerRequest: 1,
    })
    assert.equal(worker.maxRetriesPerRequest, null)
  } finally {
    if (previous === undefined) delete process.env.SONG_ANALYSIS_REDIS_URL
    else process.env.SONG_ANALYSIS_REDIS_URL = previous
  }
})

test('returns completed results and normalized progress from a BullMQ job', async () => {
  const job = {
    id: 'song-test',
    timestamp: Date.now() - 100,
    processedOn: Date.now() - 50,
    progress: { phase: 'validating', message: '正在校验' },
    returnvalue: { version: 1, songId: 'song-1', lines: [] },
    getState: async () => 'completed',
  }
  const snapshot = await getSongAnalysisJobSnapshot(job)
  assert.equal(snapshot.state, 'completed')
  assert.equal(snapshot.progress.phase, 'validating')
  assert.deepEqual(snapshot.result, job.returnvalue)
  assert.ok(snapshot.progress.elapsedMs >= 0)
})
