import assert from 'node:assert/strict'
import test from 'node:test'

import { persistSongAnalysisResult } from '../song-analysis-callback.mjs'
import { createSongAnalysisJobId, normalizeSongAnalysisInput } from '../song-analysis-contract.mjs'

const lyricLines = [{
  id: 'line-1',
  startMs: 100,
  endMs: 1200,
  ja: '君が好き',
  kana: '',
  romaji: '',
  zh: '我喜欢你',
  focusTermIds: [],
  wordTimings: [{ id: 'word-1', text: '君', startMs: 100, endMs: 300 }],
}]

const input = normalizeSongAnalysisInput({
  profileId: 'profile-a',
  songId: 'song-1',
  title: '曲名',
  artist: '歌手',
  lyricLines,
})
const analysis = {
  version: 1,
  songId: 'song-1',
  lines: [{
    lineId: 'line-1',
    translationZh: '我喜欢你。',
    items: [{
      expression: '君',
      reading: 'きみ',
      meaningZh: '你',
      kind: 'word',
      explanationZh: '用于亲近地称呼对方。',
      stage: 'beginner',
      confidence: 0.98,
    }],
  }],
}

test('persists a completed analysis once and treats repeated callbacks as idempotent', async () => {
  let stored = {
    version: 1,
    profileId: 'profile-a',
    songs: [{ id: 'song-1', lyricLines, updatedAt: '2026-01-01T00:00:00.000Z' }],
  }
  let writes = 0
  const dependencies = {
    readSongIndex: async () => stored,
    writeSongIndex: async (_profileId, next) => {
      writes += 1
      stored = next
    },
  }
  const payload = {
    jobId: createSongAnalysisJobId(input),
    input,
    analysis,
    ...dependencies,
  }

  const first = await persistSongAnalysisResult(payload)
  const second = await persistSongAnalysisResult(payload)

  assert.equal(first.persisted, true)
  assert.equal(second.duplicate, true)
  assert.equal(writes, 1)
  assert.equal(stored.songs[0].analysis.status, 'ready')
  assert.equal(stored.songs[0].studyIndex.lines[0].zh, '我喜欢你。')
  assert.equal(Object.values(stored.songs[0].studyIndex.knowledge)[0].romaji, 'kimi')
})

test('does not let a stale Worker result overwrite changed lyrics', async () => {
  let writes = 0
  const stored = {
    version: 1,
    profileId: 'profile-a',
    songs: [{
      id: 'song-1',
      lyricLines: [{ ...lyricLines[0], ja: '君が大好き' }],
    }],
  }

  const result = await persistSongAnalysisResult({
    jobId: createSongAnalysisJobId(input),
    input,
    analysis,
    readSongIndex: async () => stored,
    writeSongIndex: async () => { writes += 1 },
  })

  assert.deepEqual(result, { persisted: false, reason: 'stale-lyrics' })
  assert.equal(writes, 0)
})
