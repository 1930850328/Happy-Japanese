import { mkdir, readFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'

import chokidar from 'chokidar'

import { ingestVideo } from './ingest.mjs'
import { slugify, titleFromInput } from './args.mjs'

const videoExtensions = new Set(['.mp4', '.mkv', '.mov', '.webm', '.avi'])

async function readMetadata(inputPath) {
  const metadataPath = inputPath.replace(/\.[^.]+$/, '.json')
  try {
    const raw = await readFile(metadataPath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function waitForStableFile(pathValue) {
  await new Promise((resolvePromise) => {
    setTimeout(resolvePromise, 1200)
  })
  return pathValue
}

export async function watchInbox(options) {
  const inbox = resolve(options.inbox)
  await mkdir(inbox, { recursive: true })

  const run = async (inputPath) => {
    const metadata = await readMetadata(inputPath)
    const animeTitle = metadata.animeTitle || options.animeTitle || titleFromInput(inputPath)
    const slug = metadata.publishedSlug || slugify(`${animeTitle}-${metadata.episodeTitle ?? basename(inputPath)}`)

    console.log(`[slicer] ingesting ${inputPath}`)
    const result = await ingestVideo({
      ...options,
      inputPath,
      animeTitle,
      episodeTitle: metadata.episodeTitle || options.episodeTitle,
      slug,
      minClips: metadata.minClips ?? options.minClips,
      maxClips: metadata.maxClips ?? options.maxClips,
      minDurationSec: metadata.minDurationSec ?? options.minDurationSec,
      maxDurationSec: metadata.maxDurationSec ?? options.maxDurationSec,
      targetDurationSec: metadata.targetDurationSec ?? options.targetDurationSec,
    })
    console.log(`[slicer] generated ${result.clipCount} clip(s): ${result.manifestPath}`)
  }

  const watcher = chokidar.watch(inbox, {
    ignoreInitial: false,
    depth: 0,
    awaitWriteFinish: {
      stabilityThreshold: 1600,
      pollInterval: 300,
    },
  })

  watcher.on('add', async (pathValue) => {
    if (!videoExtensions.has(extname(pathValue).toLowerCase())) {
      return
    }

    try {
      await run(await waitForStableFile(pathValue))
    } catch (error) {
      console.error(`[slicer] failed ${basename(pathValue)}:`, error instanceof Error ? error.message : error)
    }
  })

  console.log(`[slicer] watching ${inbox}`)

  if (options.once) {
    const closeWhenReady = () => {
      void watcher.close()
    }
    watcher.on('ready', closeWhenReady)
  }

  return watcher
}

export function defaultInbox(appDir) {
  return resolve(appDir, 'inbox')
}
