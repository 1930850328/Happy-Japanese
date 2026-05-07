import type { KnowledgePoint, TranscriptSegment } from '../types'

export type SlicerManifestVersion = 1 | 2

export interface SlicerManifestPipeline {
  engine?: string
  engineVersion?: string
  asr?: string
  alignment?: string
  sceneDetector?: string
  nlp?: string
}

export interface SlicerManifestClipQuality {
  asrConfidence?: number | null
  alignmentConfidence?: number | null
  ocrConfidence?: number | null
  sceneBoundaryStart?: boolean
  sceneBoundaryEnd?: boolean
  speechBoundaryStart?: boolean
  speechBoundaryEnd?: boolean
  needsReview: boolean
  warnings: string[]
}

export interface SlicerManifestClip {
  id: string
  clipTitle: string
  startMs: number
  endMs: number
  durationMs: number
  videoPath: string
  coverPath?: string
  subtitlePath?: string
  metadataPath?: string
  transcriptJa: string
  transcriptZh: string
  subtitleSource?: 'external' | 'auto'
  exampleJa: string
  exampleZh: string
  keyNotes: string[]
  keywords: string[]
  knowledgePoints: KnowledgePoint[]
  segments: TranscriptSegment[]
  quality?: SlicerManifestClipQuality
  qualityWarnings: string[]
  needsReview: boolean
}

export interface SlicerManifestData {
  version: SlicerManifestVersion
  animeTitle: string
  episodeTitle?: string
  sourceVideo?: string
  subtitleSource?: 'external' | 'auto'
  generatedAt?: string
  pipeline?: SlicerManifestPipeline
  clipCount?: number
  clips: SlicerManifestClip[]
}

export interface SlicerManifestClipV2 extends SlicerManifestClip {
  subtitlePath: string
  quality: SlicerManifestClipQuality
}

export interface SlicerManifestDataV2 extends SlicerManifestData {
  version: 2
  sourceVideo: string
  generatedAt: string
  pipeline: SlicerManifestPipeline
  clips: SlicerManifestClipV2[]
}

function basenameFromPath(input: string) {
  return input.split(/[/\\]/).pop() ?? input
}

