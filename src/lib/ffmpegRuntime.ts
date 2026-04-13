import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'
import type { FFmpeg } from '@ffmpeg/ffmpeg'

type StatusCallback = (message: string) => void
type FetchFile = (file?: string | File | Blob) => Promise<Uint8Array>

interface SharedFFmpeg {
  ffmpeg: FFmpeg
  fetchFile: FetchFile
}

let sharedPromise: Promise<SharedFFmpeg> | null = null

export async function getSharedFFmpeg(
  onStatus?: StatusCallback,
  loadingMessage = '正在准备视频处理引擎…',
) {
  if (!sharedPromise) {
    sharedPromise = (async () => {
      onStatus?.(loadingMessage)

      const [{ FFmpeg }, { fetchFile }] = await Promise.all([
        import('@ffmpeg/ffmpeg'),
        import('@ffmpeg/util'),
      ])

      const ffmpeg = new FFmpeg()
      await ffmpeg.load({
        coreURL,
        wasmURL,
      })

      return {
        ffmpeg,
        fetchFile,
      }
    })().catch((error) => {
      sharedPromise = null
      throw error
    })
  }

  return sharedPromise
}

export function resetSharedFFmpeg() {
  sharedPromise = null
}
