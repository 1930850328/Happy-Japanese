import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const slicerCli = resolve(appDir, 'packages', 'anime-learning-slicer', 'src', 'cli.mjs')

async function pathExists(pathValue) {
  try {
    await access(pathValue, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function run(command, args, workdir) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: workdir,
      stdio: 'inherit',
      shell: false,
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

async function main() {
  if (!(await pathExists(slicerCli))) {
    throw new Error(`anime-learning-slicer workspace package was not found: ${slicerCli}`)
  }

  const extraArgs = process.argv.slice(2)
  await run(process.execPath, [slicerCli, 'ingest', ...extraArgs, '--app', appDir], appDir)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