function normalizeFileKey(input: string) {
  return basenameFromPath(input).trim().toLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function readString(item: Record<string, unknown>, key: string) {
  const value = item[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function readStringArray(item: Record<string, unknown>, key: string) {
  const value = item[key]
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
}

function readNullableConfidence(item: Record<string, unknown>, key: string): number | null | undefined {
  const value = item[key]
  if (isFiniteNumber(value)) {
    return value
  }
  if (value === null) {
    return null
  }

  return undefined
}

function normalizeSegment(value: unknown): TranscriptSegment | null {
  if (!isRecord(value)) {
    return null
  }

  const ja = readString(value, 'ja') ?? readString(value, 'jaText')
  const zh = readString(value, 'zh') ?? readString(value, 'zhText')
  const startMs = value.startMs
  const endMs = value.endMs

  if (!isFiniteNumber(startMs) || !isFiniteNumber(endMs) || !ja || !zh) {
    return null
  }

  return {
    startMs,
    endMs,
    ja,
    kana: typeof value.kana === 'string' ? value.kana : '',
    romaji: typeof value.romaji === 'string' ? value.romaji : '',
    zh,
    focusTermIds: readStringArray(value, 'focusTermIds'),
  }
}

function normalizeKnowledgePoint(value: unknown): KnowledgePoint | null {
  if (!isRecord(value)) {
    return null
  }

  const id = readString(value, 'id')
  const expression = readString(value, 'expression')
  const kind = value.kind

  if (!id || !expression || (kind !== 'word' && kind !== 'grammar' && kind !== 'phrase')) {
    return null
  }

  return {
    id,
    kind,
    expression,
    reading: readString(value, 'reading') ?? '',
    meaningZh: readString(value, 'meaningZh') ?? '',
    partOfSpeech: readString(value, 'partOfSpeech') ?? '',
    explanationZh: readString(value, 'explanationZh') ?? '',
    exampleJa: readString(value, 'exampleJa') ?? '',
    exampleZh: readString(value, 'exampleZh') ?? '',
  }
}

function normalizePipeline(value: unknown) {
  if (!isRecord(value)) {
    return undefined
  }

  return {
    engine: readString(value, 'engine'),
    engineVersion: readString(value, 'engineVersion'),
    asr: readString(value, 'asr'),
    alignment: readString(value, 'alignment'),
    sceneDetector: readString(value, 'sceneDetector'),
    nlp: readString(value, 'nlp'),
  }
}

function normalizeQuality(value: unknown): SlicerManifestClipQuality | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const warnings = readStringArray(value, 'warnings')

  return {
    asrConfidence: readNullableConfidence(value, 'asrConfidence'),
    alignmentConfidence: readNullableConfidence(value, 'alignmentConfidence'),
    ocrConfidence: readNullableConfidence(value, 'ocrConfidence'),
    sceneBoundaryStart:
      typeof value.sceneBoundaryStart === 'boolean' ? value.sceneBoundaryStart : undefined,
    sceneBoundaryEnd:
      typeof value.sceneBoundaryEnd === 'boolean' ? value.sceneBoundaryEnd : undefined,
    speechBoundaryStart:
      typeof value.speechBoundaryStart === 'boolean' ? value.speechBoundaryStart : undefined,
    speechBoundaryEnd:
      typeof value.speechBoundaryEnd === 'boolean' ? value.speechBoundaryEnd : undefined,
    needsReview: value.needsReview === true,
    warnings,
  }
}

function validateSegmentTiming(
  segments: TranscriptSegment[],
  durationMs: number,
  clipPath: string,
) {
  const errors: string[] = []

  segments.forEach((segment, index) => {
    if (segment.startMs < 0) {
      errors.push(`${clipPath}.segments[${index}].startMs must not be negative.`)
    }
    if (segment.endMs <= segment.startMs) {
      errors.push(`${clipPath}.segments[${index}].endMs must be greater than startMs.`)
    }
    if (durationMs > 0 && segment.endMs > durationMs + 1000) {
      errors.push(`${clipPath}.segments[${index}].endMs must not exceed durationMs by more than 1000ms.`)
    }
  })

  return errors
}

interface NormalizeClipResult {
  clip: SlicerManifestClip | null
  errors: string[]
}

function normalizeClip(
  value: unknown,
  index: number,
  version: SlicerManifestVersion,
): NormalizeClipResult {
  const path = `clips[${index}]`
  const errors: string[] = []

  if (!isRecord(value)) {
    return { clip: null, errors: [`${path} must be an object.`] }
  }

  const id = readString(value, 'id')
  const clipTitle = readString(value, 'clipTitle')
  const startMs = value.startMs
  const endMs = value.endMs
  const durationMs = value.durationMs
  const videoPath = readString(value, 'videoPath')
  const subtitlePath = readString(value, 'subtitlePath')
  const quality = normalizeQuality(value.quality)
  const segments = Array.isArray(value.segments)
    ? value.segments
        .map(normalizeSegment)
        .filter((segment): segment is TranscriptSegment => Boolean(segment))
    : []
  const knowledgePoints = Array.isArray(value.knowledgePoints)
    ? value.knowledgePoints
        .map(normalizeKnowledgePoint)
        .filter((point): point is KnowledgePoint => Boolean(point))
    : []

  if (!id) {
    errors.push(`${path}.id is required.`)
  }
  if (!clipTitle) {
    errors.push(`${path}.clipTitle is required.`)
  }
  if (!videoPath) {
    errors.push(`${path}.videoPath is required.`)
  }
  if (segments.length === 0) {
    errors.push(`${path}.segments must include at least one valid segment.`)
  }

  if (version === 2) {
    if (!isFiniteNumber(startMs)) {
      errors.push(`${path}.startMs must be a number.`)
    }
    if (!isFiniteNumber(endMs)) {
      errors.push(`${path}.endMs must be a number.`)
    }
    if (!isFiniteNumber(durationMs)) {
      errors.push(`${path}.durationMs must be a number.`)
    }
    if (!subtitlePath) {
      errors.push(`${path}.subtitlePath is required for manifest v2.`)
    }
    if (!quality) {
      errors.push(`${path}.quality is required for manifest v2.`)
    }
  }

  const normalizedDurationMs = isFiniteNumber(durationMs) ? durationMs : 0
  if (version === 2) {
    errors.push(...validateSegmentTiming(segments, normalizedDurationMs, path))
  }

  if (errors.length > 0) {
    return { clip: null, errors }
  }

  const transcriptJa = readString(value, 'transcriptJa') ?? segments.map((segment) => segment.ja).join(' ')
  const transcriptZh = readString(value, 'transcriptZh') ?? segments.map((segment) => segment.zh).join(' ')
  const qualityWarnings = quality?.warnings ?? []
  const needsReview = quality?.needsReview === true || qualityWarnings.length > 0

  return {
    clip: {
      id: id ?? '',
      clipTitle: clipTitle ?? '',
      startMs: isFiniteNumber(startMs) ? startMs : 0,
      endMs: isFiniteNumber(endMs) ? endMs : 0,
      durationMs: normalizedDurationMs,
      videoPath: videoPath ?? '',
      coverPath: readString(value, 'coverPath'),
      subtitlePath,
      metadataPath: readString(value, 'metadataPath'),
      transcriptJa,
      transcriptZh,
      subtitleSource:
        value.subtitleSource === 'external' || value.subtitleSource === 'auto'
          ? value.subtitleSource
          : undefined,
      exampleJa: readString(value, 'exampleJa') ?? segments[0].ja,
      exampleZh: readString(value, 'exampleZh') ?? segments[0].zh,
      keyNotes: readStringArray(value, 'keyNotes'),
      keywords: readStringArray(value, 'keywords'),
      knowledgePoints,
      segments,
      quality,
      qualityWarnings,
      needsReview,
    },
    errors: [],
  }
}

export function parseSlicerManifestData(input: unknown): SlicerManifestData {
  if (!isRecord(input)) {
    throw new Error('Invalid slicer manifest: root must be a JSON object.')
  }

  const errors: string[] = []
  const rawVersion = input.version
  const version: SlicerManifestVersion = rawVersion === 2 ? 2 : 1
  const animeTitle = readString(input, 'animeTitle')
  const pipeline = normalizePipeline(input.pipeline)

  if (rawVersion !== undefined && rawVersion !== 1 && rawVersion !== 2) {
    errors.push('version must be 1 or 2.')
  }
  if (!animeTitle) {
    errors.push('animeTitle is required.')
  }
  if (!Array.isArray(input.clips)) {
    errors.push('clips must be an array.')
  }
  if (version === 2) {
    if (!readString(input, 'sourceVideo')) {
      errors.push('sourceVideo is required for manifest v2.')
    }
    if (!readString(input, 'generatedAt')) {
      errors.push('generatedAt is required for manifest v2.')
    }
    if (!pipeline) {
      errors.push('pipeline is required for manifest v2.')
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid slicer manifest:\n- ${errors.join('\n- ')}`)
  }

  const clipResults = (input.clips as unknown[]).map((clip, index) =>
    normalizeClip(clip, index, version),
  )
  const clipErrors = clipResults.flatMap((result) => result.errors)
  const clips = clipResults
    .map((result) => result.clip)
    .filter((clip): clip is SlicerManifestClip => Boolean(clip))

  if (clipErrors.length > 0) {
    throw new Error(`Invalid slicer manifest clips:\n- ${clipErrors.join('\n- ')}`)
  }
  if (clips.length === 0) {
    throw new Error('Slicer manifest does not contain any importable clips.')
  }

  return {
    version,
    animeTitle: animeTitle ?? '',
    episodeTitle: readString(input, 'episodeTitle'),
    sourceVideo: readString(input, 'sourceVideo'),
    subtitleSource:
      input.subtitleSource === 'external' || input.subtitleSource === 'auto'
        ? input.subtitleSource
        : undefined,
    generatedAt: readString(input, 'generatedAt'),
    pipeline,
    clipCount: isFiniteNumber(input.clipCount) ? input.clipCount : undefined,
    clips,
  }
}

export async function parseSlicerManifest(file: File): Promise<SlicerManifestData> {
  let raw: unknown

  try {
    raw = JSON.parse(await file.text())
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Slicer manifest is not valid JSON: ${error.message}`
        : 'Slicer manifest is not valid JSON.',
    )
  }

  return parseSlicerManifestData(raw)
}

export function buildManifestClipFileMap(files: File[]) {
  return files.reduce<Record<string, File>>((acc, file) => {
    acc[normalizeFileKey(file.name)] = file
    return acc
  }, {})
}

export function getManifestClipFileName(clip: SlicerManifestClip) {
  return basenameFromPath(clip.videoPath)
}

export function getManifestQualityTags(clip: SlicerManifestClip) {
  return [
    clip.needsReview ? '需要复核' : undefined,
    ...clip.qualityWarnings.map((warning) => `切片警告: ${warning}`),
  ].filter((tag): tag is string => Boolean(tag))
}

export function getManifestSubtitleSource(
  manifest: SlicerManifestData,
  clip: SlicerManifestClip,
): 'manual' | 'auto' | undefined {
  const source = clip.subtitleSource ?? manifest.subtitleSource
  if (source === 'external') {
    return 'manual'
  }
  if (source === 'auto') {
    return 'auto'
  }
  return undefined
}
