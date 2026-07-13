import { type FocusEvent, type KeyboardEvent, type MouseEvent, type Ref, useEffect, useMemo, useRef, useState } from 'react'

import { isOccurrenceFocusedForStage } from '../../lib/learningStagePolicy'
import { hasReliableMeaning } from '../../lib/textAnalysis'
import type {
  LyricLine,
  LyricWordTiming,
  SongKnowledge,
  SongStudyIndex,
  SongStudyLine,
  SongStudyOccurrence,
  StudyStage,
} from '../../types'
import styles from './SongLearning.module.css'

interface SongPageLyricClasses {
  row: string
  rowActive: string
  time: string
  textStack: string
  wordLine: string
  word: string
  wordActive: string
}

interface HoverCardState {
  items: SongKnowledge[]
  left: number
  top: number
}

interface LyricLearningLineProps {
  line: LyricLine
  studyLine?: SongStudyLine
  studyIndex?: SongStudyIndex
  occurrenceById: Map<string, SongStudyOccurrence>
  active: boolean
  currentMs?: number
  studyStage: StudyStage
  showZh: boolean
  showKana: boolean
  showRomaji: boolean
  timeLabel: string
  classes: SongPageLyricClasses
  rowRef?: Ref<HTMLDivElement>
  onSeek: (line: LyricLine, shouldPlay?: boolean) => void
  onAddKnowledge: (knowledge: SongKnowledge) => Promise<void>
}

interface TimedLyricFragment {
  id: string
  text: string
  startOffset: number
  endOffset: number
  timing?: LyricWordTiming
}

function buildTimedLyricFragments(line: LyricLine): TimedLyricFragment[] {
  const fragments: TimedLyricFragment[] = []
  let cursor = 0

  for (const timing of line.wordTimings ?? []) {
    if (!timing.text || timing.endMs <= timing.startMs) continue

    let text = timing.text
    let startOffset = line.ja.indexOf(text, cursor)
    if (startOffset < 0 && text.trim() !== text) {
      text = text.trim()
      startOffset = line.ja.indexOf(text, cursor)
    }
    if (!text || startOffset < cursor) continue

    if (startOffset > cursor) {
      fragments.push({
        id: `${line.id}:gap-${cursor}`,
        text: line.ja.slice(cursor, startOffset),
        startOffset: cursor,
        endOffset: startOffset,
      })
    }

    const endOffset = Math.min(line.ja.length, startOffset + text.length)
    if (endOffset <= startOffset) continue
    fragments.push({
      id: timing.id,
      text: line.ja.slice(startOffset, endOffset),
      startOffset,
      endOffset,
      timing,
    })
    cursor = endOffset
  }

  if (cursor < line.ja.length) {
    fragments.push({
      id: `${line.id}:gap-${cursor}`,
      text: line.ja.slice(cursor),
      startOffset: cursor,
      endOffset: line.ja.length,
    })
  }

  return fragments.length > 0
    ? fragments
    : [{
        id: `${line.id}:untimed`,
        text: line.ja,
        startOffset: 0,
        endOffset: line.ja.length,
      }]
}

function getPartOccurrenceIds(part: SongStudyLine['parts'][number]) {
  return [
    part.wordOccurrenceId,
    ...part.grammarOccurrenceIds,
  ].filter((id): id is string => Boolean(id))
}

function getPartKnowledgeItems(
  part: SongStudyLine['parts'][number],
  studyIndex: SongStudyIndex | undefined,
  occurrenceById: Map<string, SongStudyOccurrence>,
) {
  if (!studyIndex) return []

  return getPartOccurrenceIds(part)
    .map((id) => occurrenceById.get(id))
    .filter((occurrence): occurrence is SongStudyOccurrence => Boolean(occurrence))
    .map((occurrence) => studyIndex.knowledge[occurrence.knowledgeId])
    .filter((knowledge): knowledge is SongKnowledge => Boolean(knowledge && hasReliableMeaning(knowledge.meaningZh)))
}

function getPrimaryMeaning(items: SongKnowledge[]) {
  return items.find((item) => item.kind === 'word')?.meaningZh ?? items[0]?.meaningZh ?? ''
}

function createHoverCardState(target: HTMLElement, items: SongKnowledge[]): HoverCardState {
  const rect = target.getBoundingClientRect()
  const width = Math.min(360, window.innerWidth - 24)
  const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12))
  const estimatedHeight = 280
  const belowTop = rect.bottom + 10
  const top = belowTop + estimatedHeight > window.innerHeight
    ? Math.max(12, rect.top - estimatedHeight - 10)
    : belowTop

  return { items, left, top }
}

