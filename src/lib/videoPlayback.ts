const FFMPEG_CORE_VERSION = '0.12.10'
const FFMPEG_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`

type StatusCallback = (message: string) => void

let ffmpegPromise: Promise<{
  ffmpeg: any
  fetchFile: (file: File | Blob) => Promise<Uint8Array>
}> | null = null

async function getFFmpeg(onStatus?: StatusCallback) {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      onStatus?.('正在准备视频兼容引擎…')
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

export async function probeVideoPlayback(file: File | Blob, timeoutMs = 5000) {
  const objectUrl = URL.createObjectURL(file)
  const video = document.createElement('video')

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

      timeoutId = window.setTimeout(() => finalize(false), timeoutMs)
      video.preload = 'auto'
      video.muted = true
      video.playsInline = true
      video.src = objectUrl
      video.onloadeddata = () => finalize(true)
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

  const { ffmpeg, fetchFile } = await getFFmpeg(onStatus)
  const inputExt = file.name.split('.').pop() || 'mkv'
  const inputName = `playback-input-${crypto.randomUUID()}.${inputExt}`
  const outputName = `playback-output-${crypto.randomUUID()}.mp4`
  const outputBaseName = `${getOutputBaseName(file.name)}-browser.mp4`
  const handleProgress = ({ progress }: { progress: number }) => {
    onStatus?.(
      `正在转换为浏览器兼容格式… ${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`,
    )
  }

  onStatus?.('原视频浏览器无法直接播放，正在转换为兼容格式… 0%')
  await ffmpeg.writeFile(inputName, await fetchFile(file))
  ffmpeg.on('progress', handleProgress)

  try {
    const code = await ffmpeg.exec([
      '-i',
      inputName,
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
      outputName,
    ])

    if (code !== 0) {
      throw new Error('视频兼容转换失败，当前文件无法转成浏览器可播放格式。')
    }

    const data = await ffmpeg.readFile(outputName)
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    const convertedFile = createFileFromBytes(bytes, outputBaseName, 'video/mp4')
    const convertedPlayable = await probeVideoPlayback(convertedFile, 8000)

    if (!convertedPlayable) {
      throw new Error('视频已经完成转码，但浏览器仍无法播放这个文件。')
    }

    onStatus?.('已转换为浏览器兼容格式 100%')
    return {
      file: convertedFile,
      converted: true,
    }
  } finally {
    ffmpeg.off('progress', handleProgress)
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)])
  }
}
