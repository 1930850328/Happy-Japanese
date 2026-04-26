function createCoverSvg(title: string, theme: string) {
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const safeTheme = theme.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffd7c2" />
          <stop offset="50%" stop-color="#fff2d7" />
          <stop offset="100%" stop-color="#d7ecdf" />
        </linearGradient>
      </defs>
      <rect width="640" height="360" rx="30" fill="url(#bg)" />
      <circle cx="110" cy="92" r="58" fill="rgba(255,255,255,0.34)" />
      <circle cx="540" cy="268" r="96" fill="rgba(255,255,255,0.22)" />
      <rect x="44" y="42" width="160" height="40" rx="20" fill="rgba(255,255,255,0.62)" />
      <text x="60" y="68" fill="#815848" font-size="18" font-family="sans-serif">${safeTheme}</text>
      <rect x="44" y="238" width="250" height="80" rx="24" fill="rgba(255,255,255,0.18)" />
      <text x="60" y="286" fill="rgba(75,54,45,0.68)" font-size="18" font-family="sans-serif">${safeTitle.slice(0, 18)}</text>
    </svg>
  `

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function getDefaultCoverTargets(durationMs: number) {
  const maxTarget = Math.max(150, durationMs - 150)
  const earlyTarget = Math.min(Math.max(durationMs * 0.08, 6000), maxTarget)
  const midTarget = Math.min(Math.max(durationMs * 0.16, 12000), maxTarget)
  const lateTarget = Math.min(Math.max(durationMs * 0.28, 18000), maxTarget)

  return [...new Set([earlyTarget, midTarget, lateTarget].map((value) => Math.round(value)))]
}

function isLowInfoFrame(context: CanvasRenderingContext2D, width: number, height: number) {
  try {
    const sampleWidth = Math.min(24, width)
    const sampleHeight = Math.min(24, height)
    const imageData = context.getImageData(0, 0, sampleWidth, sampleHeight).data

    let total = 0
    for (let index = 0; index < imageData.length; index += 4) {
      const red = imageData[index]
      const green = imageData[index + 1]
      const blue = imageData[index + 2]
      total += red * 0.299 + green * 0.587 + blue * 0.114
    }

    const averageLuma = total / Math.max(1, imageData.length / 4)
    return averageLuma < 28
  } catch {
    return false
  }
}

const COVER_MAX_WIDTH = 640
const COVER_MAX_HEIGHT = 360
const COVER_JPEG_QUALITY = 0.76

function getCoverSize(sourceWidth: number, sourceHeight: number) {
  const width = sourceWidth || 1280
  const height = sourceHeight || 720
  const scale = Math.min(1, COVER_MAX_WIDTH / width, COVER_MAX_HEIGHT / height)

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function captureVideoCover(video: HTMLVideoElement, title: string, theme: string) {
  try {
    const sourceWidth = video.videoWidth || 1280
    const sourceHeight = video.videoHeight || 720
    const coverSize = getCoverSize(sourceWidth, sourceHeight)
    const canvas = document.createElement('canvas')
    canvas.width = coverSize.width
    canvas.height = coverSize.height
    const context = canvas.getContext('2d')
    if (!context) {
      return { cover: createCoverSvg(title, theme), lowInfo: false }
    }

    context.drawImage(video, 0, 0, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
    const lowInfo = isLowInfoFrame(context, canvas.width, canvas.height)
    return {
      cover: canvas.toDataURL('image/jpeg', COVER_JPEG_QUALITY),
      lowInfo,
    }
  } catch {
    return { cover: createCoverSvg(title, theme), lowInfo: false }
  }
}

function loadVideoCoverAt(file: File, title: string, theme: string, targetMs?: number) {
  return new Promise<{ durationMs: number; cover: string }>((resolve) => {
    const objectUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    let durationMs = 30000
    let settled = false
    let timeoutId = 0
    let seekTargets: number[] = []
    let seekIndex = 0

    const cleanup = () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId)
      }
      video.pause()
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(objectUrl)
    }

    const finalize = (cover: string) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve({ durationMs, cover })
    }

    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.src = objectUrl

    video.onloadedmetadata = () => {
      durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 30000
      seekTargets =
        typeof targetMs === 'number'
          ? [Math.max(150, Math.min(targetMs, Math.max(150, durationMs - 150)))]
          : getDefaultCoverTargets(durationMs)
      const nextTargetMs =
        typeof targetMs === 'number'
          ? seekTargets[0]
          : seekTargets[0] ?? Math.max(150, Math.min(durationMs / 3 || 600, 1200))

      timeoutId = window.setTimeout(() => {
        finalize(createCoverSvg(title, theme))
      }, 1400)

      try {
        video.currentTime = nextTargetMs / 1000
      } catch {
        finalize(createCoverSvg(title, theme))
      }
    }

    video.onseeked = () => {
      const { cover, lowInfo } = captureVideoCover(video, title, theme)
      if (lowInfo && seekIndex < seekTargets.length - 1) {
        seekIndex += 1
        try {
          video.currentTime = seekTargets[seekIndex] / 1000
          return
        } catch {
          finalize(cover)
          return
        }
      }

      finalize(cover)
    }

    video.onerror = () => {
      finalize(createCoverSvg(title, theme))
    }
  })
}

export async function readVideoMeta(file: File, title: string, theme: string) {
  return loadVideoCoverAt(file, title, theme)
}

export async function readVideoCoverAt(
  file: File,
  title: string,
  theme: string,
  targetMs: number,
) {
  const result = await loadVideoCoverAt(file, title, theme, targetMs)
  return result.cover
}
