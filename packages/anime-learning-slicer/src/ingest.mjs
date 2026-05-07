import { rm } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import { buildStudyData } from './nlp.mjs'
import { makeOutputLayout, ensureLayout, joinOutput, publicPath, updateGeneratedIndex, writeJson } from './output.mjs'
import { captureCover, cutClip, detectSilences, extractFirstSubtitle, probeVideo } from './media.mjs'
import { findSidecarSubtitle, readSubtitleCues, writeClipSubtitle } from './subtitles.mjs'
import { selectClipWindows } from './scoring.mjs'
import { transcribeVideoToCues } from './transcript.mjs'

function cuesForWindow(cues, startMs, endMs) {
  return cues.filter((cue) => cue.startMs < endMs && cue.endMs > startMs)
}

function buildClipTitle(animeTitle, window, index) {
  return `${animeTitle} - ${window.titleSuffix || `切片 ${index + 1}`}`
}

function normalizeOptions(options) {
  return {
    ...options,
    inputPath: resolve(options.inputPath),
    appDir: resolve(options.appDir ?? process.cwd()),
    minDurationMs: Math.round((options.minDurationSec ?? 8) * 1000),
    maxDurationMs: Math.round((options.maxDurationSec ?? 42) * 1000),
    targetDurationMs: Math.round((options.targetDurationSec ?? 18) * 1000),
    maxClips: options.maxClips ?? 8,
    minClips: options.minClips ?? 1,
    noAsr: options.noAsr === true,
    asrModel: options.asrModel,
  }
}

