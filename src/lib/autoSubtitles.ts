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

  const transcriber = await pipeline('automatic-speech-recognition', strategy.modelId, {
    device: 'wasm',
    dtype: strategy.dtype,
    progress_callback: (progress: { progress?: number; status?: string }) => {
      if (typeof progress.progress === 'number') {
        onStatus?.(`下载字幕模型中…${Math.round(progress.progress)}%`)
      } else if (progress.status === 'ready') {
        onStatus?.(`${strategy.label} 已就绪，开始识别…`)
      }
    },
  })

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

    for (const strategy of getWhisperLoadStrategies()) {
      try {
        return await loadTranscriberForStrategy(strategy, onStatus)
      } catch (error) {
        lastError = error
        const message = normalizeErrorMessage(error)

        if (isQuantizedWeightSessionError(message)) {
          onStatus?.('当前字幕模型量化权重异常，正在自动切换到更稳的加载方案…')
        } else {
          onStatus?.('当前字幕模型加载失败，正在切换到备用方案…')
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

  if (cues.length === 0) {
    return [
      {
        startMs: 0,
        endMs: durationMs,
        jaText: '字幕暂时没有识别成功，可以换一段对白更清晰的片段再试。',
      },
    ]
  }

  return cues
}

export async function generateStudyDataFromVideo(
  file: File,
  durationMs: number,
  onStatus?: StatusCallback,
): Promise<SubtitleGenerationResult> {
  const audioUrl = await extractAudioTrack(file, onStatus)

  try {
    const { transcriber, modelLabel } = await getTranscriber(onStatus)
    onStatus?.('识别日语字幕中…')
    await waitForNextPaint()

    const output = await transcriber(audioUrl, {
      return_timestamps: true,
      chunk_length_s: 18,
      stride_length_s: 3,
      force_full_sequences: false,
      language: 'japanese',
      task: 'transcribe',
    })

    const chunks =
      Array.isArray(output?.chunks) && output.chunks.length > 0
        ? output.chunks
        : [
            {
              text: output?.text ?? '',
              timestamp: [0, Math.max(1, Math.round(durationMs / 1000))] as [number, number],
            },
          ]

    onStatus?.('生成中文字幕与知识点中…')
    const cues = normalizeCues(chunks, durationMs)
    const studyData = await buildStudyDataFromCues(cues)

    return {
      segments: studyData.segments,
      knowledgePoints: studyData.knowledgePoints,
      modelLabel,
    }
  } catch (error) {
    const message = normalizeErrorMessage(error)
    throw new Error(
      `自动字幕生成失败：${message}。你也可以先导入 .srt / .vtt / .ass 字幕继续切片学习。`,
    )
  } finally {
    URL.revokeObjectURL(audioUrl)
  }
}
