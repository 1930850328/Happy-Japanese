import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSongAnalysisJobId,
  isSongAnalysisJobId,
  normalizeSongAnalysisInput,
  SongAnalysisInputError,
} from '../song-analysis-contract.mjs'

const input = {
  songId: 'song-1',
  title: '曲名',
  artist: '歌手',
  lyricLines: [
    {
      id: 'line-1',
      ja: '君が好き',
      zh: '我喜欢你',
      startMs: 100,
      endMs: 1200,
      wordTimings: [{ text: '君', startMs: 100, endMs: 300 }],
    },
  ],
}

test('normalizes a valid song analysis payload', () => {
  assert.deepEqual(normalizeSongAnalysisInput(input), {
    version: 1,
    ...input,
  })
})

test('creates a deterministic content-addressed job id', () => {
  const first = createSongAnalysisJobId(input)
  const second = createSongAnalysisJobId({ ...input, title: '另一个标题', artist: '另一个歌手' })
  assert.equal(first, second)
  assert.equal(isSongAnalysisJobId(first), true)
  assert.equal(isSongAnalysisJobId('song-invalid'), false)
})

test('separates jobs by profile while keeping the same song id', () => {
  const first = createSongAnalysisJobId({ ...input, profileId: 'profile-a' })
  const second = createSongAnalysisJobId({ ...input, profileId: 'profile-b' })
  assert.notEqual(first, second)
})

test('rejects incomplete lyric lines before queueing', () => {
  assert.throws(
    () => normalizeSongAnalysisInput({ ...input, lyricLines: [{ id: 'line-1', ja: '' }] }),
    SongAnalysisInputError,
  )
})
