import type { KnowledgePoint, TranscriptSegment } from '../types'
import { buildStudyDataFromCues } from './subtitles'

interface SubtitleCue {
  startMs: number
  endMs: number
  jaText: string
}

interface SubtitleGenerationResult {
  segments: TranscriptSegment[]
  knowledgePoints: KnowledgePoint[]
  modelLabel: string
}

interface LoadedTranscriber {
  transcriber: any
  modelLabel: string
}

interface WhisperLoadStrategy {
  modelId: string
  label: string
  dtype: 'fp32'
}

type StatusCallback = (message: string) => void

const FFMPEG_CORE_VERSION = '0.12.10'
const FFMPEG_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`
const TINY_MODEL = 'onnx-community/whisper-tiny_timestamped'
const BASE_MODEL = 'onnx-community/whisper-base_timestamped'

let ffmpegPromise: Promise<{
  ffmpeg: any
  fetchFile: (file: File | Blob) => Promise<Uint8Array>
}> | null = null

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

async function waitForNextPaint() {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function configureBrowserInferenceBackend(env: any) {
  const wasmBackend = env.backends?.onnx?.wasm
  if (!wasmBackend || typeof window === 'undefined') {
    return
  }

  wasmBackend.proxy = true
  const hardwareThreads = navigator.hardwareConcurrency ?? 2
  wasmBackend.numThreads = Math.max(1, Math.min(2, Math.floor(hardwareThreads / 2)))
}

async function getFFmpeg(onStatus?: StatusCallback) {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      onStatus?.('准备音频引擎…')
      const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
        import('@ffmpeg/ffmpeg'),
        import('@ffmpeg/util'),
      ])

      const ffmpeg = new FFmpeg()
      await ffmpeg.load({
        coreURL: await toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
        workerURL: await toBlobURL(
          `${FFMPEG_BASE_URL}/ffmpeg-core.worker.js`,
          'text/javascript',
        ),
      })

      return { ffmpeg, fetchFile }
    })()
  }

  return ffmpegPromise
}

async function extractAudioTrack(file: File, onStatus?: StatusCallback) {
  const { ffmpeg, fetchFile } = await getFFmpeg(onStatus)
  const inputExt = file.name.split('.').pop() || 'mp4'
  const inputName = `input-${crypto.randomUUID()}.${inputExt}`
  const outputName = `audio-${crypto.randomUUID()}.wav`
  const handleProgress = ({ progress }: { progress: number }) => {
    onStatus?.(`从视频中提取音频…${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`)
  }

  onStatus?.('从视频中提取音频…0%')
  await ffmpeg.writeFile(inputName, await fetchFile(file))
  ffmpeg.on('progress', handleProgress)

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

    const data = await ffmpeg.readFile(outputName)
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    const audioBlob = new Blob([bytes], { type: 'audio/wav' })
    onStatus?.('从视频中提取音频…100%')
    return URL.createObjectURL(audioBlob)
  } finally {
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
        text: '暂时没有识别出可用字幕，可以换一段对白更清晰的片段重试。',
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
