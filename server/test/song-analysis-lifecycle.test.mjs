import assert from 'node:assert/strict'
import test from 'node:test'

import {
  prepareSongLearningGeneration,
  updateSongLearningGenerationStatus,
} from '../song-analysis-lifecycle.mjs'

const lyricLines = [{
  id: 'line-1',
  startMs: 100,
  endMs: 1200,
  ja: '君が好き',
  kana: '',
  romaji: '',
  zh: '我喜欢你',
  focusTermIds: [],
}]

function createSong(overrides = {}) {
  return {
    id: 'song-1',
    title: '曲名',
    artist: '歌手',
    lyricLines,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

test('creates a durable pending task without queueing during song persistence', () => {
  const prepared = prepareSongLearningGeneration({
    profileId: 'profile-a',
    song: createSong(),
    now: '2026-07-13T08:00:00.000Z',
  })

  assert.equal(prepared.input.profileId, 'profile-a')
  assert.equal(prepared.song.analysis.status, 'pending')
  assert.equal(prepared.song.analysis.jobId, prepared.jobId)
  assert.equal(prepared.song.analysis.updatedAt, '2026-07-13T08:00:00.000Z')
})

test('reuses the same task for unchanged lyrics instead of resetting it', () => {
  const first = prepareSongLearningGeneration({
    profileId: 'profile-a',
    song: createSong(),
    now: '2026-07-13T08:00:00.000Z',
  })
  const existingSong = {
    ...first.song,
    analysis: {
      ...first.song.analysis,
      status: 'queued',
      updatedAt: '2026-07-13T08:01:00.000Z',
    },
  }
  const second = prepareSongLearningGeneration({
    profileId: 'profile-a',
    song: createSong({ title: '修改后的标题' }),
    existingSong,
    now: '2026-07-13T08:02:00.000Z',
  })

  assert.equal(second.jobId, first.jobId)
  assert.deepEqual(second.song.analysis, existingSong.analysis)
})

test('updates a task only while its lyrics and job id are still current', async () => {
  const prepared = prepareSongLearningGeneration({
    profileId: 'profile-a',
    song: createSong(),
  })
  let stored = {
    version: 1,
    profileId: 'profile-a',
    songs: [prepared.song],
  }
  const dependencies = {
    readSongIndex: async () => stored,
    writeSongIndex: async (_profileId, next) => { stored = next },
  }

  const updated = await updateSongLearningGenerationStatus({
    profileId: 'profile-a',
    songId: 'song-1',
    jobId: prepared.jobId,
    lyricVersion: prepared.song.analysis.lyricVersion,
    status: 'queued',
    now: '2026-07-13T08:03:00.000Z',
    ...dependencies,
  })
  const stale = await updateSongLearningGenerationStatus({
    profileId: 'profile-a',
    songId: 'song-1',
    jobId: 'song-stale',
    lyricVersion: prepared.song.analysis.lyricVersion,
    status: 'failed',
    ...dependencies,
  })

  assert.equal(updated.updated, true)
  assert.equal(stored.songs[0].analysis.status, 'queued')
  assert.deepEqual(stale, { updated: false, reason: 'stale-task' })
})

test('backfills a recoverable task for a legacy song without analysis metadata', async () => {
  const prepared = prepareSongLearningGeneration({
    profileId: 'profile-a',
    song: createSong(),
  })
  let stored = {
    version: 1,
    profileId: 'profile-a',
    songs: [createSong()],
  }

  const result = await updateSongLearningGenerationStatus({
    profileId: 'profile-a',
    songId: 'song-1',
    jobId: prepared.jobId,
    lyricVersion: prepared.song.analysis.lyricVersion,
    status: 'queued',
    readSongIndex: async () => stored,
    writeSongIndex: async (_profileId, next) => { stored = next },
  })

  assert.equal(result.updated, true)
  assert.equal(stored.songs[0].analysis.jobId, prepared.jobId)
  assert.equal(stored.songs[0].analysis.status, 'queued')
})
