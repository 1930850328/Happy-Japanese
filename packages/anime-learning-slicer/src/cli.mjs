#!/usr/bin/env node

import { resolve } from 'node:path'

import { parseArgs, readNumberFlag, readStringFlag, slugify, titleFromInput } from './args.mjs'
import { ingestVideo } from './ingest.mjs'
import { defaultInbox, watchInbox } from './watch.mjs'

function printHelp() {
  console.log(`anime-learning-slicer

Usage:
  anime-learning-slicer ingest --input <video> --app <Happy-Japanese> [options]
  anime-learning-slicer watch-inbox --app <Happy-Japanese> [--inbox <dir>]

Options:
  --input <path>              Source video for one-shot ingest
  --subtitle <path>           Optional sidecar subtitle; otherwise same-name or embedded subtitle is used
  --asrModel <model>          Transformers.js Whisper model used when no subtitle track exists
  --noAsr                     Fail instead of running ASR when no subtitle track exists
  --anime <title>             Anime/title label; defaults to file name
  --episode <title>           Optional episode label
  --publishedSlug <slug>      Output slug under public/generated-slices
  --app <dir>                 Happy-Japanese app directory
  --output <dir>              Optional output directory override
  --minClips <n>              Minimum accepted clips, default 1
  --maxClips <n>              Maximum accepted clips, default 8
  --minDurationSec <n>        Minimum clip duration, default 8
  --targetDurationSec <n>     Preferred clip duration, default 18
  --maxDurationSec <n>        Maximum clip duration, default 42
`)
}

function buildOptions(flags) {
  const inputPath = readStringFlag(flags, 'input')
  const appDir = readStringFlag(flags, 'app', process.cwd())
  const animeTitle = readStringFlag(flags, 'anime', inputPath ? titleFromInput(inputPath) : '')
  const episodeTitle = readStringFlag(flags, 'episode')
  const slug = readStringFlag(
    flags,
    'publishedSlug',
    slugify([animeTitle, episodeTitle].filter(Boolean).join('-') || titleFromInput(inputPath)),
  )

  return {
    inputPath,
    appDir,
    animeTitle,
    episodeTitle,
    slug,
    subtitlePath: readStringFlag(flags, 'subtitle'),
    asrModel: readStringFlag(flags, 'asrModel'),
    noAsr: flags.noAsr === true,
    outputDir: readStringFlag(flags, 'output'),
    minClips: readNumberFlag(flags, 'minClips', 1),
    maxClips: readNumberFlag(flags, 'maxClips', 8),
    minDurationSec: readNumberFlag(flags, 'minDurationSec', 8),
    targetDurationSec: readNumberFlag(flags, 'targetDurationSec', 18),
    maxDurationSec: readNumberFlag(flags, 'maxDurationSec', 42),
  }
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2))

  if (!command || flags.help || command === 'help') {
    printHelp()
    return
  }

  if (command === 'ingest') {
    const options = buildOptions(flags)
    if (!options.inputPath) {
      throw new Error('--input is required for ingest.')
    }

    const result = await ingestVideo(options)
    console.log(`Generated ${result.clipCount} clip(s).`)
    console.log(`Manifest: ${result.manifestPath}`)
    console.log(`Report: ${result.reportPath}`)
    return
  }

  if (command === 'watch-inbox') {
    const appDir = resolve(readStringFlag(flags, 'app', process.cwd()))
    await watchInbox({
      ...buildOptions(flags),
      appDir,
      inbox: readStringFlag(flags, 'inbox', defaultInbox(appDir)),
      once: flags.once === true,
    })
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
