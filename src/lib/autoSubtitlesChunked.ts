import type { FFmpeg } from '@ffmpeg/ffmpeg'

import type { KnowledgePoint, TranscriptSegment } from '../types'
import { getSharedFFmpeg } from './ffmpegRuntime'
import { enrichCuesWithHardSubtitles } from './hardSubtitleOcr'
import {
  applySubtitleEntityCorrectionsToCues,
  buildSubtitleEntityContext,
} from './subtitleEntityContext'
import { buildStudyDataFromCues, parseSubtitleText, type SubtitleCue } from './subtitles'

interface SubtitleGenerationResult {
  segments: TranscriptSegment[]
  knowledgePoints: KnowledgePoint[]
  modelLabel: string
  usedFallback: false
}

interface TranscriberChunk {
  text?: string
  timestamp?: [number, number]
}

interface TranscriberOutput {
  text?: string
  chunks?: TranscriberChunk[]
}

interface TranscriberOptions {
  [key: string]: unknown
  return_timestamps: true
  chunk_length_s: number
  stride_length_s: number
  force_full_sequences: boolean
  language: string
  task: string
}

interface LoadedTranscriber {
  transcriber: (audioUrl: string, options: TranscriberOptions) => Promise<TranscriberOutput>
  modelLabel: string
}

interface WhisperLoadStrategy {
  modelId: string
  label: string
  dtype: 'fp32'
}

interface WhisperRemoteHost {
  host: string
  label: string
}

interface BrowserInferenceEnv {
  allowLocalModels: boolean
  allowRemoteModels: boolean
  useBrowserCache: boolean
  remoteHost: string
  logLevel: unknown
  backends?: {
    onnx?: {
      wasm?: {
        proxy?: boolean
        numThreads?: number
      }
    }
  }
}

interface ChunkRange {
  startMs: number
  endMs: number
}

interface EmbeddedSubtitleTrack {
  cues: SubtitleCue[]
  label: string
}

type StatusCallback = (message: string) => void

const TINY_MODEL = 'onnx-community/whisper-tiny_timestamped'
const BASE_MODEL = 'onnx-community/whisper-base_timestamped'
const MODEL_REMOTE_HOSTS: WhisperRemoteHost[] = [
  { host: 'https://huggingface.co/', label: 'Hugging Face' },
]
const MODEL_CACHE_LOAD_TIMEOUT_MS = 25_000
const MODEL_LOAD_TIMEOUT_MS = 240_000
const CHUNK_DURATION_MS = 30_000
const CHUNK_HEARTBEAT_MS = 5_000
const MIN_CHUNK_TIMEOUT_MS = 45_000
const MAX_CHUNK_TIMEOUT_MS = 75_000
const CHUNK_TRANSCRIBE_ATTEMPTS = 2
const MIN_ADAPTIVE_CHUNK_DURATION_MS = 7_500

let transcriberEntry:
  | {
      cacheKey: string
      promise: Promise<LoadedTranscriber>
    }
  | null = null

function getPreferredModelId() {
  return BASE_MODEL
}

function getWhisperLoadStrategies() {
  const strategies: WhisperLoadStrategy[] = [
    {
      modelId: BASE_MODEL,
      label: 'Whisper Base / fp32',
      dtype: 'fp32',
    },
    {
      modelId: TINY_MODEL,
      label: 'Whisper Tiny / fp32',
      dtype: 'fp32',
    },
  ]

  return strategies
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    if (error.message === 'Failed to fetch') {
      return '模型或视频资源下载失败，请检查网络；系统会自动尝试备用模型源。'
    }

    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return '未知错误'
}

function isQuantizedWeightSessionError(message: string) {
  return (
    message.includes('Missing required scale') ||
    message.includes('weight_merged_0_scale') ||
    message.includes("Can't create a session") ||
    message.includes('qdq_actions.cc')
  )
}

