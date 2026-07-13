import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const songAssetsUrl = new URL('../../api/song-assets.mjs', import.meta.url)

test('song persistence records a pending generation task without touching BullMQ', async () => {
  const source = await readFile(songAssetsUrl, 'utf8')

  assert.doesNotMatch(source, /createSongAnalysisQueue|enqueueSongAnalysis/u)
  assert.match(source, /prepareSongLearningGeneration/u)
})
