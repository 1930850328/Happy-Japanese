import {
  AnimeStudyPlayer,
  type AnimeStudyPlayerHandle,
  type StudyPlayerSnapshot,
} from 'anime-study-player'
import {
  BookMarked,
  Heart,
  HeartOff,
  LibraryBig,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { getDailyLessonFeed, getTodayProgress } from '../lib/selectors'
import { speakJapanese } from '../lib/speech'
import { useAppStore } from '../store/useAppStore'
import type { KnowledgePoint, TranscriptSegment, VideoLesson } from '../types'
import styles from './HomePage.module.css'

interface LessonCardProps {
  lesson: VideoLesson
  favorite: boolean
  showRomaji: boolean
  onFavorite: (lessonId: string) => void
  onStart: (lessonId: string) => void
  onOpenKnowledge: (lessonId: string) => void
}

interface PlayerOverlayProps {
  lesson: VideoLesson
  showRomaji: boolean
  favorite: boolean
  localBlob?: Blob
  onClose: () => void
  onFinish: (lesson: VideoLesson) => void
  onFavorite: (lessonId: string) => void
  onPlayerError: (lessonId: string) => void
}

function getPointExample(lesson: VideoLesson, point: KnowledgePoint) {
  const sourceSegment = lesson.segments.find((segment) => segment.focusTermIds.includes(point.id))
  if (sourceSegment) {
    return {
      label: '片中原句',
      ja: sourceSegment.ja,
      reading: sourceSegment.kana,
      romaji: sourceSegment.romaji,
      zh: sourceSegment.zh,
    }
  }

  return {
    label: '例句',
    ja: point.exampleJa,
    reading: point.reading,
    romaji: '',
    zh: point.exampleZh,
  }
}

function formatProgress(currentMs: number, durationMs: number) {
  const total = Math.max(1, Math.round(durationMs / 1000))
  const current = Math.min(total, Math.max(0, Math.round(currentMs / 1000)))
  return `${current}s / ${total}s`
}

function OverlayPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(children, document.body)
}

