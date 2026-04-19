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

interface ChunkRange {
  startMs: number
  endMs: number
}

type StatusCallback = (message: string) => void

const TINY_MODEL = 'onnx-community/whisper-tiny_timestamped'
const BASE_MODEL = 'onnx-community/whisper-base_timestamped'
const MODEL_LOAD_TIMEOUT_MS = 75_000
const CHUNK_DURATION_MS = 30_000
const CHUNK_HEARTBEAT_MS = 5_000
const MIN_CHUNK_TIMEOUT_MS = 45_000
const MAX_CHUNK_TIMEOUT_MS = 75_000

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
) {
  if (nextStrategy) {
    if (isQuantizedWeightSessionError(message)) {
      return `当前字幕模型权重异常，正在改用 ${nextStrategy.label}…`
    }

    return `当前字幕模型加载失败，正在改用 ${nextStrategy.label}…`
  }

  return '当前设备暂时无法加载字幕模型，无法按语法和单词切片。'
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

function hasUsableFocusTerms(segments: TranscriptSegment[]) {
  return segments.some((segment) => segment.focusTermIds.length > 0)
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
          const percent = progress.progress <= 1 ? progress.progress * 100 : progress.progress
          onStatus?.(`下载字幕模型中…${Math.max(0, Math.min(100, Math.round(percent)))}%`)
        } else if (progress.status === 'ready') {
          onStatus?.(`${strategy.label} 已就绪，准备进入分段字幕识别…`)
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
        onStatus?.(buildStrategyFailureStatus(normalizeErrorMessage(error), strategies[index + 1]))
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

async function transcribeChunk(
  transcriber: LoadedTranscriber['transcriber'],
  audioUrl: string,
  chunkIndex: number,
  totalChunks: number,
  chunkDurationMs: number,
  onStatus?: StatusCallback,
) {
  const timeoutMs = getChunkTimeoutMs(chunkDurationMs)
  let waitedSeconds = 0

  onStatus?.(`识别日语字幕中…第 ${chunkIndex}/${totalChunks} 段`)
  await waitForNextPaint()

  const heartbeatId = window.setInterval(() => {
    waitedSeconds += Math.round(CHUNK_HEARTBEAT_MS / 1000)
    onStatus?.(`识别日语字幕中…第 ${chunkIndex}/${totalChunks} 段，已等待 ${waitedSeconds} 秒`)
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

async function transcribeVideoInChunks(
  file: File,
  durationMs: number,
  transcriber: LoadedTranscriber['transcriber'],
  onStatus?: StatusCallback,
) {
  const { ffmpeg, fetchFile } = await getSharedFFmpeg(onStatus, '准备音频切片引擎…')
  const inputExt = file.name.split('.').pop() || 'mp4'
  const inputName = `subtitle-input-${crypto.randomUUID()}.${inputExt}`
  const chunkRanges = buildChunkRanges(durationMs)
  const allCues: SubtitleCue[] = []

  await ffmpeg.writeFile(inputName, await fetchFile(file))

  try {
    for (let index = 0; index < chunkRanges.length; index += 1) {
      const range = chunkRanges[index]
      const chunkIndex = index + 1
      const outputName = `subtitle-audio-${crypto.randomUUID()}.wav`

      try {
        onStatus?.(`准备第 ${chunkIndex}/${chunkRanges.length} 段音频…`)
        const code = await ffmpeg.exec([
          '-ss',
          toFfmpegTimestamp(range.startMs),
          '-t',
          toFfmpegTimestamp(range.endMs - range.startMs),
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
          throw new Error(`第 ${chunkIndex}/${chunkRanges.length} 段音频提取失败`)
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
            chunkRanges.length,
            range.endMs - range.startMs,
            onStatus,
          )

          const cues = normalizeCues(
            Array.isArray(output?.chunks) && output.chunks.length > 0
              ? output.chunks
              : output?.text
                ? [
                    {
                      text: output.text,
                      timestamp: [
                        0,
                        Math.max(1, Math.round((range.endMs - range.startMs) / 1000)),
                      ] as [number, number],
                    },
                  ]
                : [],
            range.endMs - range.startMs,
          )

          allCues.push(...shiftCues(cues, range.startMs))
        } finally {
          URL.revokeObjectURL(audioUrl)
        }
      } finally {
        await ffmpeg.deleteFile(outputName).catch(() => undefined)
      }
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
    const { transcriber, modelLabel } = await getTranscriber(onStatus)
    const cues = await transcribeVideoInChunks(file, durationMs, transcriber, onStatus)

    if (cues.length === 0) {
      throw new Error(
        '没有识别出可用字幕，无法按语法和单词切片。请先导入字幕文件，或换更短、更清晰的片段。',
      )
    }

    onStatus?.(`生成中文字幕与知识点中…共 ${cues.length} 条字幕`)
    const studyData = await buildStudyDataFromCues(cues)

    if (
      studyData.segments.length === 0 ||
      studyData.knowledgePoints.length === 0 ||
      !hasUsableFocusTerms(studyData.segments)
    ) {
      throw new Error(
        '识别到了字幕，但没有抽出足够的语法或单词知识点，无法按语法和单词切片。请换对白更清晰的片段，或直接导入字幕文件。',
      )
    }

    return {
      segments: studyData.segments,
      knowledgePoints: studyData.knowledgePoints,
      modelLabel,
      usedFallback: false,
    }
  } catch (error) {
    throw new Error(
      `自动字幕生成失败：${normalizeErrorMessage(error)}。当前切片只会基于字幕里的语法和单词，不会再按时间粗切。`,
    )
  }
}