function toBinaryBytes(data: Uint8Array | ArrayBuffer | string) {
  if (data instanceof Uint8Array) {
    return data
  }

  if (typeof data === 'string') {
    return new TextEncoder().encode(data)
  }

  return new Uint8Array(data)
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function decodeText(bytes: Uint8Array | ArrayBuffer | string) {
  return new TextDecoder('utf-8', { fatal: false }).decode(toBinaryBytes(bytes))
}

function toFfmpegTimestamp(milliseconds: number) {
  return (Math.max(0, milliseconds) / 1000).toFixed(3)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage))
    }, timeoutMs)

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timeoutId)
        reject(error)
      },
    )
  })
}

async function waitForNextPaint() {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function configureBrowserInferenceBackend(env: BrowserInferenceEnv) {
  const wasmBackend = env.backends?.onnx?.wasm
  if (!wasmBackend || typeof window === 'undefined') {
    return
  }

  wasmBackend.proxy = true
  const hardwareThreads = navigator.hardwareConcurrency ?? 2
  wasmBackend.numThreads = Math.max(1, Math.min(2, Math.floor(hardwareThreads / 2)))
}

function buildStrategyFailureStatus(
  message: string,
  nextStrategy: WhisperLoadStrategy | undefined,
  nextRemoteHost?: WhisperRemoteHost,
) {
  if (nextRemoteHost) {
    return `当前字幕模型源加载失败，正在改用 ${nextRemoteHost.label}…`
  }

  if (nextStrategy) {
    if (isQuantizedWeightSessionError(message)) {
      return `当前字幕模型权重异常，正在改用 ${nextStrategy.label}…`
    }

    return `当前字幕模型加载失败，正在改用 ${nextStrategy.label}…`
  }

  return '当前设备暂时无法加载字幕模型，无法生成字幕草稿。'
}

function buildChunkRanges(durationMs: number) {
  const safeDurationMs = Math.max(1, Math.round(durationMs))
  const ranges: ChunkRange[] = []

  for (let startMs = 0; startMs < safeDurationMs; startMs += CHUNK_DURATION_MS) {
    ranges.push({
      startMs,
      endMs: Math.min(safeDurationMs, startMs + CHUNK_DURATION_MS),
    })
  }

  return ranges
}

function getChunkTimeoutMs(chunkDurationMs: number) {
  const scaledTimeout = Math.round(chunkDurationMs * 2)
  return Math.max(MIN_CHUNK_TIMEOUT_MS, Math.min(MAX_CHUNK_TIMEOUT_MS, scaledTimeout))
}

function shiftCues(cues: SubtitleCue[], offsetMs: number) {
  return cues.map((cue) => ({
    ...cue,
    startMs: cue.startMs + offsetMs,
    endMs: cue.endMs + offsetMs,
  }))
}

function cleanTranscriptText(text: string) {
  return text.replace(/\s+/g, ' ').replace(/<\|[^>]+?\|>/g, '').trim()
}

function normalizeCues(
  chunks: Array<{ text?: string; timestamp?: [number, number] }>,
  durationMs: number,
) {
  const safeDurationSec = Math.max(1, Math.round(durationMs / 1000))
  const cues: SubtitleCue[] = []

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const text = cleanTranscriptText(chunk.text ?? '')
    if (!text) {
      continue
    }

    const timestamp = chunk.timestamp
    const startSec =
      Array.isArray(timestamp) && Number.isFinite(timestamp[0]) ? timestamp[0] : index * 2
    const endSec =
      Array.isArray(timestamp) && Number.isFinite(timestamp[1])
        ? timestamp[1]
        : Math.min(safeDurationSec, startSec + 3)

    const startMs = Math.max(0, Math.round(startSec * 1000))
    const endMs = Math.max(startMs + 600, Math.round(endSec * 1000))
    cues.push({ startMs, endMs, jaText: text })
  }

  return cues
}

