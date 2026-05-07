import { basename } from 'node:path'

const booleanFlags = new Set(['help', 'once', 'noAsr'])

export function parseArgs(argv) {
  const positional = []
  const flags = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }

    const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s)
    if (booleanFlags.has(rawKey)) {
      flags[rawKey] = true
      continue
    }

    if (inlineValue !== undefined) {
      flags[rawKey] = inlineValue
      continue
    }

    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      flags[rawKey] = ''
      continue
    }

    flags[rawKey] = next
    index += 1
  }

  return {
    command: positional[0] ?? '',
    positional: positional.slice(1),
    flags,
  }
}

export function readNumberFlag(flags, name, fallback) {
  const value = Number(flags[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function readStringFlag(flags, name, fallback = '') {
  const value = flags[name]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function slugify(input) {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/giu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return normalized || `slice-${Date.now()}`
}

export function titleFromInput(inputPath) {
  return basename(inputPath).replace(/\.[^.]+$/, '')
}
