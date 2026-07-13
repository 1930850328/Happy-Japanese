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
    { id: 'line-1', ja: '君が好き', zh: '我喜欢你' },
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
  const second = createSongAnalysisJobId({ ...input, title: '  曲名  ' })
  assert.equal(first, second)
  assert.equal(isSongAnalysisJobId(first), true)
  assert.equal(isSongAnalysisJobId('song-invalid'), false)
})

test('rejects incomplete lyric lines before queueing', () => {
  assert.throws(
    () => normalizeSongAnalysisInput({ ...input, lyricLines: [{ id: 'line-1', ja: '' }] }),
    SongAnalysisInputError,
  )
})
