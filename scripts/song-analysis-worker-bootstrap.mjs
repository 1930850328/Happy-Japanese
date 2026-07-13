import { chmod, copyFile, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DEFAULT_SECRET_PATH = '/etc/secrets/codex-auth.json'

export async function bootstrapCodexAuth({
  codexHome = process.env.CODEX_HOME,
  secretPath = DEFAULT_SECRET_PATH,
} = {}) {
  if (!codexHome) return false

  try {
    await mkdir(codexHome, { recursive: true })
    await copyFile(secretPath, `${codexHome}/auth.json`, constants.COPYFILE_EXCL)
    await chmod(`${codexHome}/auth.json`, 0o600)
    console.log('[song-analysis-worker] initialized Codex authentication on persistent storage')
    return true
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'ENOENT') return false
    throw error
  }
}

const isMain = fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  await bootstrapCodexAuth()
  await import('./song-analysis-worker.mjs')
}
