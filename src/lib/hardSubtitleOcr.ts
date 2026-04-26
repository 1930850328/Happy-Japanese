import { isUsableChineseSubtitle } from './chineseTranslation'
import type { SubtitleCue } from './subtitles'

type StatusCallback = (message: string) => void

interface OcrWorker {
  setParameters(params: Record<string, unknown>): Promise<unknown>
  recognize(
    image: HTMLCanvasElement,
    options?: Record<string, unknown>,
  ): Promise<{ data?: { text?: string } }>
}

interface TesseractApi {
  createWorker: (
    langs?: string | string[],
    oem?: unknown,
    options?: {
      logger?: (message: { status?: string; progress?: number }) => void
      errorHandler?: (error: unknown) => void
    },
  ) => Promise<OcrWorker>
  PSM: {
    SINGLE_BLOCK: string
  }
}

interface SubtitleTarget {
  cue: SubtitleCue
  sampleMs: number
}

const OCR_REGION_TOP_RATIO = 0.72
const OCR_REGION_HEIGHT_RATIO = 0.24
const OCR_OUTPUT_WIDTH = 1600
const OCR_CACHE_BUCKET_MS = 800
const OCR_MIN_CONFIDENT_TEXT_LENGTH = 4

let workerPromise: Promise<OcrWorker> | null = null

function countChineseCharacters(input: string) {
  return (input.match(/[\u4e00-\u9fff]/gu) || []).length
}

function getSampleTimeMs(cue: SubtitleCue) {
  const center = cue.startMs + (cue.endMs - cue.startMs) / 2
  return Math.max(cue.startMs + 80, Math.min(cue.endMs - 80, center))
}

function buildSubtitleTargets(cues: SubtitleCue[]) {
  return cues
    .filter((cue) => {
      const jaText = cue.jaText ?? cue.text ?? ''
      return jaText.trim() && !isUsableChineseSubtitle(jaText, cue.zhText)
    })
    .map<SubtitleTarget>((cue) => ({
      cue,
      sampleMs: getSampleTimeMs(cue),
    }))
}

function normalizeHardSubtitleText(input: string) {
  return input
    .replace(/\r/g, '')
    .replace(/[|｜]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, '')
    .trim()
}

function pickBestChineseLine(rawText: string) {
  const candidates = rawText
    .split('\n')
    .map(normalizeHardSubtitleText)
    .filter(Boolean)
    .filter((line) => countChineseCharacters(line) >= OCR_MIN_CONFIDENT_TEXT_LENGTH)
    .sort((left, right) => {
      const chineseDiff = countChineseCharacters(right) - countChineseCharacters(left)
      if (chineseDiff !== 0) {
        return chineseDiff
      }

      return right.length - left.length
    })

  return candidates[0] ?? ''
}

function bucketSampleTime(sampleMs: number) {
  return Math.round(sampleMs / OCR_CACHE_BUCKET_MS) * OCR_CACHE_BUCKET_MS
}

function createVideoFromFile(file: File) {
  const objectUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  video.src = objectUrl

  const cleanup = () => {
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(objectUrl)
  }

  return { video, cleanup }
}

function waitForVideoReady(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('无法读取硬字幕所需的视频画面'))
    }, 8000)

    const cleanup = () => {
      window.clearTimeout(timeoutId)
      video.onloadeddata = null
      video.onloadedmetadata = null
      video.onerror = null
    }

    const finish = () => {
      cleanup()
      resolve()
    }

    video.onloadeddata = finish
    video.onloadedmetadata = finish
    video.onerror = () => {
      cleanup()
      reject(new Error('视频当前无法用于硬字幕 OCR'))
    }
    video.load()
  })
}

function seekVideo(video: HTMLVideoElement, timeMs: number) {
  return new Promise<void>((resolve, reject) => {
    const targetTime = Math.max(0.05, timeMs / 1000)
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error('硬字幕 OCR 跳帧超时'))
    }, 5000)

    const cleanup = () => {
      window.clearTimeout(timeoutId)
      video.onseeked = null
      video.onerror = null
    }

    video.onseeked = () => {
      cleanup()
      resolve()
    }

    video.onerror = () => {
      cleanup()
      reject(new Error('硬字幕 OCR 读取视频帧失败'))
    }

    try {
      video.currentTime = targetTime
    } catch {
      cleanup()
      reject(new Error('硬字幕 OCR 无法跳转到目标画面'))
    }
  })
}

