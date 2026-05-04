import { isUsableChineseSubtitle } from './chineseTranslation'
import type { SubtitleCue } from './subtitles'

type StatusCallback = (message: string) => void

interface OcrWorker {
  setParameters(params: Record<string, unknown>): Promise<unknown>
  recognize(
    image: HTMLCanvasElement,
    options?: Record<string, unknown>,
  ): Promise<{ data?: { confidence?: number; text?: string } }>
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
    SINGLE_LINE: string
  }
}

interface SubtitleTarget {
  cue: SubtitleCue
  sampleMs: number
}

const OCR_OUTPUT_WIDTH = 1800
const OCR_CACHE_BUCKET_MS = 800
const OCR_MIN_CONFIDENT_TEXT_LENGTH = 4
const OCR_MIN_CONFIDENCE = 35
const OCR_COMMON_CHAR_MIN_RATIO = 0.32
const OCR_BLACKLIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789<>|/\\\\[]{}=_~@#$%^&*'
const COMMON_SUBTITLE_CHARS =
  '我你他她它们这那哪就样和的是了在有不没吗吧呢啊呀着过给把被从到里上下面中为让但可会能要想说看听来去出见遇知做还都很也再又只真好坏多小大前后现今明天时分秒点自已己然所以因为如果怎么什么为什么谁与同向对等'

interface OcrCrop {
  leftRatio: number
  name: string
  topRatio: number
  widthRatio: number
  heightRatio: number
}

interface RecognizedLine {
  confidence: number
  score: number
  text: string
  variant: string
}

const OCR_CROPS: OcrCrop[] = [
  {
    name: 'bottom-tight',
    leftRatio: 0.08,
    topRatio: 0.78,
    widthRatio: 0.84,
    heightRatio: 0.16,
  },
  {
    name: 'bottom-wide',
    leftRatio: 0.04,
    topRatio: 0.74,
    widthRatio: 0.92,
    heightRatio: 0.24,
  },
  {
    name: 'bottom-lower',
    leftRatio: 0.04,
    topRatio: 0.82,
    widthRatio: 0.92,
    heightRatio: 0.14,
  },
]

let workerPromise: Promise<OcrWorker> | null = null

function countChineseCharacters(input: string) {
  return (input.match(/[\u4e00-\u9fff]/gu) || []).length
}

function countCommonSubtitleCharacters(input: string) {
  return Array.from(input).filter((char) => COMMON_SUBTITLE_CHARS.includes(char)).length
}

