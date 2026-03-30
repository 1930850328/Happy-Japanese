import { access } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const slicerDir = resolve(appDir, '..', 'anime-learning-slicer')
const defaultInbox = resolve(slicerDir, 'inbox')

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
    const invocation =
      process.platform === 'win32' && command === 'npm'
        ? {
            command: 'cmd.exe',
            args: ['/d', '/s', '/c', ['npm', ...args].join(' ')],
          }
        : {
            command,
            args,
          }

    const child = spawn(invocation.command, invocation.args, {
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
  if (!(await pathExists(slicerDir))) {
    throw new Error(`anime-learning-slicer repo was not found next to this app: ${slicerDir}`)
  }

  const extraArgs = process.argv.slice(2)
  await run('npm', ['run', 'build'], slicerDir)
  await run(
    'node',
    ['dist/cli.js', 'watch-inbox', '--app', appDir, '--inbox', defaultInbox, ...extraArgs],
    slicerDir,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
