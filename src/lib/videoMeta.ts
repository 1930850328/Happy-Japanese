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
      <circle cx="92" cy="92" r="58" fill="rgba(255,255,255,0.42)" />
      <circle cx="546" cy="278" r="92" fill="rgba(255,255,255,0.28)" />
      <rect x="44" y="214" width="292" height="98" rx="24" fill="rgba(255,255,255,0.76)" />
      <text x="48" y="78" fill="#815848" font-size="18" font-family="sans-serif">${safeTheme}</text>
      <text x="60" y="258" fill="#4b362d" font-size="30" font-family="sans-serif">${safeTitle}</text>
      <text x="60" y="290" fill="#866457" font-size="16" font-family="sans-serif">Local Original Study Clip</text>
    </svg>
  `
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function captureVideoCover(
  video: HTMLVideoElement,
  title: string,
  theme: string,
  durationMs: number,
) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const context = canvas.getContext('2d')
    if (!context) {
      return createCoverSvg(title, theme)
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    context.fillStyle = 'rgba(20, 14, 12, 0.14)'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = 'rgba(255, 252, 249, 0.92)'
    context.fillRect(26, canvas.height - 156, Math.min(canvas.width - 52, 430), 106)
    context.fillStyle = '#4f382f'
    context.font = '600 34px sans-serif'
    context.fillText(title, 50, canvas.height - 96)
    context.fillStyle = '#866457'
    context.font = '22px sans-serif'
    context.fillText(
      `${theme} · ${Math.max(10, Math.round(durationMs / 1000))} 秒`,
      50,
      canvas.height - 58,
    )
    return canvas.toDataURL('image/jpeg', 0.9)
  } catch {
    return createCoverSvg(title, theme)
  }
}

export function readVideoMeta(file: File, title: string, theme: string) {
  return new Promise<{ durationMs: number; cover: string }>((resolve) => {
    const objectUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    let durationMs = 30000
    let settled = false
    let timeoutId = 0

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
      const targetTime = Math.max(0.15, Math.min(video.duration / 3 || 0.6, 1.2))
      timeoutId = window.setTimeout(() => {
        finalize(createCoverSvg(title, theme))
      }, 1400)

      try {
        video.currentTime = Number.isFinite(targetTime) ? targetTime : 0.6
      } catch {
        finalize(createCoverSvg(title, theme))
      }
    }

    video.onseeked = () => {
      finalize(captureVideoCover(video, title, theme, durationMs))
    }

    video.onerror = () => {
      finalize(createCoverSvg(title, theme))
    }
  })
}