function countAsciiNoise(input: string) {
  return (input.match(/[A-Za-z0-9<>|/\\[\]{}=_~@#$%^&*]/gu) || []).length
}

function countJapaneseKana(input: string) {
  return (input.match(/[\u3040-\u30ff]/gu) || []).length
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
    .replace(/[，。！？、：“”‘’《》（）【】；：,.!?'"()]/g, '')
    .replace(/\s+/g, '')
    .replace(/我[束東柬]/gu, '我就')
    .replace(/这(?:人)?[梓祥]/gu, '这样')
    .replace(/岛[旧曰日]/gu, '岛村')
    .replace(/相遇[也巴巳己]/gu, '相遇了')
    .trim()
}

function scoreChineseLine(line: string, confidence: number) {
  const chineseCount = countChineseCharacters(line)
  if (chineseCount < OCR_MIN_CONFIDENT_TEXT_LENGTH) {
    return null
  }

  const asciiNoise = countAsciiNoise(line)
  const kanaNoise = countJapaneseKana(line)
  const nonChineseNoise = Array.from(line).length - chineseCount - asciiNoise - kanaNoise
  const commonCount = countCommonSubtitleCharacters(line)
  const commonRatio = commonCount / Math.max(1, chineseCount)

  if (asciiNoise > 0 || kanaNoise > 0 || nonChineseNoise > 1) {
    return null
  }

  if (commonRatio < OCR_COMMON_CHAR_MIN_RATIO) {
    return null
  }

  if (Number.isFinite(confidence) && confidence > 0 && confidence < OCR_MIN_CONFIDENCE) {
    return null
  }

  return chineseCount * 14 + commonRatio * 60 + Math.max(0, confidence) * 0.25
}

function pickBestChineseLine(rawText: string, confidence = 0, variant = 'unknown'): RecognizedLine | null {
  const candidates = rawText
    .split('\n')
    .map(normalizeHardSubtitleText)
    .filter(Boolean)
    .map((line) => {
      const score = scoreChineseLine(line, confidence)
      return score === null
        ? null
        : {
            confidence,
            score,
            text: line,
            variant,
          }
    })
    .filter((line): line is RecognizedLine => line !== null)
    .sort((left, right) => right.score - left.score)

  return candidates[0] ?? null
}

function isReliableHardSubtitle(
  japaneseText: string,
  candidate: RecognizedLine | null,
): candidate is RecognizedLine {
  return candidate !== null && isUsableChineseSubtitle(japaneseText, candidate.text)
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

function hasBrightNeighbor(mask: Uint8Array, width: number, height: number, x: number, y: number) {
  const radius = 2
  const minX = Math.max(0, x - radius)
  const maxX = Math.min(width - 1, x + radius)
  const minY = Math.max(0, y - radius)
  const maxY = Math.min(height - 1, y + radius)

  for (let checkY = minY; checkY <= maxY; checkY += 1) {
    for (let checkX = minX; checkX <= maxX; checkX += 1) {
      if (mask[checkY * width + checkX] === 1) {
        return true
      }
    }
  }

  return false
}

function cloneCanvas(canvas: HTMLCanvasElement) {
  const copy = document.createElement('canvas')
  copy.width = canvas.width
  copy.height = canvas.height
  const context = copy.getContext('2d')
  if (!context) {
    throw new Error('硬字幕 OCR 无法初始化画布')
  }

  context.drawImage(canvas, 0, 0)
  return copy
}

function createSubtitleMaskCanvas(source: HTMLCanvasElement, includeOutline: boolean) {
  const canvas = cloneCanvas(source)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('硬字幕 OCR 无法初始化画布')
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const { data } = imageData
  const brightMask = new Uint8Array(canvas.width * canvas.height)

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index]
    const green = data[index + 1]
    const blue = data[index + 2]
    const maxChannel = Math.max(red, green, blue)
    const minChannel = Math.min(red, green, blue)
    const saturation = maxChannel - minChannel
    const luma = red * 0.299 + green * 0.587 + blue * 0.114
    const pixelIndex = index / 4

    if (luma > 150 && saturation < 120) {
      brightMask[pixelIndex] = 1
    }
  }

  for (let index = 0; index < data.length; index += 4) {
    const pixelIndex = index / 4
    const x = pixelIndex % canvas.width
    const y = Math.floor(pixelIndex / canvas.width)
    const red = data[index]
    const green = data[index + 1]
    const blue = data[index + 2]
    const luma = red * 0.299 + green * 0.587 + blue * 0.114
    const isSubtitleFill = brightMask[pixelIndex] === 1
    const isSubtitleOutline =
      includeOutline && luma < 125 && hasBrightNeighbor(brightMask, canvas.width, canvas.height, x, y)
    const value = isSubtitleFill || isSubtitleOutline ? 0 : 255

    data[index] = value
    data[index + 1] = value
    data[index + 2] = value
    data[index + 3] = 255
  }

  context.putImageData(imageData, 0, 0)
  return canvas
}

function renderSubtitleRegions(video: HTMLVideoElement) {
  const sourceWidth = video.videoWidth || 1280
  const sourceHeight = video.videoHeight || 720
  const variants: Array<{ canvas: HTMLCanvasElement; name: string }> = []

  for (const crop of OCR_CROPS) {
    const sourceLeft = Math.round(sourceWidth * crop.leftRatio)
    const sourceTop = Math.round(sourceHeight * crop.topRatio)
    const sourceCropWidth = Math.max(120, Math.round(sourceWidth * crop.widthRatio))
    const sourceCropHeight = Math.max(
      80,
      Math.min(sourceHeight - sourceTop, Math.round(sourceHeight * crop.heightRatio)),
    )
    const outputHeight = Math.max(80, Math.round((OCR_OUTPUT_WIDTH * sourceCropHeight) / sourceCropWidth))

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
      sourceLeft,
      sourceTop,
      sourceCropWidth,
      sourceCropHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    )

    variants.push({ canvas: cloneCanvas(canvas), name: `${crop.name}-raw` })
    variants.push({ canvas: createSubtitleMaskCanvas(canvas, false), name: `${crop.name}-fill` })
    variants.push({ canvas: createSubtitleMaskCanvas(canvas, true), name: `${crop.name}-outline` })
  }

  return variants
}

async function recognizeHardSubtitle(worker: OcrWorker, video: HTMLVideoElement) {
  let best: RecognizedLine | null = null

  for (const variant of renderSubtitleRegions(video)) {
    const result = await worker.recognize(variant.canvas)
    const candidate = pickBestChineseLine(
      result.data?.text ?? '',
      Number(result.data?.confidence ?? 0),
      variant.name,
    )

    if (candidate && (!best || candidate.score > best.score)) {
      best = candidate
    }
  }

  return best
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
        tessedit_pageseg_mode: tesseract.PSM.SINGLE_LINE,
        preserve_interword_spaces: '0',
        user_defined_dpi: '220',
        tessedit_char_blacklist: OCR_BLACKLIST,
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
  const recognizedByBucket = new Map<number, RecognizedLine | null>()
  const recognizedByCue = new Map<SubtitleCue, string>()

  try {
    await waitForVideoReady(video)
    const worker = await getWorker(onStatus)

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]
      const bucket = bucketSampleTime(target.sampleMs)
      onStatus?.(`尝试识别画面底部中文字幕…${index + 1}/${targets.length}`)

      let recognized = recognizedByBucket.get(bucket)
      if (recognized === undefined) {
        await seekVideo(video, target.sampleMs)
        recognized = await recognizeHardSubtitle(worker, video)
        recognizedByBucket.set(bucket, recognized)
      }

      const jaText = target.cue.jaText ?? target.cue.text ?? ''
      if (isReliableHardSubtitle(jaText, recognized)) {
        recognizedByCue.set(target.cue, recognized.text)
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
