import type { KnowledgePoint, TranscriptSegment } from '../types'
import { buildStudyDataFromCues } from './subtitles'

interface SubtitleCue {
  startMs: number
  endMs: number
  text: string
}

interface SubtitleGenerationResult {
  segments: TranscriptSegment[]
  knowledgePoints: KnowledgePoint[]
  modelLabel: string
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

let transcriberPromise: Promise<any> | null = null
let transcriberModelId = ''

function getPreferredModelId() {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0
  return memory >= 8 ? BASE_MODEL : TINY_MODEL
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

  onStatus?.('从视频中提取音频…')
  await ffmpeg.writeFile(inputName, await fetchFile(file))

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
    return URL.createObjectURL(audioBlob)
  } finally {
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)])
  }
}

async function getTranscriber(onStatus?: StatusCallback) {
  const preferredModelId = getPreferredModelId()
  if (transcriberPromise && transcriberModelId === preferredModelId) {
    return transcriberPromise
  }

  transcriberModelId = preferredModelId
  transcriberPromise = (async () => {
    onStatus?.(
      preferredModelId === BASE_MODEL
        ? '首次运行会下载较高精度日语语音模型，请稍等…'
        : '首次运行会下载轻量日语语音模型，请稍等…',
    )

    const { env, LogLevel, pipeline } = await import('@huggingface/transformers')
    env.allowLocalModels = false
    env.allowRemoteModels = true
    env.useBrowserCache = true
    env.logLevel = LogLevel.ERROR

    return pipeline('automatic-speech-recognition', preferredModelId, {
      progress_callback: (progress: { progress?: number; status?: string }) => {
        if (typeof progress.progress === 'number') {
          onStatus?.(`下载语音模型…${Math.round(progress.progress)}%`)
        } else if (progress.status === 'ready') {
          onStatus?.('语音模型已就绪，开始识别…')
        }
      },
    })
  })()

  return transcriberPromise
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
    const startSec = Array.isArray(timestamp) && Number.isFinite(timestamp[0]) ? timestamp[0] : index * 2
    const endSec =
      Array.isArray(timestamp) && Number.isFinite(timestamp[1])
        ? timestamp[1]
        : Math.min(safeDurationSec, startSec + 3)

    const startMs = Math.max(0, Math.round(startSec * 1000))
    const endMs = Math.max(startMs + 600, Math.round(endSec * 1000))
    cues.push({ startMs, endMs, text })
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
    const transcriber = await getTranscriber(onStatus)
    onStatus?.('识别日语字幕中…')

    const output = await transcriber(audioUrl, {
      return_timestamps: true,
      chunk_length_s: 24,
      stride_length_s: 4,
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
      modelLabel: transcriberModelId === BASE_MODEL ? 'Whisper Base' : 'Whisper Tiny',
    }
  } finally {
    URL.revokeObjectURL(audioUrl)
  }
}
