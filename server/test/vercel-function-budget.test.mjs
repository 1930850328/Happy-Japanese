import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import test from 'node:test'

const HOBBY_FUNCTION_LIMIT = 12
const API_DIRECTORY = new URL('../../api/', import.meta.url)

test('keeps Vercel API entrypoints within the Hobby plan function budget', async () => {
  const entries = await readdir(API_DIRECTORY, { withFileTypes: true })
  const functionEntrypoints = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort()

  assert.ok(
    functionEntrypoints.length <= HOBBY_FUNCTION_LIMIT,
    `Vercel Hobby supports at most ${HOBBY_FUNCTION_LIMIT} functions, found ${functionEntrypoints.length}: ${functionEntrypoints.join(', ')}`,
  )
})
