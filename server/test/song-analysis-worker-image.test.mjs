import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { bootstrapCodexAuth } from '../../scripts/song-analysis-worker-bootstrap.mjs'

const runtimePackageUrl = new URL('../../worker/song-analysis/package.json', import.meta.url)
const dockerfileUrl = new URL('../../Dockerfile.song-analysis-worker', import.meta.url)
const skillUrl = new URL('../../.agents/skills/generate-song-learning-info/SKILL.md', import.meta.url)
const analyzerUrl = new URL('../codex-song-analyzer.mjs', import.meta.url)

test('song analysis Worker image installs only its server runtime dependencies', async () => {
  const runtimePackage = JSON.parse(await readFile(runtimePackageUrl, 'utf8'))
  assert.deepEqual(runtimePackage.dependencies, {
    '@openai/codex': '0.144.1',
    bullmq: '5.65.1',
    wanakana: '5.3.1',
  })

  const dockerfile = await readFile(dockerfileUrl, 'utf8')
  assert.match(dockerfile, /apt-get install -y --no-install-recommends ca-certificates/u)
  assert.match(dockerfile, /COPY --chown=node:node worker\/song-analysis\/package\.json worker\/song-analysis\/pnpm-lock\.yaml \.\//u)
  assert.match(dockerfile, /COPY --chown=node:node scripts\/song-analysis-worker\*\.mjs \.\/scripts\//u)
  assert.match(dockerfile, /COPY --chown=node:node \.agents\/skills\/generate-song-learning-info \.\/\.agents\/skills\/generate-song-learning-info/u)
  assert.doesNotMatch(dockerfile, /COPY[^\n]*package\.json pnpm-lock\.yaml pnpm-workspace\.yaml/u)
  assert.match(dockerfile, /CMD \["node", "scripts\/song-analysis-worker-bootstrap\.mjs"\]/u)

  const skill = await readFile(skillUrl, 'utf8')
  assert.match(skill, /^name: generate-song-learning-info$/mu)
  assert.match(skill, /简体中文/u)

  const analyzer = await readFile(analyzerUrl, 'utf8')
  assert.match(analyzer, /\$generate-song-learning-info/u)
  assert.doesNotMatch(analyzer, /你是一名严谨的日语教师/u)
})

test('song analysis Worker synchronizes rotated Codex auth onto persistent storage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'song-worker-auth-'))
  const codexHome = join(root, 'codex')
  const secretPath = join(root, 'secret.json')
  await writeFile(secretPath, '{"auth_mode":"chatgpt"}')

  assert.equal(await bootstrapCodexAuth({ codexHome, secretPath }), true)
  assert.equal(await readFile(join(codexHome, 'auth.json'), 'utf8'), '{"auth_mode":"chatgpt"}')
  assert.equal((await stat(join(codexHome, 'auth.json'))).mode & 0o777, 0o600)

  await writeFile(secretPath, '{"auth_mode":"changed"}')
  assert.equal(await bootstrapCodexAuth({ codexHome, secretPath }), true)
  assert.equal(await readFile(join(codexHome, 'auth.json'), 'utf8'), '{"auth_mode":"changed"}')
})
