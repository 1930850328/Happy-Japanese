import { ensureBrowserPlayableVideo, extractBrowserPlayableClip, probeVideoPlayback } from './videoPlayback'
import type { VideoLesson } from '../types'

type StatusCallback = (message: string) => void

export interface PreparedPlaybackWindow {
  startMs: number
  endMs: number
}

type PreparedPlaybackAsset =
  | {
      kind: 'file'
      file: File
      status: string
      playbackWindow: PreparedPlaybackWindow
    }
  | {
      kind: 'url'
      sourceUrl: string
      status: string
      playbackWindow: PreparedPlaybackWindow
    }

interface PreparePlaybackInput {
  lesson: VideoLesson
  localBlob?: Blob
  localFileName?: string
  onStatus?: StatusCallback
}

const playabilityCache = new Map<string, Promise<boolean>>()
const preparedAssetCache = new Map<string, Promise<PreparedPlaybackAsset>>()

function getSourceFile(localBlob: Blob, localFileName: string | undefined, lesson: VideoLesson) {
  if (localBlob instanceof File) {
    return localBlob
  }

  return new File([localBlob], localFileName || lesson.sourceFileName || `${lesson.id}.mp4`, {
    type: localBlob.type || 'video/mp4',
    lastModified: 0,
  })
}

function getBlobIdentity(blob: Blob, lesson: VideoLesson, localFileName?: string) {
  const fileName =
    localBlobFileName(blob) || localFileName || lesson.sourceFileName || `${lesson.id}.mp4`
  const lastModified = blob instanceof File ? blob.lastModified : 0
  return `${lesson.sourceIdOrBlobKey}:${fileName}:${blob.type}:${blob.size}:${lastModified}`
}

function localBlobFileName(blob: Blob) {
  return blob instanceof File ? blob.name : ''
}

function getLessonClipWindow(lesson: VideoLesson): PreparedPlaybackWindow {
  const startMs = lesson.clipStartMs ?? 0
  const endMs = lesson.clipEndMs ?? startMs + lesson.durationMs

  return {
    startMs,
    endMs,
  }
}

function hasSourceClipWindow(lesson: VideoLesson) {
  return typeof lesson.clipStartMs === 'number' || typeof lesson.clipEndMs === 'number'
}

function isLikelyBrowserPlayable(file: File) {
  if (typeof document === 'undefined') {
    return false
  }

  const video = document.createElement('video')
  const mime = file.type.trim().toLowerCase()
  if (mime) {
    const normalizedMime = mime === 'video/quicktime' ? 'video/mp4' : mime
    if (video.canPlayType(normalizedMime) !== '') {
      return true
    }
  }

  return /\.(mp4|m4v|webm|ogv|ogg)$/i.test(file.name)
}

async function getCachedPlayability(cacheKey: string, file: File) {
  let task = playabilityCache.get(cacheKey)
  if (!task) {
    task = probeVideoPlayback(file)
    playabilityCache.set(cacheKey, task)
  }

  try {
    return await task
  } catch (error) {
    playabilityCache.delete(cacheKey)
    throw error
  }
}

async function getCachedPreparedAsset(
  cacheKey: string,
  factory: () => Promise<PreparedPlaybackAsset>,
) {
  let task = preparedAssetCache.get(cacheKey)
  if (!task) {
    task = factory().catch((error) => {
      preparedAssetCache.delete(cacheKey)
      throw error
    })
    preparedAssetCache.set(cacheKey, task)
  }

  return task
}

export function resolveLessonPlaybackUrl(lesson: VideoLesson) {
  return lesson.sourceUrl || lesson.sourceIdOrBlobKey
}

export async function preparePlaybackSource({
  lesson,
  localBlob,
  localFileName,
  onStatus,
}: PreparePlaybackInput): Promise<PreparedPlaybackAsset> {
  const playbackWindow = getLessonClipWindow(lesson)

  if (!localBlob) {
    return {
      kind: 'url',
      sourceUrl: resolveLessonPlaybackUrl(lesson),
      status: '',
      playbackWindow,
    }
  }

  const sourceFile = getSourceFile(localBlob, localFileName, lesson)
  const blobKey = getBlobIdentity(localBlob, lesson, localFileName)
  const sourcePlayable =
    isLikelyBrowserPlayable(sourceFile) ||
    (await getCachedPlayability(`${blobKey}:playable`, sourceFile))

  if (sourcePlayable) {
    onStatus?.('视频已准备完成')
    return {
      kind: 'file',
      file: sourceFile,
      status: '视频已准备完成',
      playbackWindow: hasSourceClipWindow(lesson)
        ? playbackWindow
        : {
            startMs: 0,
            endMs: lesson.durationMs,
          },
    }
  }

  if (hasSourceClipWindow(lesson)) {
    onStatus?.('正在准备当前学习片段…')
    return getCachedPreparedAsset(
      `${blobKey}:clip:${playbackWindow.startMs}:${playbackWindow.endMs}`,
      async () => {
        const prepared = await extractBrowserPlayableClip(
          sourceFile,
          playbackWindow.startMs,
          playbackWindow.endMs,
          onStatus,
        )

        return {
          kind: 'file',
          file: prepared.file,
          status: '当前学习切片已准备完成',
          playbackWindow: {
            startMs: 0,
            endMs: lesson.durationMs,
          },
        }
      },
    )
  }

  onStatus?.('原视频浏览器无法直接播放，正在转成兼容格式…')
  return getCachedPreparedAsset(`${blobKey}:full`, async () => {
    const prepared = await ensureBrowserPlayableVideo(sourceFile, onStatus)

    return {
      kind: 'file',
      file: prepared.file,
      status: prepared.converted ? '已转成浏览器兼容格式，正在准备播放' : '视频已准备完成',
      playbackWindow: {
        startMs: 0,
        endMs: lesson.durationMs,
      },
    }
  })
}