function KnowledgeHoverCard({
  state,
  onMouseEnter,
  onMouseLeave,
  onAddKnowledge,
}: {
  state: HoverCardState
  onMouseEnter: () => void
  onMouseLeave: () => void
  onAddKnowledge: (knowledge: SongKnowledge) => Promise<void>
}) {
  return (
    <div
      className={styles.hoverCard}
      style={{ left: state.left, top: state.top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {state.items.map((item) => (
        <article key={item.id} className={styles.knowledgeBlock}>
          <header>
            <span>{item.kind === 'word' ? '单词' : '语法'}</span>
            <strong>{item.expression}</strong>
          </header>
          <dl>
            <div>
              <dt>读音</dt>
              <dd>{item.reading || item.expression}</dd>
            </div>
            <div>
              <dt>中文</dt>
              <dd>{item.meaningZh}</dd>
            </div>
            {item.kind === 'word' ? (
              <div>
                <dt>词性</dt>
                <dd>{item.partOfSpeech}</dd>
              </div>
            ) : null}
          </dl>
          <p>{item.explanationZh}</p>
          <blockquote>
            <span>{item.exampleJa}</span>
            <small>{item.exampleZh}</small>
          </blockquote>
          <footer>
            <small>{item.sources.map((source) => source.label).join(' / ')}</small>
            <button type="button" onClick={() => void onAddKnowledge(item)}>
              加入学习
            </button>
          </footer>
        </article>
      ))}
    </div>
  )
}

export function LyricLearningLine({
  line,
  studyLine,
  studyIndex,
  occurrenceById,
  active,
  currentMs,
  studyStage,
  showZh,
  showKana,
  showRomaji,
  timeLabel,
  classes,
  rowRef,
  onSeek,
  onAddKnowledge,
}: LyricLearningLineProps) {
  const [hoverCard, setHoverCard] = useState<HoverCardState | null>(null)
  const hideTimerRef = useRef<number | null>(null)

  const focusOccurrenceIds = useMemo(() => {
    if (!studyIndex) return new Set<string>()
    return new Set(studyIndex.stagePlans[studyStage]?.focusOccurrenceIds ?? [])
  }, [studyIndex, studyStage])
  const timedFragments = useMemo(() => buildTimedLyricFragments(line), [line])

  const clearHideTimer = () => {
    if (hideTimerRef.current === null) return
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
  }

  const scheduleHideCard = () => {
    clearHideTimer()
    hideTimerRef.current = window.setTimeout(() => {
      setHoverCard(null)
      hideTimerRef.current = null
    }, 160)
  }

  useEffect(() => {
    return () => clearHideTimer()
  }, [])

  const showKnowledge = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>, items: SongKnowledge[]) => {
    event.stopPropagation()
    if (items.length === 0) return
    clearHideTimer()
    setHoverCard(createHoverCardState(event.currentTarget, items))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSeek(line, event.shiftKey)
  }

  const renderTimedRange = (startOffset: number, endOffset: number) => {
    return timedFragments.flatMap((fragment) => {
      const overlapStart = Math.max(startOffset, fragment.startOffset)
      const overlapEnd = Math.min(endOffset, fragment.endOffset)
      if (overlapEnd <= overlapStart) return []

      const text = fragment.text.slice(
        overlapStart - fragment.startOffset,
        overlapEnd - fragment.startOffset,
      )
      const isCurrentWord = Boolean(
        active &&
        currentMs !== undefined &&
        fragment.timing &&
        currentMs >= fragment.timing.startMs &&
        currentMs < fragment.timing.endMs,
      )

      return [(
        <span
          key={`${fragment.id}:${overlapStart}`}
          className={isCurrentWord ? classes.wordActive : undefined}
          data-lyric-word={fragment.timing ? 'timed' : 'untimed'}
          data-start-ms={fragment.timing?.startMs}
          data-end-ms={fragment.timing?.endMs}
          aria-current={isCurrentWord ? 'true' : undefined}
        >
          {text}
        </span>
      )]
    })
  }

  const renderJapanese = () => {
    if (!studyLine || !studyIndex) {
      return <span className={classes.wordLine}>{renderTimedRange(0, line.ja.length)}</span>
    }

    return (
      <span className={classes.wordLine}>
        {studyLine.parts.map((part) => {
          const items = getPartKnowledgeItems(part, studyIndex, occurrenceById)
          const occurrenceIds = getPartOccurrenceIds(part)
          const focused = occurrenceIds.some((id) => {
            const occurrence = occurrenceById.get(id)
            return occurrence && (
              focusOccurrenceIds.has(id) ||
              isOccurrenceFocusedForStage(occurrence, studyIndex, studyStage)
            )
          })
          const meaning = getPrimaryMeaning(items)

          if (items.length === 0) {
            return <span key={part.id}>{renderTimedRange(part.startOffset, part.endOffset)}</span>
          }

          return (
            <button
              key={part.id}
              type="button"
              className={[
                classes.word,
                styles.knowledgeToken,
                focused ? styles.knowledgeTokenFocus : '',
              ].filter(Boolean).join(' ')}
              aria-label={`${part.text}：${meaning}`}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onFocus={(event) => showKnowledge(event, items)}
              onMouseEnter={(event) => showKnowledge(event, items)}
              onMouseLeave={scheduleHideCard}
            >
              <span>{renderTimedRange(part.startOffset, part.endOffset)}</span>
              {focused && meaning ? <small>{meaning}</small> : null}
            </button>
          )
        })}
      </span>
    )
  }

  return (
    <>
      <div
        ref={rowRef}
        role="button"
        tabIndex={0}
        className={`${classes.row} ${active ? classes.rowActive : ''}`}
        onClick={() => onSeek(line)}
        onDoubleClick={() => onSeek(line, true)}
        onKeyDown={handleKeyDown}
      >
        <span className={classes.time}>{timeLabel}</span>
        <span className={classes.textStack}>
          <strong>{renderJapanese()}</strong>
          {showZh ? <small>{studyLine?.zh || line.zh}</small> : null}
          {showKana ? <small>{line.kana}</small> : null}
          {showRomaji ? <small>{line.romaji}</small> : null}
        </span>
      </div>

      {hoverCard ? (
        <KnowledgeHoverCard
          state={hoverCard}
          onMouseEnter={clearHideTimer}
          onMouseLeave={scheduleHideCard}
          onAddKnowledge={onAddKnowledge}
        />
      ) : null}
    </>
  )
}