function renderSubtitleRegion(video: HTMLVideoElement) {
  const sourceWidth = video.videoWidth || 1280
  const sourceHeight = video.videoHeight || 720
  const sourceTop = Math.round(sourceHeight * OCR_REGION_TOP_RATIO)
  const sourceHeightRegion = Math.max(120, Math.round(sourceHeight * OCR_REGION_HEIGHT_RATIO))
  const sourceBottom = Math.min(sourceHeight, sourceTop + sourceHeightRegion)
  const sourceCropHeight = Math.max(120, sourceBottom - sourceTop)
  const outputHeight = Math.round((OCR_OUTPUT_WIDTH * sourceCropHeight) / sourceWidth)

  const canvas = document.createElement('canvas')
  canvas.width = OCR_OUTPUT_WIDTH
  canvas.height = outputHeight
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('硬字幕 OCR 无法初始化画布')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(
    video,
    0,
    sourceTop,
    sourceWidth,
    sourceCropHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  )

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const { data } = imageData

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index]
    const green = data[index + 1]
    const blue = data[index + 2]
    const maxChannel = Math.max(red, green, blue)
    const minChannel = Math.min(red, green, blue)
    const saturation = maxChannel - minChannel
    const luma = red * 0.299 + green * 0.587 + blue * 0.114
    const looksLikeSubtitle = luma > 148 && saturation < 72
    const value = looksLikeSubtitle ? 0 : 255

    data[index] = value
    data[index + 1] = value
    data[index + 2] = value
    data[index + 3] = 255
  }

  context.putImageData(imageData, 0, 0)
  return canvas
}

async function loadTesseractApi(): Promise<TesseractApi> {
  const imported = await import('tesseract.js')
  return ((imported as { default?: TesseractApi }).default ??
    (imported as unknown as TesseractApi)) as TesseractApi
}

async function getWorker(onStatus?: StatusCallback) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const tesseract = await loadTesseractApi()
      const worker = await tesseract.createWorker('chi_sim', undefined, {
        logger: (message) => {
          const status = message.status ?? ''
          if (status.includes('loading') || status.includes('initializing')) {
            const percent =
              typeof message.progress === 'number'
                ? `${Math.max(0, Math.min(100, Math.round(message.progress * 100)))}%`
                : ''
            onStatus?.(`正在加载硬字幕 OCR 模型…${percent}`)
          }
        },
      })

      await worker.setParameters({
        tessedit_pageseg_mode: tesseract.PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '0',
        user_defined_dpi: '180',
      })

      return worker
    })()

    workerPromise.catch(() => {
      workerPromise = null
    })
  }

  return workerPromise
}

export async function enrichCuesWithHardSubtitles(
  file: File,
  cues: SubtitleCue[],
  onStatus?: StatusCallback,
) {
  const targets = buildSubtitleTargets(cues)
  if (targets.length === 0) {
    return { cues, recognizedCount: 0 }
  }

  const { video, cleanup } = createVideoFromFile(file)
  const recognizedByBucket = new Map<number, string>()
  const recognizedByCue = new Map<SubtitleCue, string>()

  try {
    await waitForVideoReady(video)
    const worker = await getWorker(onStatus)

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]
      const bucket = bucketSampleTime(target.sampleMs)
      onStatus?.(`尝试识别画面底部中文字幕…${index + 1}/${targets.length}`)

      let recognized = recognizedByBucket.get(bucket)
      if (!recognized) {
        await seekVideo(video, target.sampleMs)
        const canvas = renderSubtitleRegion(video)
        const result = await worker.recognize(canvas)
        recognized = pickBestChineseLine(result.data?.text ?? '')
        recognizedByBucket.set(bucket, recognized)
      }

      const jaText = target.cue.jaText ?? target.cue.text ?? ''
      if (isUsableChineseSubtitle(jaText, recognized)) {
        recognizedByCue.set(target.cue, recognized)
      }
    }

    if (recognizedByCue.size === 0) {
      return { cues, recognizedCount: 0 }
    }

    onStatus?.(`已从画面底部识别出 ${recognizedByCue.size} 条中文字幕`)
    return {
      cues: cues.map((cue) => {
        const recognized = recognizedByCue.get(cue)
        if (!recognized) {
          return cue
        }

        return {
          ...cue,
          zhText: recognized,
        }
      }),
      recognizedCount: recognizedByCue.size,
    }
  } catch (error) {
    console.warn('Failed to read hard subtitles from video frames.', error)
    return { cues, recognizedCount: 0 }
  } finally {
    cleanup()
  }
}
