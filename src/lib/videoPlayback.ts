type StatusCallback = (message: string) => void

function toBinaryBytes(data: Uint8Array | ArrayBuffer | string) {
  if (data instanceof Uint8Array) {
    return data
  }

  if (typeof data === 'string') {
    return new TextEncoder().encode(data)
  }

  return new Uint8Array(data)
}

function getOutputBaseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '') || 'converted-video'
}

function createFileFromBytes(bytes: Uint8Array, name: string, type: string) {
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer

  return new File([arrayBuffer], name, {
    type,
    lastModified: Date.now(),
  })
}

function formatProgress(progress: number) {
  if (!Number.isFinite(progress)) {
    return '0%'
  }

  return `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`
}

function toFfmpegTimestamp(milliseconds: number) {
  return (Math.max(0, milliseconds) / 1000).toFixed(3)
}

async function runFfmpegJob(
  file: File,
  outputName: string,
  args: string[],
  onStatus?: StatusCallback,
  progressPrefix?: string,
) {
  const { getSharedFFmpeg } = await import('./ffmpegRuntime')
  const { ffmpeg, fetchFile } = await getSharedFFmpeg(onStatus, '正在准备视频处理引擎…')
  const inputExt = file.name.split('.').pop() || 'mkv'
  const inputName = `playback-input-${crypto.randomUUID()}.${inputExt}`

  let latestProgress = 0
  const handleProgress = ({ progress }: { progress: number }) => {
    if (!Number.isFinite(progress)) {
      return
    }

    latestProgress = Math.max(latestProgress, Math.max(0, Math.min(1, progress)))
    if (progressPrefix) {
      onStatus?.(`${progressPrefix}${formatProgress(latestProgress)}`)
    }
  }

  let heartbeatId = 0
  await ffmpeg.writeFile(inputName, await fetchFile(file))
  ffmpeg.on('progress', handleProgress)

  if (progressPrefix) {
    onStatus?.(`${progressPrefix}0%`)
    heartbeatId = window.setInterval(() => {
      latestProgress = Math.min(0.95, latestProgress + 0.03)
      onStatus?.(`${progressPrefix}${formatProgress(latestProgress)}`)
    }, 1200)
  }

  try {
    const code = await ffmpeg.exec(['-i', inputName, ...args, outputName])
    if (code !== 0) {
      throw new Error('当前视频片段处理失败，请换一个更通用的编码格式后再试。')
    }

    if (progressPrefix) {
      onStatus?.(`${progressPrefix}100%`)
    }

    const data = await ffmpeg.readFile(outputName)
    return toBinaryBytes(data)
  } finally {
    if (heartbeatId) {
      window.clearInterval(heartbeatId)
    }
    ffmpeg.off('progress', handleProgress)
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)])
  }
}

export async function probeVideoPlayback(file: File | Blob, timeoutMs = 5000) {
  const objectUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  const canvas = document.createElement('canvas')

  try {
    const result = await new Promise<boolean>((resolve) => {
      let settled = false
      let timeoutId = 0

      const finalize = (value: boolean) => {
        if (settled) {
          return
        }

        settled = true
        if (timeoutId) {
          window.clearTimeout(timeoutId)
        }
        resolve(value)
      }

      const canDrawFrame = () => {
        if (video.videoWidth <= 0 || video.videoHeight <= 0) {
          return false
        }

        try {
          canvas.width = Math.min(video.videoWidth, 4)
          canvas.height = Math.min(video.videoHeight, 4)
          const context = canvas.getContext('2d')
          if (!context) {
            return false
          }

          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          return true
        } catch {
          return false
        }
      }

      const validateFrame = () => {
        if (canDrawFrame()) {
          finalize(true)
          return
        }

        if (video.readyState >= 2 && (video.videoWidth === 0 || video.videoHeight === 0)) {
          finalize(false)
        }
      }

      timeoutId = window.setTimeout(() => finalize(false), timeoutMs)
      video.preload = 'auto'
      video.muted = true
      video.playsInline = true
      video.src = objectUrl
      video.onloadedmetadata = () => {
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          finalize(false)
          return
        }

        const durationSec =
          Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0.8
        const targetSec = Math.max(0.05, Math.min(durationSec / 3, 1))

        try {
          if (Math.abs(video.currentTime - targetSec) > 0.05) {
            video.currentTime = targetSec
          } else {
            validateFrame()
          }
        } catch {
          validateFrame()
        }
      }
      video.onloadeddata = validateFrame
      video.onseeked = validateFrame
      video.onerror = () => finalize(false)
      video.load()
    })

    return result
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(objectUrl)
  }
}