function LessonCard({
  lesson,
  favorite,
  showRomaji,
  onFavorite,
  onStart,
  onOpenKnowledge,
}: LessonCardProps) {
  const previewSegment = lesson.segments[0]
  const previewPoints = lesson.knowledgePoints.slice(0, 3)

  return (
    <article className={styles.slide}>
      <div className={styles.playerCard}>
        <div className={styles.posterStage}>
          <img className={styles.posterImage} src={lesson.cover} alt={lesson.title} />
          <div className={styles.posterShade} />

          <div className={styles.cardTop}>
            <div className={styles.topChipRow}>
              <span className="chip badgePeach">{lesson.theme}</span>
              <span className="chip">{lesson.difficulty}</span>
              <span className="chip badgeMint">
                {lesson.sliceLabel ?? `${Math.max(10, Math.round(lesson.durationMs / 1000))} 秒`}
              </span>
            </div>

            <button className={styles.favoriteButton} onClick={() => onFavorite(lesson.id)}>
              {favorite ? <Heart size={18} fill="currentColor" /> : <HeartOff size={18} />}
            </button>
          </div>

          <button className={styles.playBadge} onClick={() => onStart(lesson.id)}>
            <Play size={22} />
          </button>

          <div className={styles.posterFooter}>
            <div className={styles.copyBlock}>
              <h2>{lesson.title}</h2>
              <p>{lesson.description}</p>
            </div>
          </div>
        </div>

        <div className={styles.cardBody}>
          {previewSegment ? (
            <div className={styles.previewBlock}>
              <strong>{previewSegment.ja}</strong>
              <span className={styles.previewMeta}>
                {showRomaji
                  ? `${previewSegment.kana} / ${previewSegment.romaji}`
                  : previewSegment.kana}
              </span>
              <p>{previewSegment.zh}</p>
            </div>
          ) : null}

          {previewPoints.length > 0 ? (
            <div className={styles.previewPoints}>
              {previewPoints.map((point) => (
                <div key={point.id} className={styles.previewPoint}>
                  <small>{point.kind === 'grammar' ? '语法' : '词句'}</small>
                  <strong>{point.expression}</strong>
                  <span>{point.meaningZh}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className={styles.actionRow}>
            <button className="softButton primaryButton" onClick={() => onStart(lesson.id)}>
              <Play size={18} />
              开始学习这段
            </button>
            <button className="softButton" onClick={() => onOpenKnowledge(lesson.id)}>
              <BookMarked size={18} />
              先看知识点
            </button>
          </div>
        </div>

        <div className={styles.metaBar}>
          <div className={styles.tagRow}>
            {lesson.tags.map((tag) => (
              <span key={tag} className="chip">
                {tag}
              </span>
            ))}
          </div>
          <span className={styles.credit}>{lesson.creditLine}</span>
        </div>
      </div>
    </article>
  )
}

function LessonPlayerOverlay({
  lesson,
  showRomaji,
  favorite,
  localBlob,
  onClose,
  onFinish,
  onFavorite,
  onPlayerError,
}: PlayerOverlayProps) {
  const [playerState, setPlayerState] = useState<StudyPlayerSnapshot | null>(null)
  const [localSourceUrl, setLocalSourceUrl] = useState(lesson.sourceIdOrBlobKey)
  const playerRef = useRef<AnimeStudyPlayerHandle | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const finishedRef = useRef(false)
  const clipStartMs = lesson.clipStartMs ?? 0
  const clipEndMs = lesson.clipEndMs ?? clipStartMs + lesson.durationMs

  const currentSegment = playerState?.currentSegment ?? lesson.segments.at(0)
  const activePoints = playerState?.activePoints ?? []
  const elapsedMs = playerState?.elapsedMs ?? 0
  const isPlaying = playerState?.isPlaying ?? false
  const isReady = playerState?.isReady ?? false
  const isBuffering = playerState?.isBuffering ?? true
  const volumePercent = Math.round((playerState?.volume ?? 0.8) * 100)

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!localBlob) {
      setLocalSourceUrl(lesson.sourceIdOrBlobKey)
      return
    }

    const objectUrl = URL.createObjectURL(localBlob)
    objectUrlRef.current = objectUrl
    setLocalSourceUrl(objectUrl)

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [lesson.sourceIdOrBlobKey, localBlob])

  useEffect(() => {
    finishedRef.current = false
    setPlayerState(null)
  }, [lesson.id])

  const pausePlayback = () => {
    playerRef.current?.pause()
  }

  const togglePlayback = () => {
    playerRef.current?.toggle()
  }

  const restartPlayback = () => {
    playerRef.current?.restart()
  }

  const finishSession = () => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    pausePlayback()
    onFinish(lesson)
  }

  return (
    <OverlayPortal>
      <div className={styles.sessionBackdrop} onClick={onClose}>
        <section className={styles.sessionPanel} onClick={(event) => event.stopPropagation()}>
          <header className={styles.sessionHeader}>
            <div>
              <span className="chip badgeMint">
                {lesson.sliceLabel ?? `${Math.max(10, Math.round(lesson.durationMs / 1000))} 秒学习`}
              </span>
              <h2>{lesson.title}</h2>
              <p>{lesson.sourceProvider}</p>
            </div>

            <div className={styles.sessionHeaderActions}>
              <button className={styles.favoriteButton} onClick={() => onFavorite(lesson.id)}>
                {favorite ? <Heart size={18} fill="currentColor" /> : <HeartOff size={18} />}
              </button>
              <button className="softButton" onClick={onClose}>
                <X size={18} />
                关闭
              </button>
            </div>
          </header>

          <div className={styles.sessionViewportShell}>
            <AnimeStudyPlayer
              ref={playerRef}
              url={localSourceUrl}
              poster={lesson.cover}
              title={lesson.title}
              sourceLabel={lesson.sourceProvider}
              durationMs={lesson.durationMs}
              clipStartMs={clipStartMs}
              clipEndMs={clipEndMs}
              segments={lesson.segments}
              knowledgePoints={lesson.knowledgePoints}
              showRomaji={showRomaji}
              onStateChange={setPlayerState}
              onFinish={finishSession}
              onError={() => onPlayerError(lesson.id)}
            />

            <div className={styles.progressBox}>
              <div className={styles.progressMeta}>
                <span>
                  {!isReady ? '视频加载中…' : isBuffering ? '正在缓冲…' : isPlaying ? '正在播放' : '已暂停'}
                </span>
                <strong>
                  {formatProgress(elapsedMs, lesson.durationMs)} / 音量 {volumePercent}%
                </strong>
              </div>
            </div>

            {activePoints.length > 0 ? (
              <div className={styles.activePointRow}>
                {activePoints.map((point) => (
                  <button
                    key={point.id}
                    className={`${styles.activePointButton} ${
                      point.kind === 'grammar' ? styles.activePointGrammar : ''
                    }`}
                    onClick={() => {
                      pausePlayback()
                      speakJapanese(point.expression)
                    }}
                  >
                    <small>{point.kind === 'grammar' ? '语法' : '词句'}</small>
                    <strong>{point.expression}</strong>
                    <span>{point.meaningZh}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {currentSegment ? (
              <div className={styles.sessionTranscript}>
                <strong>{currentSegment.ja}</strong>
                <span>
                  {showRomaji
                    ? `${currentSegment.kana} / ${currentSegment.romaji}`
                    : currentSegment.kana}
                </span>
                <p>{currentSegment.zh}</p>
                <button className="softButton" onClick={() => speakJapanese(currentSegment.ja)}>
                  <Volume2 size={18} />
                  播放片中原句
                </button>
              </div>
            ) : null}

            <div className={styles.sessionControls}>
              <button className="softButton primaryButton" onClick={togglePlayback}>
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                {isPlaying ? '暂停学习' : '继续播放'}
              </button>

              <button className="softButton" onClick={restartPlayback}>
                <RotateCcw size={18} />
                从头再看
              </button>

              <button className="softButton" onClick={finishSession}>
                <BookMarked size={18} />
                进入知识点解析
              </button>
            </div>

            <p className={styles.sessionHint}>
              底部控制栏现在已经支持拖动进度、调节音量、全屏和倍速；上层仍然保留学习字幕、高亮词法和知识点联动。
            </p>
          </div>
        </section>
      </div>
    </OverlayPortal>
  )
}

export function HomePage() {
  const lessons = useAppStore((state) => state.lessons)
  const importedClips = useAppStore((state) => state.importedClips)
  const favorites = useAppStore((state) => state.favorites)
  const studyEvents = useAppStore((state) => state.studyEvents)
  const settings = useAppStore((state) => state.settings)
  const toggleFavorite = useAppStore((state) => state.toggleFavorite)
  const recordStudyEvent = useAppStore((state) => state.recordStudyEvent)
  const addKnowledgeToReview = useAppStore((state) => state.addKnowledgeToReview)

  const [activeIndex, setActiveIndex] = useState(0)
  const [playerLessonId, setPlayerLessonId] = useState<string | null>(null)
  const [drawerLessonId, setDrawerLessonId] = useState<string | null>(null)
  const [playerErrors, setPlayerErrors] = useState<string[]>([])
  const cardRefs = useRef<Array<HTMLElement | null>>([])

  const clipMap = useMemo(() => {
    return importedClips.reduce<Record<string, Blob>>((acc, clip) => {
      if (clip.blob) {
        acc[clip.sourceIdOrBlobKey] = clip.blob
      }
      return acc
    }, {})
  }, [importedClips])

  const localLessons = useMemo(() => {
    return lessons.filter((lesson) => lesson.sourceType === 'local')
  }, [lessons])

  const orderedLessons = useMemo(
    () => getDailyLessonFeed(localLessons, favorites, studyEvents),
    [favorites, localLessons, studyEvents],
  )
  const activeLesson = orderedLessons[activeIndex]
  const playerLesson = orderedLessons.find((lesson) => lesson.id === playerLessonId) ?? null
  const drawerLesson = orderedLessons.find((lesson) => lesson.id === drawerLessonId) ?? null
  const todayProgress = getTodayProgress(studyEvents)
  const todayFocusText =
    activeLesson?.knowledgePoints
      .slice(0, 2)
      .map((point) => point.expression)
      .join(' / ') ?? '导入自己的原片后，这里会显示今天重点'
  const currentSegment: TranscriptSegment | undefined = activeLesson?.segments[0]

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    if (!playerLessonId && !drawerLessonId) {
      return
    }

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [drawerLessonId, playerLessonId])

  useEffect(() => {
    if (activeIndex >= orderedLessons.length) {
      setActiveIndex(0)
    }
  }, [activeIndex, orderedLessons.length])

  useEffect(() => {
    if (orderedLessons.length === 0) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0]

        if (!visible) {
          return
        }

        const index = Number((visible.target as HTMLElement).dataset.index)
        if (!Number.isNaN(index)) {
          setActiveIndex(index)
        }
      },
      { threshold: 0.45 },
    )

    for (const node of cardRefs.current) {
      if (node) {
        observer.observe(node)
      }
    }

    return () => observer.disconnect()
  }, [orderedLessons])

  const handleStartLesson = (lessonId: string) => {
    setDrawerLessonId(null)
    setPlayerLessonId(lessonId)
  }

  const handleEnded = async (lesson: VideoLesson) => {
    setPlayerLessonId(null)

    await recordStudyEvent({
      type: 'video',
      sourceId: lesson.id,
      title: lesson.title,
      dedupeKey: `video:${lesson.id}`,
    })

    if (lesson.knowledgePoints.some((point) => point.kind === 'grammar')) {
      await recordStudyEvent({
        type: 'grammar',
        sourceId: lesson.id,
        title: lesson.title,
        dedupeKey: `video-grammar:${lesson.id}`,
      })
    }

    setDrawerLessonId(lesson.id)
  }

  const handlePlayerError = (lessonId: string) => {
    setPlayerErrors((state) => (state.includes(lessonId) ? state : [...state, lessonId]))
  }

  const handleAddReview = async (lesson: VideoLesson) => {
    await addKnowledgeToReview(lesson.knowledgePoints, lesson.id, lesson.id)
  }

  return (
    <div className={`${styles.page} fadeIn`}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className="chip badgeMint">短视频模块已切到独立播放器内核</span>
          <h1 className="pageTitle">先把片中原句看清楚，再顺手记住对应的单词和语法</h1>
          <p className="sectionIntro">
            首页会优先展示站内本地学习切片。现在视频底层播放已经抽到独立仓库维护，
            并换成更完整的播放器控制层，进度、音量、全屏、倍速这些常用操作都在控制栏里。
          </p>
        </div>

        <div className={`${styles.heroStats} glassCard`}>
          <article>
            <small>今日已看</small>
            <strong>{todayProgress.video}</strong>
          </article>
          <article>
            <small>今日重点</small>
            <strong>{todayFocusText}</strong>
          </article>
          <article>
            <small>当前预览</small>
            <strong>{currentSegment?.ja ?? '导入本地原片后会显示片中原句'}</strong>
          </article>
        </div>
      </section>

      <section className={styles.feedWrap}>
        <div className={styles.feed} role="feed" aria-label="日语学习短视频流">
          {orderedLessons.map((lesson, index) => (
            <section
              key={lesson.id}
              ref={(node) => {
                cardRefs.current[index] = node
              }}
              data-index={index}
              className={styles.feedItem}
            >
              <LessonCard
                lesson={lesson}
                favorite={favorites.includes(lesson.id)}
                showRomaji={settings.showRomaji}
                onFavorite={(lessonId) => void toggleFavorite(lessonId)}
                onStart={handleStartLesson}
                onOpenKnowledge={(lessonId) => {
                  setPlayerLessonId(null)
                  setDrawerLessonId(lessonId)
                }}
              />
            </section>
          ))}
        </div>
      </section>

      {playerLesson ? (
        <LessonPlayerOverlay
          lesson={playerLesson}
          showRomaji={settings.showRomaji}
          favorite={favorites.includes(playerLesson.id)}
          localBlob={clipMap[playerLesson.sourceIdOrBlobKey]}
          onClose={() => setPlayerLessonId(null)}
          onFinish={handleEnded}
          onFavorite={(lessonId) => void toggleFavorite(lessonId)}
          onPlayerError={handlePlayerError}
        />
      ) : null}

      {drawerLesson ? (
        <OverlayPortal>
          <div className={styles.drawerBackdrop} onClick={() => setDrawerLessonId(null)}>
            <aside className={styles.drawer} onClick={(event) => event.stopPropagation()}>
              <div className={styles.drawerHeader}>
                <div>
                  <span className="chip badgePeach">知识点解析</span>
                  <h2>{drawerLesson.title}</h2>
                </div>
                <button className="softButton" onClick={() => setDrawerLessonId(null)}>
                  <X size={18} />
                  收起
                </button>
              </div>

              <div className={styles.pointList}>
                {drawerLesson.knowledgePoints.map((point) => {
                  const example = getPointExample(drawerLesson, point)

                  return (
                    <article key={point.id}>
                      <header>
                        <div>
                          <span className="chip badgeMint">
                            {point.kind === 'grammar' ? '语法' : point.kind === 'word' ? '单词' : '词句'}
                          </span>
                          <strong>{point.expression}</strong>
                        </div>

                        <div className={styles.pointActions}>
                          <button className="softButton" onClick={() => speakJapanese(point.expression)}>
                            <Volume2 size={18} />
                            发音
                          </button>
                          <button className="softButton" onClick={() => speakJapanese(example.ja)}>
                            <Play size={18} />
                            片中原句
                          </button>
                        </div>
                      </header>

                      <p className={styles.pointReading}>{point.reading}</p>
                      <p>{point.meaningZh}</p>
                      <p>{point.explanationZh}</p>

                      <div className={styles.exampleBox}>
                        <small>{example.label}</small>
                        <strong>{example.ja}</strong>
                        <span>
                          {settings.showRomaji && example.romaji
                            ? `${example.reading} / ${example.romaji}`
                            : example.reading}
                        </span>
                        <p>{example.zh}</p>
                      </div>
                    </article>
                  )
                })}
              </div>

              <div className={styles.drawerActions}>
                <button
                  className="softButton primaryButton"
                  onClick={() => void handleAddReview(drawerLesson)}
                >
                  <LibraryBig size={18} />
                  知识点加入复习
                </button>
                <button className="softButton" onClick={() => void toggleFavorite(drawerLesson.id)}>
                  <BookMarked size={18} />
                  {favorites.includes(drawerLesson.id) ? '已收藏' : '收藏这条视频'}
                </button>
              </div>

              {playerErrors.includes(drawerLesson.id) ? (
                <p className={styles.sessionHint}>
                  这条视频曾出现过播放异常，建议检查导入的视频格式是否完整，或重新导入同一片段。
                </p>
              ) : null}
            </aside>
          </div>
        </OverlayPortal>
      ) : null}
    </div>
  )
}
