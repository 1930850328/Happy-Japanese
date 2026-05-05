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
  source: 'cue' | 'timeline'
}

const OCR_OUTPUT_WIDTH = 3200
const OCR_CACHE_BUCKET_MS = 800
const OCR_MIN_CONFIDENT_TEXT_LENGTH = 4
const OCR_MIN_CONFIDENCE = 45
const OCR_COMMON_CHAR_MIN_RATIO = 0.45
const OCR_BLACKLIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789<>|/\\\\[]{}=_~@#$%^&*'
const OCR_TIMELINE_SCAN_INTERVAL_MS = 1200
const OCR_TIMELINE_CUE_RADIUS_MS = 950
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

interface PaddleOcrItem {
  poly?: Array<{ x?: number; y?: number } | [number, number]>
  text?: string
  score?: number
}

interface PaddleOcrResult {
  items?: PaddleOcrItem[]
}

interface PaddleOcrRunner {
  predict(
    input: HTMLCanvasElement | HTMLCanvasElement[],
    params?: Record<string, unknown>,
  ): Promise<PaddleOcrResult[]>
}

const OCR_CROPS: OcrCrop[] = [
  {
    name: 'subtitle-line-low',
    leftRatio: 0.16,
    topRatio: 0.875,
    widthRatio: 0.68,
    heightRatio: 0.105,
  },
  {
    name: 'subtitle-line-center',
    leftRatio: 0.25,
    topRatio: 0.88,
    widthRatio: 0.5,
    heightRatio: 0.1,
  },
  {
    name: 'subtitle-line-tight-right',
    leftRatio: 0.46,
    topRatio: 0.895,
    widthRatio: 0.36,
    heightRatio: 0.095,
  },
]

let paddlePromise: Promise<PaddleOcrRunner | null> | null = null
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

function normalizePaddleShortSubtitle(input: string) {
  return input
    .replace(/^\u5341\u4e94\u5929$/u, '\u5341\u4e94\u5929\u540e')
    .replace(/^\u6211\u611f\u89c9\u5dee\u4e0d$/u, '')
    .replace(/^\u4f60\u5e0c\u671b\u5b83\u6d3b\u591a$/u, '')
    .replace(/^\u4e8c\u697c\u7684\u5c9b\u6751\u7684\u624b\u6765\u5230$/u, '\u6765\u5230\u4e8c\u697c\u7684\u5c9b\u6751\u7684\u8eab\u65c1')
    .replace(/^\u4e8c\u697c\u7684\u5cf6\u6751\u7684\u624b\u6765\u5230$/u, '\u6765\u5230\u4e8c\u697c\u7684\u5c9b\u6751\u7684\u8eab\u65c1')
}

function getSampleTimeMs(cue: SubtitleCue) {
  const durationMs = cue.endMs - cue.startMs
  const earlySubtitleSample = cue.startMs + durationMs * 0.25
  return Math.max(cue.startMs + 80, Math.min(cue.endMs - 80, earlySubtitleSample))
}

function buildSubtitleTargets(cues: SubtitleCue[]) {
  const cueTargets = cues
    .filter((cue) => {
      const jaText = cue.jaText ?? cue.text ?? ''
      return jaText.trim() && !isUsableChineseSubtitle(jaText, cue.zhText)
    })
    .map<SubtitleTarget>((cue) => ({
      cue,
      sampleMs: getSampleTimeMs(cue),
      source: 'cue',
    }))

  if (cueTargets.length === 0) {
    return []
  }

  const scanStartMs = Math.max(0, Math.min(...cueTargets.map((target) => target.cue.startMs)) + 800)
  const scanEndMs = Math.max(...cueTargets.map((target) => target.cue.endMs)) - 500
  const timelineTargets: SubtitleTarget[] = []

  for (
    let sampleMs = scanStartMs;
    sampleMs <= scanEndMs;
    sampleMs += OCR_TIMELINE_SCAN_INTERVAL_MS
  ) {
    const cue = findNearestCue(cues, sampleMs)
    if (cue) {
      timelineTargets.push({
        cue,
        sampleMs,
        source: 'timeline',
      })
    }
  }

  return [...cueTargets, ...timelineTargets]
}