export async function ingestVideo(rawOptions) {
  const options = normalizeOptions(rawOptions)
  const animeTitle = options.animeTitle || basename(options.inputPath).replace(/\.[^.]+$/, '')
  const slug = options.slug
  const layout = makeOutputLayout({
    appDir: options.appDir,
    slug,
    outputDir: options.outputDir,
  })

  await rm(layout.root, { recursive: true, force: true })
  await ensureLayout(layout)

  const probe = await probeVideo(options.inputPath)
  const sidecarSubtitle = options.subtitlePath
    ? resolve(options.subtitlePath)
    : await findSidecarSubtitle(options.inputPath)
  const embeddedSubtitle = sidecarSubtitle
    ? null
    : await extractFirstSubtitle(options.inputPath, joinOutput(layout.metadataDir, 'source.vtt'))
  let subtitlePath = sidecarSubtitle ?? embeddedSubtitle
  let cues = []
  let asrModelUsed = ''

  if (subtitlePath) {
    cues = await readSubtitleCues(subtitlePath)
  } else if (options.noAsr) {
    throw new Error(
      'No subtitle stream was found and --noAsr was provided, so the slicer cannot produce timed Japanese subtitles.',
    )
  } else {
    const asrResult = await transcribeVideoToCues({
      inputPath: options.inputPath,
      outputPath: joinOutput(layout.metadataDir, 'source-asr.vtt'),
      durationMs: probe.durationMs,
      modelId: options.asrModel,
    })
    cues = asrResult.cues
    subtitlePath = asrResult.subtitlePath
    asrModelUsed = asrResult.modelUsed
  }

  if (cues.length === 0) {
    throw new Error(`No usable subtitle cues were parsed from: ${subtitlePath}`)
  }

  const subtitleSource = sidecarSubtitle ? 'external' : 'auto'
  const subtitleProvider = sidecarSubtitle ? 'external-subtitle' : embeddedSubtitle ? 'embedded-subtitle' : 'asr'

  const studyData = await buildStudyData(cues)
  const silences = await detectSilences(options.inputPath)
  const windows = selectClipWindows({
    slug,
    segments: studyData.segments,
    knowledgePoints: studyData.knowledgePoints,
    silences,
    minDurationMs: options.minDurationMs,
    maxDurationMs: options.maxDurationMs,
    targetDurationMs: options.targetDurationMs,
    maxClips: options.maxClips,
  })

  if (windows.length < options.minClips) {
    throw new Error(`Only ${windows.length} clip(s) passed scoring; expected at least ${options.minClips}.`)
  }

  const clips = []

  for (const [index, window] of windows.entries()) {
    const clipTitle = buildClipTitle(animeTitle, window, index)
    const clipFile = joinOutput(layout.clipsDir, `${window.id}.mp4`)
    const coverFile = joinOutput(layout.coversDir, `${window.id}.jpg`)
    const subtitleFile = joinOutput(layout.subtitlesDir, `${window.id}.vtt`)
    const metadataFile = joinOutput(layout.metadataDir, `${window.id}.json`)
    const windowCues = cuesForWindow(cues, window.startMs, window.endMs)

    await cutClip({
      inputPath: options.inputPath,
      outputPath: clipFile,
      startMs: window.startMs,
      durationMs: window.durationMs,
    })
    await captureCover({
      inputPath: options.inputPath,
      outputPath: coverFile,
      atMs: window.startMs + Math.min(1500, Math.max(300, window.durationMs / 2)),
    })
    await writeClipSubtitle(subtitleFile, windowCues, window.startMs)

    const clip = {
      id: window.id,
      clipTitle,
      startMs: window.startMs,
      endMs: window.endMs,
      durationMs: window.durationMs,
      videoPath: publicPath(clipFile, layout.publicRoot),
      coverPath: publicPath(coverFile, layout.publicRoot),
      subtitlePath: publicPath(subtitleFile, layout.publicRoot),
      metadataPath: publicPath(metadataFile, layout.publicRoot),
      transcriptJa: window.segments.map((segment) => segment.ja).join(' '),
      transcriptZh: window.segments.map((segment) => segment.zh).join(' '),
      subtitleSource,
      exampleJa: window.segments[0]?.ja ?? '',
      exampleZh: window.segments[0]?.zh ?? '',
      keyNotes: window.keyNotes,
      keywords: window.keywords,
      knowledgePoints: window.knowledgePoints,
      segments: window.segments,
      quality: {
        asrConfidence: null,
        alignmentConfidence: subtitleProvider === 'asr' ? null : 0.9,
        ocrConfidence: null,
        sceneBoundaryStart: false,
        sceneBoundaryEnd: false,
        speechBoundaryStart: true,
        speechBoundaryEnd: true,
        needsReview: false,
        warnings: [],
      },
    }

    await writeJson(metadataFile, clip)
    clips.push(clip)
  }

  const manifest = {
    version: 2,
    animeTitle,
    episodeTitle: options.episodeTitle,
    sourceVideo: basename(options.inputPath),
    subtitleSource,
    generatedAt: new Date().toISOString(),
    pipeline: {
      engine: 'anime-learning-slicer',
      engineVersion: '0.1.0',
      asr: subtitleProvider === 'asr' ? asrModelUsed : subtitleProvider,
      alignment: 'subtitle-timing',
      sceneDetector: 'ffmpeg-silencedetect',
      nlp: 'kuromoji+wanakana',
    },
    clipCount: clips.length,
    clips,
  }

  const report = {
    sourceVideo: basename(options.inputPath),
    subtitlePath: basename(subtitlePath),
    subtitleProvider,
    asrModel: asrModelUsed || undefined,
    durationMs: probe.durationMs,
    acceptedClipCount: clips.length,
    cueCount: cues.length,
    segmentCount: studyData.segments.length,
    knowledgePointCount: studyData.knowledgePoints.length,
    silenceEventCount: silences.length,
    generatedAt: manifest.generatedAt,
  }

  await writeJson(layout.manifestPath, manifest)
  await writeJson(layout.reportPath, report)
  await updateGeneratedIndex(layout, {
    slug,
    animeTitle,
    episodeTitle: options.episodeTitle,
    manifestPath: publicPath(layout.manifestPath, layout.publicRoot),
    generatedAt: manifest.generatedAt,
    clipCount: clips.length,
  })

  return {
    manifestPath: layout.manifestPath,
    reportPath: layout.reportPath,
    clipCount: clips.length,
  }
}
