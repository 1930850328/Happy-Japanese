import type { KnowledgePoint, TranscriptSegment } from '../types'
import { getSharedFFmpeg } from './ffmpegRuntime'
import { buildStudyDataFromCues } from './subtitles'

interface SubtitleCue {
  startMs: number
  endMs: number
  jaText?: string
  text?: string
}

interface SubtitleGenerationResult {
  segments: TranscriptSegment[]
  knowledgePoints: KnowledgePoint[]
  modelLabel: string
  usedFallback: boolean
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

type StatusCallback = (message: string) => void

interface BrowserInferenceEnv {
  allowLocalModels: boolean
  allowRemoteModels: boolean
  useBrowserCache: boolean
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

const TINY_MODEL = 'onnx-community/whisper-tiny_timestamped'
const BASE_MODEL = 'onnx-community/whisper-base_timestamped'
const MODEL_LOAD_TIMEOUT_MS = 75_000
const MIN_TRANSCRIBE_TIMEOUT_MS = 90_000
const MAX_TRANSCRIBE_TIMEOUT_MS = 210_000
const TARGET_FALLBACK_SEGMENT_MS = 22_000
const MAX_FALLBACK_SEGMENTS = 8

let transcriberEntry:
  | {
      cacheKey: string
      promise: Promise<LoadedTranscriber>
    }
  | null = null

function getPreferredModelId() {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0
  return memory >= 16 ? BASE_MODEL : TINY_MODEL
}

function getWhisperLoadStrategies() {
  const preferredModelId = getPreferredModelId()
  const strategies: WhisperLoadStrategy[] = [
    {
      modelId: preferredModelId,
      label: preferredModelId === BASE_MODEL ? 'Whisper Base / fp32' : 'Whisper Tiny / fp32',
      dtype: 'fp32',
    },
  ]

  if (preferredModelId !== TINY_MODEL) {
    strategies.push({
      modelId: TINY_MODEL,
      label: 'Whisper Tiny / fp32',
      dtype: 'fp32',
    })
  }

  return strategies
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
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

function getTranscribeTimeoutMs(durationMs: number) {
  const scaledTimeout = Math.round(durationMs * 2.5)
  return Math.max(MIN_TRANSCRIBE_TIMEOUT_MS, Math.min(MAX_TRANSCRIBE_TIMEOUT_MS, scaledTimeout))
}

function buildFallbackSegments(durationMs: number): TranscriptSegment[] {
  const safeDurationMs =
    Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 30_000
  const segmentCount = Math.max(
    1,
    Math.min(MAX_FALLBACK_SEGMENTS, Math.round(safeDurationMs / TARGET_FALLBACK_SEGMENT_MS)),
  )
  const segmentDurationMs = Math.max(4_000, Math.ceil(safeDurationMs / segmentCount))
  const segments: TranscriptSegment[] = []

  for (let index = 0; index < segmentCount; index += 1) {
    const startMs = Math.min(safeDurationMs, index * segmentDurationMs)
    const endMs =
      index === segmentCount - 1
        ? safeDurationMs
        : Math.min(safeDurationMs, startMs + segmentDurationMs)

    if (endMs <= startMs) {
      continue
    }

    segments.push({
      startMs,
      endMs,
      ja: 'この区間は字幕なしの仮切片です。',
      kana: 'このくかんは じまくなしの かりきっぺん です。',
      romaji: 'kono kukan wa jimaku nashi no kari kippen desu.',
      zh: `第 ${index + 1} 段先按时间粗切，后面可以再补字幕。`,
      focusTermIds: [],
    })
  }

  return segments.length > 0
    ? segments
    : [
        {
          startMs: 0,
          endMs: safeDurationMs,
          ja: 'この区間は字幕なしの仮切片です。',
          kana: 'このくかんは じまくなしの かりきっぺん です。',
          romaji: 'kono kukan wa jimaku nashi no kari kippen desu.',
          zh: '这段先按时间粗切，后面可以再补字幕。',
          focusTermIds: [],
        },
      ]
}

function buildFallbackResult(durationMs: number): SubtitleGenerationResult {
  return {
    segments: buildFallbackSegments(durationMs),
    knowledgePoints: [],
    modelLabel: '字幕兜底粗切',
    usedFallback: true,
  }
}

function buildStrategyFailureStatus(
  message: string,
  nextStrategy: WhisperLoadStrategy | undefined,
) {
  if (nextStrategy) {
    if (isQuantizedWeightSessionError(message)) {
      return `当前字幕模型权重异常，正在改用 ${nextStrategy.label}…`
    }

    return `当前字幕模型加载失败，正在改用 ${nextStrategy.label}…`
  }

  return '当前设备暂时无法加载字幕模型，准备切换到无字幕粗切片预览…'
}

function normalizeProgressValue(value: number) {
  const normalized = value <= 1 ? value * 100 : value
  return Math.max(0, Math.min(100, Math.round(normalized)))
}

async function extractAudioTrack(file: File, onStatus?: StatusCallback) {
  const { ffmpeg, fetchFile } = await getSharedFFmpeg(onStatus, '准备音频引擎…')
  const inputExt = file.name.split('.').pop() || 'mp4'
  const inputName = `input-${crypto.randomUUID()}.${inputExt}`
  const outputName = `audio-${crypto.randomUUID()}.wav`

  let latestProgress = 0
  const handleProgress = ({ progress }: { progress: number }) => {
    if (!Number.isFinite(progress)) {
      return
    }

    latestProgress = Math.max(latestProgress, Math.max(0, Math.min(1, progress)))
    onStatus?.(`从视频中提取音频…${Math.round(latestProgress * 100)}%`)
  }

  let heartbeatId = 0
  onStatus?.('从视频中提取音频…0%')
  await ffmpeg.writeFile(inputName, await fetchFile(file))
  ffmpeg.on('progress', handleProgress)
  heartbeatId = window.setInterval(() => {
    latestProgress = Math.min(0.95, latestProgress + 0.03)
    onStatus?.(`从视频中提取音频…${Math.round(latestProgress * 100)}%`)
  }, 1200)

  try {
    const code = await ffmpeg.exec([
      '-i',
      inputName,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-map',
      '0:a:0',
      outputName,
    ])

    if (code !== 0) {
      throw new Error('FFmpeg could not extract audio from the video.')
    }

    onStatus?.('从视频中提取音频…100%')
    const data = await ffmpeg.readFile(outputName)
    const bytes = toBinaryBytes(data)
    const audioBlob = new Blob([toArrayBuffer(bytes)], { type: 'audio/wav' })
    return URL.createObjectURL(audioBlob)
  } finally {
    if (heartbeatId) {
      window.clearInterval(heartbeatId)
    }
    ffmpeg.off('progress', handleProgress)
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)])
  }
}

