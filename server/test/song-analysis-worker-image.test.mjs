import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const runtimePackageUrl = new URL('../../worker/song-analysis/package.json', import.meta.url)
const dockerfileUrl = new URL('../../Dockerfile.song-analysis-worker', import.meta.url)

test('song analysis Worker image installs only its server runtime dependencies', async () => {
  const runtimePackage = JSON.parse(await readFile(runtimePackageUrl, 'utf8'))
  assert.deepEqual(runtimePackage.dependencies, {
    '@openai/codex': '0.144.1',
    bullmq: '5.65.1',
  })

  const dockerfile = await readFile(dockerfileUrl, 'utf8')
  assert.match(dockerfile, /COPY --chown=node:node worker\/song-analysis\/package\.json worker\/song-analysis\/pnpm-lock\.yaml \.\//u)
  assert.doesNotMatch(dockerfile, /COPY[^\n]*package\.json pnpm-lock\.yaml pnpm-workspace\.yaml/u)
})