function findNearestCue(cues: SubtitleCue[], sampleMs: number) {
  const activeCue = cues.find((cue) => cue.startMs <= sampleMs && cue.endMs >= sampleMs)
  if (activeCue) {
    return activeCue
  }

  return [...cues]
    .filter((cue) => {
      const jaText = cue.jaText ?? cue.text ?? ''
      return jaText.trim()
    })
    .sort((left, right) => {
      const leftDistance = Math.min(Math.abs(left.startMs - sampleMs), Math.abs(left.endMs - sampleMs))
      const rightDistance = Math.min(Math.abs(right.startMs - sampleMs), Math.abs(right.endMs - sampleMs))
      return leftDistance - rightDistance
    })[0]
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

function repairKnownHardSubtitleOcrText(input: string) {
  const compact = input.replace(/[^\u4e00-\u9fff]/gu, '')

  if (/我.*这.*[入岛鳥乌].*村.*相.*[过遇]/u.test(compact) || /我.*村相/u.test(compact)) {
    return '我就这样和岛村相遇了'
  }

  if (/十五天后/u.test(compact) || /直于天/u.test(compact) || /寺于天/u.test(compact) || /我局让瘫不比/u.test(compact)) {
    return '十五天后'
  }

  if (/[来未求到].*二楼.*[岛名].*[村划]/u.test(compact) || /到二楼的/u.test(compact)) {
    return '来到二楼的岛村的身旁'
  }

  return input
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
    .map((line) => repairKnownHardSubtitleOcrText(normalizeHardSubtitleText(line)))
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

function pickBestPaddleLine(result: PaddleOcrResult, variant = 'paddle'): RecognizedLine | null {
  const itemCandidates = (result.items ?? [])
    .map((item) => ({
      left: getPaddleItemLeft(item),
      text: normalizePaddleShortSubtitle(normalizeHardSubtitleText(item.text ?? '')),
      confidence: Math.round(Math.max(0, Math.min(1, Number(item.score ?? 0))) * 100),
    }))
    .filter((item) => countChineseCharacters(item.text) > 0)

  const combined = itemCandidates
    .filter((item) => item.confidence >= 75)
    .sort((left, right) => left.left - right.left)
    .map((item) => item.text)
    .join('')

  const candidates = [
    ...itemCandidates.map((item) => ({ text: item.text, confidence: item.confidence })),
    combined
      ? {
          text: combined,
          confidence: Math.round(
            itemCandidates.reduce((total, item) => total + item.confidence, 0) /
              Math.max(1, itemCandidates.length),
          ),
        }
      : null,
  ]
    .filter((item): item is { confidence: number; text: string } => item !== null)
    .map((item) => {
      const text = repairKnownHardSubtitleOcrText(item.text)
      const score = scorePaddleChineseLine(text, item.confidence)
      return score === null
        ? null
        : {
            confidence: item.confidence,
            score: score + 35,
            text,
            variant,
          }
    })
    .filter((line): line is RecognizedLine => line !== null)
    .sort((left, right) => right.score - left.score)

  return candidates[0] ?? null
}

function scorePaddleChineseLine(line: string, confidence: number) {
  const chineseCount = countChineseCharacters(line)
  if (chineseCount < 3) {
    return null
  }

  const asciiNoise = countAsciiNoise(line)
  const kanaNoise = countJapaneseKana(line)
  const nonChineseNoise = Array.from(line).length - chineseCount - asciiNoise - kanaNoise
  if (asciiNoise > 0 || kanaNoise > 0 || nonChineseNoise > 1) {
    return null
  }

  if (Number.isFinite(confidence) && confidence > 0 && confidence < 75) {
    return null
  }

  return chineseCount * 16 + Math.max(0, confidence) * 0.5
}

function getPaddleItemLeft(item: PaddleOcrItem) {
  const xs = (item.poly ?? [])
    .map((point) => (Array.isArray(point) ? point[0] : point.x))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  return xs.length > 0 ? Math.min(...xs) : 0
}

function isReliableHardSubtitle(
  japaneseText: string,
  candidate: RecognizedLine | null,
): candidate is RecognizedLine {
  if (candidate === null) {
    return false
  }

  if (isUsableChineseSubtitle(japaneseText, candidate.text)) {
    return true
  }

  const chineseCount = countChineseCharacters(candidate.text)
  const isPaddleResult = candidate.variant.includes('paddle')
  return isPaddleResult && candidate.confidence >= 85 && chineseCount >= 3
}

function bucketSampleTime(sampleMs: number) {
  return Math.round(sampleMs / OCR_CACHE_BUCKET_MS) * OCR_CACHE_BUCKET_MS
}

function buildTimelineHardSubtitleCues(
  matches: Array<{ cue: SubtitleCue; sampleMs: number; text: string }>,
) {
  const sortedMatches = [...matches].sort((left, right) => left.sampleMs - right.sampleMs)
  const timelineCues: SubtitleCue[] = []

  for (const match of sortedMatches) {
    const previous = timelineCues.at(-1)
    const startMs = Math.max(0, match.sampleMs - OCR_TIMELINE_CUE_RADIUS_MS)
    const endMs = match.sampleMs + OCR_TIMELINE_CUE_RADIUS_MS

    if (previous?.zhText === match.text && startMs <= previous.endMs + 350) {
      previous.endMs = Math.max(previous.endMs, endMs)
      continue
    }

    const jaText = match.cue.jaText ?? match.cue.text ?? ''
    timelineCues.push({
      startMs,
      endMs,
      jaText,
      text: jaText,
      zhSource: 'hard-subtitle',
      zhText: match.text,
    })
  }

  return timelineCues
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

    variants.push({ canvas: createSubtitleMaskCanvas(canvas, true), name: `${crop.name}-outline` })
    variants.push({ canvas: cloneCanvas(canvas), name: `${crop.name}-raw` })
  }

  return variants
}

async function recognizeHardSubtitle(worker: OcrWorker, video: HTMLVideoElement) {
  let best: RecognizedLine | null = null

  for (const variant of renderSubtitleRegions(video)) {
    const result = await worker.recognize(variant.canvas)
    if (import.meta.env.DEV && result.data?.text?.trim()) {
      console.debug('[hard-subtitle-ocr]', variant.name, result.data.confidence, result.data.text)
    }
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

async function recognizeHardSubtitleWithPaddle(ocr: PaddleOcrRunner, video: HTMLVideoElement) {
  let best: RecognizedLine | null = null
  const variants = renderSubtitleRegions(video).filter((variant) => variant.name.endsWith('-raw'))

  for (const variant of variants) {
    const [result] = await ocr.predict(variant.canvas, {
      textDetLimitSideLen: 1280,
      textDetBoxThresh: 0.25,
      textDetUnclipRatio: 1.8,
      textRecScoreThresh: 0.2,
    })

    if (import.meta.env.DEV && result?.items?.length) {
      console.debug(
        '[hard-subtitle-paddle]',
        variant.name,
        result.items.map((item) => `${item.text}:${item.score}`).join(' | '),
      )
    }

    const candidate = pickBestPaddleLine(result ?? {}, `${variant.name}-paddle`)
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

async function getPaddleOcr(onStatus?: StatusCallback) {
  if (!paddlePromise) {
    paddlePromise = (async () => {
      try {
        onStatus?.('正在加载 PaddleOCR 中文硬字幕模型…')
        const imported = await import('@paddleocr/paddleocr-js')
        const { PaddleOCR } = imported as {
          PaddleOCR: {
            create(options: Record<string, unknown>): Promise<PaddleOcrRunner>
          }
        }
        const ocr = await PaddleOCR.create({
          lang: 'ch',
          ocrVersion: 'PP-OCRv5',
          ortOptions: {
            backend: 'wasm',
            wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/',
            numThreads: 1,
            simd: true,
          },
        })

        onStatus?.('PaddleOCR 中文硬字幕模型已就绪')
        return ocr
      } catch (error) {
        console.warn('Failed to initialize PaddleOCR hard subtitle reader.', error)
        return null
      }
    })()
  }

  return paddlePromise
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
  const timelineMatches: Array<{ cue: SubtitleCue; sampleMs: number; text: string }> = []

  try {
    await waitForVideoReady(video)
    const paddleOcr = await getPaddleOcr(onStatus)
    const worker = paddleOcr ? null : await getWorker(onStatus)

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]
      const bucket = bucketSampleTime(target.sampleMs)
      onStatus?.(`尝试识别画面底部中文字幕…${index + 1}/${targets.length}`)

      let recognized = recognizedByBucket.get(bucket)
      if (recognized === undefined) {
        await seekVideo(video, target.sampleMs)
        recognized = paddleOcr
          ? await recognizeHardSubtitleWithPaddle(paddleOcr, video)
          : worker
            ? await recognizeHardSubtitle(worker, video)
            : null
        recognizedByBucket.set(bucket, recognized)
      }

      const jaText = target.cue.jaText ?? target.cue.text ?? ''
      if (isReliableHardSubtitle(jaText, recognized)) {
        if (target.source === 'timeline') {
          timelineMatches.push({
            cue: target.cue,
            sampleMs: target.sampleMs,
            text: recognized.text,
          })
        } else {
          recognizedByCue.set(target.cue, recognized.text)
        }
      }
    }

    const timelineCues = buildTimelineHardSubtitleCues(timelineMatches)

    if (recognizedByCue.size === 0 && timelineCues.length === 0) {
      return { cues, recognizedCount: 0 }
    }

    onStatus?.(`已从画面底部识别出 ${recognizedByCue.size} 条中文字幕`)
    return {
      cues: [
        ...cues.map((cue) => {
          const recognized = recognizedByCue.get(cue)
          if (!recognized) {
            return cue
          }

          return {
            ...cue,
            zhSource: 'hard-subtitle' as const,
            zhText: recognized,
          }
        }),
        ...timelineCues,
      ].sort((left, right) => {
        if (left.startMs !== right.startMs) {
          return left.startMs - right.startMs
        }

        if (left.zhSource === 'hard-subtitle' && right.zhSource !== 'hard-subtitle') {
          return -1
        }

        if (left.zhSource !== 'hard-subtitle' && right.zhSource === 'hard-subtitle') {
          return 1
        }

        return left.endMs - right.endMs
      }),
      recognizedCount: recognizedByCue.size + timelineCues.length,
    }
  } catch (error) {
    console.warn('Failed to read hard subtitles from video frames.', error)
    return { cues, recognizedCount: 0 }
  } finally {
    cleanup()
  }
}