function normalizeTranscriberOutput(output: TranscriberOutput | undefined, durationMs: number) {
  return normalizeCues(
    Array.isArray(output?.chunks) && output.chunks.length > 0
      ? output.chunks
      : output?.text
        ? [
            {
              text: output.text,
              timestamp: [0, Math.max(1, Math.round(durationMs / 1000))] as [number, number],
            },
          ]
        : [],
    durationMs,
  )
}

function normalizeForHallucinationCheck(text: string) {
  return cleanTranscriptText(text)
    .replace(/[、。！？,.!?'"“”‘’（）()\[\]{}<>「」『』【】・ー〜…\s]/gu, '')
    .trim()
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasDominantRepeatedPhrase(parts: string[]) {
  if (parts.length < 8) {
    return false
  }

  const counts = new Map<string, number>()
  for (const part of parts) {
    const normalized = normalizeForHallucinationCheck(part)
    if (normalized.length < 2 || normalized.length > 10) {
      continue
    }

    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }

  return [...counts.values()].some((count) => count >= 6 && count / parts.length >= 0.45)
}

function hasDenseRepeatedNgram(text: string) {
  const compact = normalizeForHallucinationCheck(text)
  if (compact.length < 48) {
    return false
  }

  const uniqueRatio = new Set(Array.from(compact)).size / compact.length
  if (compact.length >= 80 && uniqueRatio <= 0.16) {
    return true
  }

  for (let size = 2; size <= 8; size += 1) {
    const seen = new Set<string>()
    for (let index = 0; index <= compact.length - size; index += 1) {
      const gram = compact.slice(index, index + size)
      if (seen.has(gram) || new Set(Array.from(gram)).size <= 1) {
        continue
      }

      seen.add(gram)
      const matches = compact.match(new RegExp(escapeRegex(gram), 'gu')) ?? []
      if (matches.length >= 8 && (matches.length * size) / compact.length >= 0.55) {
        return true
      }
    }
  }

  return false
}

function isLikelyAsrHallucination(cue: SubtitleCue) {
  const text = cue.jaText ?? cue.text ?? ''
  const compact = normalizeForHallucinationCheck(text)
  if (compact.length < 48) {
    return false
  }

  const phraseParts = text
    .split(/[、。！？,.!?\s]+/u)
    .map((part) => part.trim())
    .filter(Boolean)

  return hasDominantRepeatedPhrase(phraseParts) || hasDenseRepeatedNgram(text)
}

function removeLikelyAsrHallucinations(cues: SubtitleCue[], onStatus?: StatusCallback) {
  const filtered = cues.filter((cue) => !isLikelyAsrHallucination(cue))
  const removedCount = cues.length - filtered.length

  if (removedCount > 0) {
    onStatus?.(`已过滤 ${removedCount} 条低置信度重复字幕，继续整理可用字幕…`)
  }

  return filtered
}

function buildTimedOutCue(range: ChunkRange): SubtitleCue {
  return {
    startMs: range.startMs,
    endMs: Math.max(range.startMs + 800, range.endMs),
    jaText: '音声認識がこの区間でタイムアウトしました。プレビューで字幕を補ってください。',
    zhText: '这一小段语音识别超时，请在预览里补充或修改字幕。',
    zhSource: 'translation',
  }
}

function buildModelLabel(baseLabel: string, hardSubtitleCount: number) {
  return hardSubtitleCount > 0 ? `${baseLabel} + 画面硬中文字幕 OCR` : baseLabel
}

function scoreEmbeddedSubtitleCues(cues: SubtitleCue[]) {
  return cues.reduce((score, cue) => {
    const japaneseLine = cue.jaText ?? cue.text ?? ''
    let nextScore = score

    if (japaneseLine.trim()) {
      nextScore += 2
    }

    if (cue.zhText?.trim()) {
      nextScore += 3
    }

    return nextScore
  }, 0)
}

async function extractEmbeddedSubtitleTrack(
  file: File,
  onStatus?: StatusCallback,
): Promise<EmbeddedSubtitleTrack | null> {
  const { ffmpeg, fetchFile } = await getSharedFFmpeg(onStatus, '尝试读取视频自带字幕轨…')
  const inputExt = file.name.split('.').pop() || 'mp4'
  const inputName = `subtitle-track-input-${crypto.randomUUID()}.${inputExt}`

  await ffmpeg.writeFile(inputName, await fetchFile(file))

  try {
    let bestTrack: { cues: SubtitleCue[]; label: string; score: number } | null = null

    for (let streamIndex = 0; streamIndex < 4; streamIndex += 1) {
      const outputName = `embedded-track-${crypto.randomUUID()}-${streamIndex}.vtt`

      try {
        onStatus?.(`尝试读取视频自带字幕轨…第 ${streamIndex + 1} 条`)
        const code = await ffmpeg.exec([
          '-i',
          inputName,
          '-map',
          `0:s:${streamIndex}`,
          '-c:s',
          'webvtt',
          outputName,
        ])

        if (code !== 0) {
          continue
        }

        const rawText = decodeText(await ffmpeg.readFile(outputName))
        const cues = parseSubtitleText(rawText, outputName)
        if (cues.length === 0) {
          continue
        }

        const score = scoreEmbeddedSubtitleCues(cues)
        if (!bestTrack || score > bestTrack.score) {
          bestTrack = {
            cues,
            label: `视频自带字幕轨 ${streamIndex + 1}`,
            score,
          }
        }
      } catch {
        // Ignore missing or unsupported subtitle streams and continue with the next track.
      } finally {
        await ffmpeg.deleteFile(outputName).catch(() => undefined)
      }
    }

    return bestTrack
      ? {
          cues: bestTrack.cues,
          label: bestTrack.label,
        }
      : null
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => undefined)
  }
}

async function loadTranscriberForStrategy(
  strategy: WhisperLoadStrategy,
  remoteHost: WhisperRemoteHost,
  localFilesOnly: boolean,
  onStatus?: StatusCallback,
): Promise<LoadedTranscriber> {
  const { env, LogLevel, pipeline } = await import('@huggingface/transformers')
  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.useBrowserCache = true
  env.remoteHost = remoteHost.host
  env.logLevel = LogLevel.ERROR
  configureBrowserInferenceBackend(env)

  onStatus?.(
    localFilesOnly
      ? `正在检查本地字幕模型缓存（${strategy.label}）…`
      : `正在加载 ${strategy.label}（${remoteHost.label}）…`,
  )
  await waitForNextPaint()

  const transcriber = await withTimeout(
    pipeline('automatic-speech-recognition', strategy.modelId, {
      device: 'wasm',
      dtype: strategy.dtype,
      local_files_only: localFilesOnly,
      progress_callback: (progress: { progress?: number; status?: string }) => {
        if (typeof progress.progress === 'number') {
          const percent = progress.progress <= 1 ? progress.progress * 100 : progress.progress
          onStatus?.(`下载字幕模型中…${Math.max(0, Math.min(100, Math.round(percent)))}%`)
        } else if (progress.status === 'ready') {
          onStatus?.(`${strategy.label} 已就绪，准备进入分段字幕识别…`)
        }
      },
    }),
    localFilesOnly ? MODEL_CACHE_LOAD_TIMEOUT_MS : MODEL_LOAD_TIMEOUT_MS,
    localFilesOnly
      ? `${strategy.label} 本地缓存读取超时`
      : `${strategy.label}（${remoteHost.label}）加载超时`,
  )

  return {
    transcriber,
    modelLabel: strategy.label,
  }
}

async function getTranscriber(onStatus?: StatusCallback) {
  const cacheKey = getPreferredModelId()
  if (transcriberEntry && transcriberEntry.cacheKey === cacheKey) {
    return transcriberEntry.promise
  }

  const promise = (async () => {
    let lastError: unknown = null
    const strategies = getWhisperLoadStrategies()

    for (let index = 0; index < strategies.length; index += 1) {
      const strategy = strategies[index]

      for (let hostIndex = 0; hostIndex < MODEL_REMOTE_HOSTS.length; hostIndex += 1) {
        const remoteHost = MODEL_REMOTE_HOSTS[hostIndex]

        if (hostIndex === 0) {
          try {
            return await loadTranscriberForStrategy(strategy, remoteHost, true, onStatus)
          } catch {
            onStatus?.(`本地没有可用的 ${strategy.label} 缓存，准备从 ${remoteHost.label} 下载…`)
          }
        }

        try {
          return await loadTranscriberForStrategy(strategy, remoteHost, false, onStatus)
        } catch (error) {
          lastError = error
          onStatus?.(
            buildStrategyFailureStatus(
              normalizeErrorMessage(error),
              hostIndex === MODEL_REMOTE_HOSTS.length - 1 ? strategies[index + 1] : undefined,
              MODEL_REMOTE_HOSTS[hostIndex + 1],
            ),
          )
        }
      }
    }

    throw new Error(`自动字幕模型加载失败：${normalizeErrorMessage(lastError)}`)
  })()

  transcriberEntry = { cacheKey, promise }
  promise.catch(() => {
    if (transcriberEntry?.cacheKey === cacheKey) {
      transcriberEntry = null
    }
  })

  return promise
}

export async function preloadSubtitleModel(onStatus?: StatusCallback) {
  await getTranscriber(onStatus)
}

async function transcribeChunk(
  transcriber: LoadedTranscriber['transcriber'],
  audioUrl: string,
  chunkIndex: number,
  totalChunks: number,
  chunkDurationMs: number,
  attempt: number,
  onStatus?: StatusCallback,
) {
  const timeoutMs = getChunkTimeoutMs(chunkDurationMs)
  let waitedSeconds = 0
  const attemptLabel =
    attempt > 1 ? `，重试 ${attempt}/${CHUNK_TRANSCRIBE_ATTEMPTS}` : ''

  onStatus?.(`识别日语字幕中…第 ${chunkIndex}/${totalChunks} 段${attemptLabel}`)
  await waitForNextPaint()

  const heartbeatId = window.setInterval(() => {
    waitedSeconds += Math.round(CHUNK_HEARTBEAT_MS / 1000)
    onStatus?.(
      `识别日语字幕中…第 ${chunkIndex}/${totalChunks} 段${attemptLabel}，已等待 ${waitedSeconds} 秒`,
    )
  }, CHUNK_HEARTBEAT_MS)

  try {
    return await withTimeout(
      transcriber(audioUrl, {
        return_timestamps: true,
        chunk_length_s: 18,
        stride_length_s: 3,
        force_full_sequences: false,
        language: 'japanese',
        task: 'transcribe',
      }),
      timeoutMs,
      `第 ${chunkIndex}/${totalChunks} 段字幕识别超时（已等待 ${Math.round(timeoutMs / 1000)} 秒）`,
    )
  } finally {
    window.clearInterval(heartbeatId)
  }
}

async function transcribeRangeOnce({
  ffmpeg,
  inputName,
  range,
  chunkIndex,
  totalChunks,
  transcriber,
  attempt,
  onStatus,
}: {
  ffmpeg: FFmpeg
  inputName: string
  range: ChunkRange
  chunkIndex: number
  totalChunks: number
  transcriber: LoadedTranscriber['transcriber']
  attempt: number
  onStatus?: StatusCallback
}) {
  const outputName = `subtitle-audio-${crypto.randomUUID()}.wav`
  const chunkDurationMs = range.endMs - range.startMs

  try {
    onStatus?.(`准备第 ${chunkIndex}/${totalChunks} 段音频…`)
    const code = await ffmpeg.exec([
      '-ss',
      toFfmpegTimestamp(range.startMs),
      '-t',
      toFfmpegTimestamp(chunkDurationMs),
      '-i',
      inputName,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      outputName,
    ])

    if (code !== 0) {
      throw new Error(`第 ${chunkIndex}/${totalChunks} 段音频提取失败`)
    }

    const data = await ffmpeg.readFile(outputName)
    const bytes = toBinaryBytes(data)
    const audioBlob = new Blob([toArrayBuffer(bytes)], { type: 'audio/wav' })
    const audioUrl = URL.createObjectURL(audioBlob)

    try {
      const output = await transcribeChunk(
        transcriber,
        audioUrl,
        chunkIndex,
        totalChunks,
        chunkDurationMs,
        attempt,
        onStatus,
      )

      return shiftCues(normalizeTranscriberOutput(output, chunkDurationMs), range.startMs)
    } finally {
      URL.revokeObjectURL(audioUrl)
    }
  } finally {
    await ffmpeg.deleteFile(outputName).catch(() => undefined)
  }
}

async function transcribeRangeWithRetries(input: {
  ffmpeg: FFmpeg
  inputName: string
  range: ChunkRange
  chunkIndex: number
  totalChunks: number
  transcriber: LoadedTranscriber['transcriber']
  onStatus?: StatusCallback
}) {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= CHUNK_TRANSCRIBE_ATTEMPTS; attempt += 1) {
    try {
      return await transcribeRangeOnce({
        ...input,
        attempt,
      })
    } catch (error) {
      lastError = error
      if (attempt < CHUNK_TRANSCRIBE_ATTEMPTS) {
        input.onStatus?.(
          `第 ${input.chunkIndex}/${input.totalChunks} 段识别失败，正在用同一字幕模型重试…`,
        )
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('字幕识别失败')
}

async function transcribeRangeAdaptive(input: {
  ffmpeg: FFmpeg
  inputName: string
  range: ChunkRange
  chunkIndex: number
  totalChunks: number
  transcriber: LoadedTranscriber['transcriber']
  onStatus?: StatusCallback
  depth?: number
}): Promise<SubtitleCue[]> {
  try {
    return await transcribeRangeWithRetries(input)
  } catch (error) {
    const chunkDurationMs = input.range.endMs - input.range.startMs
    const canSplit = chunkDurationMs > MIN_ADAPTIVE_CHUNK_DURATION_MS * 1.4
    if (canSplit) {
      const middleMs = Math.round((input.range.startMs + input.range.endMs) / 2)
      input.onStatus?.(
        `第 ${input.chunkIndex}/${input.totalChunks} 段识别超时，正在拆成更小音频继续识别…`,
      )

      const left = await transcribeRangeAdaptive({
        ...input,
        range: {
          startMs: input.range.startMs,
          endMs: middleMs,
        },
        depth: (input.depth ?? 0) + 1,
      })
      const right = await transcribeRangeAdaptive({
        ...input,
        range: {
          startMs: middleMs,
          endMs: input.range.endMs,
        },
        depth: (input.depth ?? 0) + 1,
      })

      return [...left, ...right]
    }

    console.warn('Subtitle chunk still failed after adaptive retries.', error)
    input.onStatus?.(
      `第 ${input.chunkIndex}/${input.totalChunks} 段最小音频仍超时，已保留一条可编辑占位字幕。`,
    )
    return [buildTimedOutCue(input.range)]
  }
}

async function transcribeVideoInChunks(
  file: File,
  durationMs: number,
  transcriber: LoadedTranscriber['transcriber'],
  onStatus?: StatusCallback,
) {
  const { ffmpeg, fetchFile } = await getSharedFFmpeg(onStatus, '准备分段音频引擎…')
  const inputExt = file.name.split('.').pop() || 'mp4'
  const inputName = `subtitle-input-${crypto.randomUUID()}.${inputExt}`
  const chunkRanges = buildChunkRanges(durationMs)
  const allCues: SubtitleCue[] = []

  await ffmpeg.writeFile(inputName, await fetchFile(file))

  try {
    for (let index = 0; index < chunkRanges.length; index += 1) {
      const range = chunkRanges[index]
      const chunkIndex = index + 1
      const cues = await transcribeRangeAdaptive({
        ffmpeg,
        inputName,
        range,
        chunkIndex,
        totalChunks: chunkRanges.length,
        transcriber,
        onStatus,
      })
      allCues.push(...cues)
    }
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => undefined)
  }

  return allCues.sort((left, right) => left.startMs - right.startMs)
}

export async function generateStudyDataFromVideo(
  file: File,
  durationMs: number,
  onStatus?: StatusCallback,
): Promise<SubtitleGenerationResult> {
  try {
    const embeddedTrack = await extractEmbeddedSubtitleTrack(file, onStatus)
    if (embeddedTrack) {
      onStatus?.(`已读取${embeddedTrack.label}，正在生成字幕时间轴…`)
      const embeddedEntityContext = buildSubtitleEntityContext({
        fileName: file.name,
        cues: embeddedTrack.cues,
      })
      const embeddedEnrichment = await enrichCuesWithHardSubtitles(
        file,
        applySubtitleEntityCorrectionsToCues(embeddedTrack.cues, embeddedEntityContext),
        onStatus,
      )
      const embeddedCues = applySubtitleEntityCorrectionsToCues(
        embeddedEnrichment.cues,
        embeddedEntityContext,
      )
      const embeddedStudyData = await buildStudyDataFromCues(embeddedCues, {
        entityContext: embeddedEntityContext,
        includeKnowledge: false,
      })

      if (embeddedStudyData.segments.length > 0) {
        return {
          segments: embeddedStudyData.segments,
          knowledgePoints: embeddedStudyData.knowledgePoints,
          modelLabel: buildModelLabel(embeddedTrack.label, embeddedEnrichment.recognizedCount),
          usedFallback: false,
        }
      }

      onStatus?.(`${embeddedTrack.label} 没有提取到可用字幕，继续尝试语音识别…`)
    }

    const { transcriber, modelLabel } = await getTranscriber(onStatus)
    const rawCues = removeLikelyAsrHallucinations(
      await transcribeVideoInChunks(file, durationMs, transcriber, onStatus),
      onStatus,
    )
    const entityContext = buildSubtitleEntityContext({ fileName: file.name, cues: rawCues })
    const cues = applySubtitleEntityCorrectionsToCues(rawCues, entityContext)
    const enrichment = await enrichCuesWithHardSubtitles(file, cues, onStatus)
    const enrichedEntityContext = buildSubtitleEntityContext({
      fileName: file.name,
      cues: enrichment.cues,
    })
    const enrichedCues = applySubtitleEntityCorrectionsToCues(
      enrichment.cues,
      enrichedEntityContext,
    )

    if (enrichedCues.length === 0) {
      throw new Error(
        '没有识别出可用字幕。请换更清晰、对白更明显的视频，或上传外部字幕。',
      )
    }

    onStatus?.(`生成中文字幕与字幕时间轴中…共 ${enrichedCues.length} 条字幕`)
    const studyData = await buildStudyDataFromCues(enrichedCues, {
      entityContext: enrichedEntityContext,
      includeKnowledge: false,
    })

    if (studyData.segments.length === 0) {
      throw new Error(
        '识别到了字幕，但没有生成可编辑的字幕行。请换对白更清晰的视频片段，或上传外部字幕。',
      )
    }

    return {
      segments: studyData.segments,
      knowledgePoints: studyData.knowledgePoints,
      modelLabel: buildModelLabel(modelLabel, enrichment.recognizedCount),
      usedFallback: false,
    }
  } catch (error) {
    throw new Error(
      `自动字幕生成失败：${normalizeErrorMessage(error)}。请稍后重试，或上传 .srt / .vtt / .ass 字幕。`,
    )
  }
}