async function loadTranscriberForStrategy(
  strategy: WhisperLoadStrategy,
  onStatus?: StatusCallback,
): Promise<LoadedTranscriber> {
  const { env, LogLevel, pipeline } = await import('@huggingface/transformers')
  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.useBrowserCache = true
  env.logLevel = LogLevel.ERROR
  configureBrowserInferenceBackend(env)

  onStatus?.(`正在加载 ${strategy.label}…`)
  await waitForNextPaint()

  const transcriber = await withTimeout(
    pipeline('automatic-speech-recognition', strategy.modelId, {
      device: 'wasm',
      dtype: strategy.dtype,
      progress_callback: (progress: { progress?: number; status?: string }) => {
        if (typeof progress.progress === 'number') {
          onStatus?.(`下载字幕模型中…${normalizeProgressValue(progress.progress)}%`)
        } else if (progress.status === 'ready') {
          onStatus?.(`${strategy.label} 已就绪，开始识别…`)
        }
      },
    }),
    MODEL_LOAD_TIMEOUT_MS,
    `${strategy.label} 加载超时`,
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

      try {
        return await loadTranscriberForStrategy(strategy, onStatus)
      } catch (error) {
        lastError = error
        const message = normalizeErrorMessage(error)
        const nextStrategy = strategies[index + 1]
        onStatus?.(buildStrategyFailureStatus(message, nextStrategy))
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

export async function generateStudyDataFromVideo(
  file: File,
  durationMs: number,
  onStatus?: StatusCallback,
): Promise<SubtitleGenerationResult> {
  let audioUrl: string | null = null

  try {
    audioUrl = await extractAudioTrack(file, onStatus)
    const { transcriber, modelLabel } = await getTranscriber(onStatus)
    onStatus?.('识别日语字幕中…')
    await waitForNextPaint()

    const output = await withTimeout(
      transcriber(audioUrl, {
        return_timestamps: true,
        chunk_length_s: 18,
        stride_length_s: 3,
        force_full_sequences: false,
        language: 'japanese',
        task: 'transcribe',
      }),
      getTranscribeTimeoutMs(durationMs),
      '本次字幕识别超时',
    )

    const chunks =
      Array.isArray(output?.chunks) && output.chunks.length > 0
        ? output.chunks
        : [
            {
              text: output?.text ?? '',
              timestamp: [0, Math.max(1, Math.round(durationMs / 1000))] as [number, number],
            },
          ]

    const cues = normalizeCues(chunks, durationMs)
    if (cues.length === 0) {
      onStatus?.('字幕结果太少，已切换为无字幕粗切片预览。')
      return buildFallbackResult(durationMs)
    }

    onStatus?.('生成中文字幕与知识点中…')
    const studyData = await buildStudyDataFromCues(cues)
    if (studyData.segments.length === 0) {
      onStatus?.('字幕结果不足以切片，已切换为无字幕粗切片预览。')
      return buildFallbackResult(durationMs)
    }

    return {
      segments: studyData.segments,
      knowledgePoints: studyData.knowledgePoints,
      modelLabel,
      usedFallback: false,
    }
  } catch (error) {
    console.warn('Auto subtitle generation failed, using rough fallback slices instead.', error)
    onStatus?.('当前设备暂时无法完成字幕识别，已切换为无字幕粗切片预览。')
    return buildFallbackResult(durationMs)
  } finally {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
    }
  }
}
