import {
  AnimeStudyPlayer as BaseAnimeStudyPlayer,
  type AnimeStudyPlayerHandle,
  type AnimeStudyPlayerProps,
  type StudyPlayerSnapshot,
} from 'anime-study-player'
import { forwardRef, useEffect, useMemo, useRef } from 'react'

import { filterPreciseKnowledgePoints } from '../lib/knowledgePoints'

const PLAYER_TEXT_MAP = new Map<string, string>([
  ['闅愯棌瀛楀箷', '隐藏字幕'],
  ['鏄剧ず瀛楀箷', '显示字幕'],
  ['瑙嗛鏆傛椂鏃犳硶鎾斁', '视频暂时无法播放'],
])

function normalizePlayerText(input: string) {
  if (PLAYER_TEXT_MAP.has(input)) {
    return PLAYER_TEXT_MAP.get(input)!
  }

  if (input.startsWith('瀛楀箷澶у皬 ')) {
    return input.replace('瀛楀箷澶у皬 ', '字幕大小 ')
  }

  return input
}

function localizePlayerChrome(container: HTMLElement) {
  container
    .querySelectorAll<HTMLElement>('.asp-toolButton strong, .asp-errorCard strong')
    .forEach((element) => {
      const currentText = element.textContent?.trim() ?? ''
      const nextText = normalizePlayerText(currentText)
      if (nextText !== currentText) {
        element.textContent = nextText
      }
    })
}

export const AnimeStudyPlayer = forwardRef<AnimeStudyPlayerHandle, AnimeStudyPlayerProps>(
  function AnimeStudyPlayer(props, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null)

    const filteredKnowledgePoints = useMemo(
      () => filterPreciseKnowledgePoints(props.knowledgePoints, props.segments),
      [props.knowledgePoints, props.segments],
    )

    useEffect(() => {
      const container = containerRef.current
      if (!container) {
        return
      }

      localizePlayerChrome(container)

      const observer = new MutationObserver(() => {
        localizePlayerChrome(container)
      })

      observer.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
      })

      return () => observer.disconnect()
    }, [])

    return (
      <div ref={containerRef} style={{ display: 'contents' }}>
        <BaseAnimeStudyPlayer
          {...props}
          ref={ref}
          knowledgePoints={filteredKnowledgePoints}
        />
      </div>
    )
  },
)

export type { AnimeStudyPlayerHandle, StudyPlayerSnapshot }
