import { useEffect, useRef, useState } from 'react'

import {
  preparePlaybackSource,
  resolveLessonPlaybackUrl,
  type PreparedPlaybackWindow,
} from '../lib/playbackPreparation'
import type { VideoLesson } from '../types'

interface UsePreparedPlaybackOptions {
  lesson: VideoLesson
  localBlob?: Blob
  localFileName?: string
  enabled?: boolean
}

interface PreparedPlaybackState {
  sourceUrl: string
  preparing: boolean
  status: string
  playbackWindow: PreparedPlaybackWindow
}

function getDefaultPlaybackWindow(lesson: VideoLesson) {
  const clipStartMs = lesson.clipStartMs ?? 0
  const clipEndMs = lesson.clipEndMs ?? clipStartMs + lesson.durationMs

  return {
    startMs: clipStartMs,
    endMs: clipEndMs,
  }
}

export function usePreparedPlaybackSource({
  lesson,
  localBlob,
  localFileName,
  enabled = true,
}: UsePreparedPlaybackOptions): PreparedPlaybackState {
  const objectUrlRef = useRef<string | null>(null)
  const [state, setState] = useState<PreparedPlaybackState>(() => ({
    sourceUrl: localBlob ? '' : resolveLessonPlaybackUrl(lesson),
    preparing: false,
    status: '',
    playbackWindow: getDefaultPlaybackWindow(lesson),
  }))

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }

    setState({
      sourceUrl: localBlob ? '' : resolveLessonPlaybackUrl(lesson),
      preparing: false,
      status: '',
      playbackWindow: getDefaultPlaybackWindow(lesson),
    })
  }, [lesson, localBlob])

  useEffect(() => {
    let canceled = false

    const releaseObjectUrl = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }

    const prepareSource = async () => {
      if (!localBlob) {
        if (!canceled) {
          setState({
            sourceUrl: resolveLessonPlaybackUrl(lesson),
            preparing: false,
            status: '',
            playbackWindow: getDefaultPlaybackWindow(lesson),
          })
        }
        return
      }

      if (!enabled) {
        return
      }

      setState((current) => ({
        ...current,
        preparing: true,
        status: '正在检查视频播放兼容性…',
      }))

      try {
        const prepared = await preparePlaybackSource({
          lesson,
          localBlob,
          localFileName,
          onStatus: (message) => {
            if (!canceled) {
              setState((current) => ({
                ...current,
                status: message,
              }))
            }
          },
        })

        if (canceled) {
          return
        }

        releaseObjectUrl()
        const nextSourceUrl =
          prepared.kind === 'file' ? URL.createObjectURL(prepared.file) : prepared.sourceUrl

        if (prepared.kind === 'file') {
          objectUrlRef.current = nextSourceUrl
        }

        setState({
          sourceUrl: nextSourceUrl,
          preparing: false,
          status: prepared.status,
          playbackWindow: prepared.playbackWindow,
        })
      } catch (error) {
        if (canceled) {
          return
        }

        setState((current) => ({
          ...current,
          preparing: false,
          status:
            error instanceof Error
              ? error.message
              : '当前视频暂时无法播放，请换一个更通用的编码格式。',
        }))
      }
    }

    void prepareSource()

    return () => {
      canceled = true
    }
  }, [enabled, lesson, localBlob, localFileName])

  return state
}