export async function ensureBrowserPlayableVideo(file: File, onStatus?: StatusCallback) {
  onStatus?.('正在检查视频播放兼容性…')
  const alreadyPlayable = await probeVideoPlayback(file)
  if (alreadyPlayable) {
    return {
      file,
      converted: false,
    }
  }

  onStatus?.('原视频浏览器无法直接播放，正在转成兼容格式…0%')
  const outputName = `playback-output-${crypto.randomUUID()}.mp4`
  const outputBaseName = `${getOutputBaseName(file.name)}-browser.mp4`

  const bytes = await runFfmpegJob(
    file,
    outputName,
    [
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
    ],
    onStatus,
    '正在转成浏览器兼容格式…',
  )

  const convertedFile = createFileFromBytes(bytes, outputBaseName, 'video/mp4')
  const convertedPlayable = await probeVideoPlayback(convertedFile, 8000)

  if (!convertedPlayable) {
    throw new Error('视频已经完成转码，但浏览器仍然无法正常播放这个文件。')
  }

  onStatus?.('视频已转成浏览器兼容格式')
  return {
    file: convertedFile,
    converted: true,
  }
}

export async function extractBrowserPlayableClip(
  file: File,
  startMs: number,
  endMs: number,
  onStatus?: StatusCallback,
) {
  const clipDurationMs = Math.max(300, endMs - startMs)
  onStatus?.('正在截取当前学习片段…0%')

  const outputName = `playback-clip-${crypto.randomUUID()}.mp4`
  const outputBaseName = `${getOutputBaseName(file.name)}-${Math.round(startMs)}-${Math.round(endMs)}.mp4`

  const bytes = await runFfmpegJob(
    file,
    outputName,
    [
      '-ss',
      toFfmpegTimestamp(startMs),
      '-t',
      toFfmpegTimestamp(clipDurationMs),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
    ],
    onStatus,
    '正在截取当前学习片段…',
  )

  const clipFile = createFileFromBytes(bytes, outputBaseName, 'video/mp4')
  const clipPlayable = await probeVideoPlayback(clipFile, 8000)

  if (!clipPlayable) {
    throw new Error('学习片段已经切出来了，但浏览器还是没法正常播放。')
  }

  onStatus?.('学习片段已准备完成')
  return {
    file: clipFile,
    converted: true,
  }
}

export async function extractBrowserPlayableAudioClip(
  file: File,
  startMs: number,
  endMs: number,
  onStatus?: StatusCallback,
) {
  const clipDurationMs = Math.max(240, endMs - startMs)
  onStatus?.('正在准备片中原声音频…0%')

  const outputName = `playback-audio-${crypto.randomUUID()}.m4a`
  const outputBaseName = `${getOutputBaseName(file.name)}-${Math.round(startMs)}-${Math.round(endMs)}.m4a`

  const bytes = await runFfmpegJob(
    file,
    outputName,
    [
      '-ss',
      toFfmpegTimestamp(startMs),
      '-t',
      toFfmpegTimestamp(clipDurationMs),
      '-vn',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
    ],
    onStatus,
    '正在准备片中原声音频…',
  )

  onStatus?.('片中原声音频已准备完成')
  return {
    file: createFileFromBytes(bytes, outputBaseName, 'audio/mp4'),
    converted: true,
  }
}
