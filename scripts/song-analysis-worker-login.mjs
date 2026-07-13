import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const CODEX_ENTRY = fileURLToPath(new URL('../node_modules/@openai/codex/bin/codex.js', import.meta.url))

const login = spawn(process.execPath, [CODEX_ENTRY, 'login', '--device-auth'], {
  env: process.env,
  stdio: 'inherit',
})

const exitCode = await new Promise((resolve) => login.once('exit', resolve))
if (exitCode !== 0) {
  console.error(`[song-analysis-worker] Codex device login failed with exit code ${exitCode}`)
  process.exit(exitCode || 1)
}

console.log('[song-analysis-worker] Codex device login completed; starting Worker without restarting the instance')
await import('./song-analysis-worker.mjs')
