import {
  BookMarked,
  ExternalLink,
  Heart,
  HeartOff,
  LibraryBig,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
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

function getCurrentSegment(lesson: VideoLesson, currentMs: number) {
  return (
    lesson.segments.find(
      (segment) => currentMs >= segment.startMs && currentMs < segment.endMs,
    ) ?? lesson.segments.at(-1) ?? lesson.segments.at(0)
  )
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
    label: '练习例句',
    ja: point.exampleJa,
    reading: point.reading,
    romaji: '',
    zh: point.exampleZh,
  }
}

function buildBilibiliPlayerUrl(lesson: VideoLesson, resumeFromMs = 0) {
  const startSec = (lesson.sourceStartSec ?? 0) + Math.floor(resumeFromMs / 1000)
  const params = new URLSearchParams({
    bvid: lesson.sourceIdOrBlobKey,
    page: '1',
    autoplay: '1',
    danmaku: '0',
    high_quality: '1',
    as_wide: '1',
  })

  if (startSec > 0) {
    params.set('t', String(startSec))
  }

  return `https://player.bilibili.com/player.html?${params.toString()}`
}

function formatProgress(currentMs: number, durationMs: number) {
  const total = Math.max(10, Math.round(durationMs / 1000))
  const current = Math.min(total, Math.max(0, Math.ceil(currentMs / 1000)))
  return `${current} / ${total}s`
}

function OverlayPortal({ children }: { children: React.ReactNode }) {
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
  const previewPoints = lesson.knowledgePoints.slice(0, 2)
  const examplePoint = previewPoints[0]
  const example = examplePoint ? getPointExample(lesson, examplePoint) : null

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
              <span className="chip badgeMint">{lesson.sliceLabel ?? '10-15 秒微课'}</span>
              <span className="chip">
                {lesson.sourceType === 'bilibili' ? '官方公开视频微课' : '站内本地切片'}
              </span>
            </div>

            <button className={styles.favoriteButton} onClick={() => onFavorite(lesson.id)}>
              {favorite ? <Heart size={18} fill="currentColor" /> : <HeartOff size={18} />}
            </button>
          </div>

          <div className={styles.posterFooter}>
            <div className={styles.copyBlock}>
              <h2>{lesson.title}</h2>
              <p>{lesson.description}</p>
            </div>

            {previewSegment ? (
              <div className={styles.previewSentence}>
                <strong>{previewSegment.ja}</strong>
                <span>
                  {showRomaji
                    ? `${previewSegment.kana} / ${previewSegment.romaji}`
                    : previewSegment.kana}
                </span>
                <p>{previewSegment.zh}</p>
              </div>
            ) : null}

            <div className={styles.focusRow}>
              {previewPoints.map((point) => (
                <div key={point.id} className={styles.focusPill}>
                  <small>{point.kind === 'grammar' ? '今日语法' : '今日词句'}</small>
                  <strong>{point.expression}</strong>
                  <span>{point.meaningZh}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.cardBody}>
          <div className={styles.microCopy}>
            <strong>{lesson.sourceType === 'bilibili' ? '当前流程' : '站内播放'}</strong>
            <p>
              {lesson.sourceType === 'bilibili'
                ? '点“开始这段微课”后，会在站内打开官方片段学习层。看完整段后自动进入知识点解析。'
                : '站内本地切片会在学习层里直接播放，播完后自动进入知识点解析。'}
            </p>
          </div>

          {example ? (
            <div className={styles.examplePreview}>
              <small>{example.label}</small>
              <strong>{example.ja}</strong>
              <span>{example.zh}</span>
            </div>
          ) : null}

          <div className={styles.actionRow}>
            <button className="softButton primaryButton" onClick={() => onStart(lesson.id)}>
              <Play size={18} />
              开始这段微课
            </button>
            <button className="softButton" onClick={() => onOpenKnowledge(lesson.id)}>
              <BookMarked size={18} />
              先看知识点
            </button>
            {lesson.sourceUrl ? (
              <a className="softButton" href={lesson.sourceUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={18} />
                原视频
              </a>
            ) : null}
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
  const [elapsedMs, setElapsedMs] = useState(0)
  const [isPlaying, setIsPlaying] = useState(lesson.sourceType === 'local')
  const [resumeFromMs, setResumeFromMs] = useState(0)
  const [localSourceUrl, setLocalSourceUrl] = useState(lesson.sourceIdOrBlobKey)
  const [iframeEpoch, setIframeEpoch] = useState(0)
  const [localBlocked, setLocalBlocked] = useState(false)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const bilibiliBaseRef = useRef(0)
  const bilibiliStartedAtRef = useRef(0)
  const elapsedRef = useRef(0)
  const finishedRef = useRef(false)

  const segment = getCurrentSegment(lesson, elapsedMs)
  const progressPercent = Math.min(100, Math.max(0, (elapsedMs / lesson.durationMs) * 100))
  const durationLabel = formatProgress(elapsedMs, lesson.durationMs)
  const playerUrl =
    lesson.sourceType === 'bilibili' ? buildBilibiliPlayerUrl(lesson, resumeFromMs) : ''

  useEffect(() => {
    elapsedRef.current = elapsedMs
  }, [elapsedMs])

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
    setElapsedMs(0)
    elapsedRef.current = 0
    setResumeFromMs(0)
    setIframeEpoch(0)
    setLocalBlocked(false)
    setIsPlaying(lesson.sourceType === 'local')
  }, [lesson.id, lesson.sourceType])

  useEffect(() => {
    if (lesson.sourceType !== 'local') {
      return
    }

    const video = localVideoRef.current
    if (!video) {
      return
    }

    video.currentTime = 0
    const playAttempt = video.play()
    if (!playAttempt) {
      return
    }

    void playAttempt
      .then(() => {
        setLocalBlocked(false)
        setIsPlaying(true)
      })
      .catch(() => {
        setLocalBlocked(true)
        setIsPlaying(false)
      })

    return () => {
      video.pause()
    }
  }, [lesson.id, lesson.sourceType])

  useEffect(() => {
    if (lesson.sourceType !== 'bilibili' || !isPlaying) {
      return
    }

    const timerId = window.setInterval(() => {
      const nextElapsed = Math.min(
        bilibiliBaseRef.current + (Date.now() - bilibiliStartedAtRef.current),
        lesson.durationMs,
      )
      elapsedRef.current = nextElapsed
      setElapsedMs(nextElapsed)

      if (nextElapsed >= lesson.durationMs && !finishedRef.current) {
        finishedRef.current = true
        setIsPlaying(false)
        onFinish(lesson)
      }
    }, 250)

    return () => {
      window.clearInterval(timerId)
    }
  }, [isPlaying, lesson, onFinish])

  const finishSession = () => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    localVideoRef.current?.pause()
    setIsPlaying(false)
    onFinish(lesson)
  }

  const handleStartBilibili = () => {
    const startAt = elapsedRef.current
    bilibiliBaseRef.current = startAt
    bilibiliStartedAtRef.current = Date.now()
    setResumeFromMs(startAt)
    setIframeEpoch((value) => value + 1)
    setIsPlaying(true)
  }

  const handlePauseBilibili = () => {
    const nextElapsed = Math.min(
      bilibiliBaseRef.current + (Date.now() - bilibiliStartedAtRef.current),
      lesson.durationMs,
    )
    elapsedRef.current = nextElapsed
    setElapsedMs(nextElapsed)
    setIsPlaying(false)
  }

  const handleRestart = () => {
    finishedRef.current = false
    elapsedRef.current = 0
    setElapsedMs(0)

    if (lesson.sourceType === 'local') {
      const video = localVideoRef.current
      if (!video) {
        return
      }
      video.currentTime = 0
      const playAttempt = video.play()
      if (!playAttempt) {
        return
      }
      void playAttempt
        .then(() => {
          setLocalBlocked(false)
          setIsPlaying(true)
        })
        .catch(() => {
          setLocalBlocked(true)
          setIsPlaying(false)
        })
      return
    }

    setResumeFromMs(0)
    setIsPlaying(false)
  }

  const toggleLocalPlayback = () => {
    const video = localVideoRef.current
    if (!video) {
      return
    }

    if (video.paused) {
      const playAttempt = video.play()
      if (!playAttempt) {
        return
      }
      void playAttempt
        .then(() => {
          setLocalBlocked(false)
          setIsPlaying(true)
        })
        .catch(() => {
          setLocalBlocked(true)
          setIsPlaying(false)
        })
      return
    }

    video.pause()
    setIsPlaying(false)
  }

  const primaryButtonLabel =
    lesson.sourceType === 'bilibili'
      ? isPlaying
        ? '暂停学习'
        : elapsedMs > 0
          ? '继续这段微课'
          : '开始这段微课'
      : isPlaying
        ? '暂停播放'
        : '继续播放'

  return (
    <OverlayPortal>
      <div className={styles.sessionBackdrop} onClick={onClose}>
        <section className={styles.sessionPanel} onClick={(event) => event.stopPropagation()}>
          <header className={styles.sessionHeader}>
            <div>
              <span className="chip badgeMint">{lesson.sliceLabel ?? '10-15 秒微课'}</span>
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
            <div className={styles.sessionViewport}>
              {lesson.sourceType === 'local' ? (
                <video
                  ref={localVideoRef}
                  className={styles.sessionVideo}
                  src={localSourceUrl}
                  poster={lesson.cover}
                  controls
                  playsInline
                  preload="auto"
                  onTimeUpdate={(event) =>
                    setElapsedMs(Math.round(event.currentTarget.currentTime * 1000))
                  }
                  onEnded={finishSession}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onError={() => {
                    onPlayerError(lesson.id)
                    setLocalBlocked(true)
                  }}
                />
              ) : isPlaying ? (
                <iframe
                  key={`${lesson.id}-${iframeEpoch}-${resumeFromMs}`}
                  className={styles.sessionIframe}
                  src={playerUrl}
                  title={lesson.title}
                  allow="autoplay; fullscreen; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <div className={styles.sessionPosterFill}>
                  <img className={styles.sessionPosterImage} src={lesson.cover} alt={lesson.title} />
                  <div className={styles.sessionPosterShade} />
                  <div className={styles.sessionPosterCopy}>
                    <strong>官方片段学习层</strong>
                    <p>
                      这条是官方公开视频微课。点开始后会在站内播放这 10-15 秒学习窗，结束后自动进入解析。
                    </p>
                    <button className="softButton primaryButton" onClick={handleStartBilibili}>
                      <Play size={18} />
                      {elapsedMs > 0 ? '继续播放这段' : '开始这段微课'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className={styles.progressBox}>
              <div className={styles.progressMeta}>
                <span>{lesson.sourceType === 'bilibili' ? '学习窗进度' : '视频进度'}</span>
                <strong>{durationLabel}</strong>
              </div>
              <div className={styles.progressTrack}>
                <span style={{ width: `${progressPercent}%` }} />
              </div>
            </div>

            {segment ? (
              <div className={styles.sessionTranscript}>
                <strong>{segment.ja}</strong>
                <span>{showRomaji ? `${segment.kana} / ${segment.romaji}` : segment.kana}</span>
                <p>{segment.zh}</p>
                <button className="softButton" onClick={() => speakJapanese(segment.ja)}>
                  <Volume2 size={18} />
                  播放片中原句
                </button>
              </div>
            ) : null}

            <div className={styles.sessionControls}>
              <button
                className="softButton primaryButton"
                onClick={() => {
                  if (lesson.sourceType === 'local') {
                    toggleLocalPlayback()
                    return
                  }

                  if (isPlaying) {
                    handlePauseBilibili()
                    return
                  }

                  handleStartBilibili()
                }}
              >
                {lesson.sourceType === 'local' && isPlaying ? <Pause size={18} /> : <Play size={18} />}
                {primaryButtonLabel}
              </button>

              <button className="softButton" onClick={handleRestart}>
                <RotateCcw size={18} />
                从头再看
              </button>

              <button className="softButton" onClick={finishSession}>
                <BookMarked size={18} />
                直接看解析
              </button>

              {lesson.sourceUrl ? (
                <a className="softButton" href={lesson.sourceUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={18} />
                  打开原视频
                </a>
              ) : null}
            </div>

            {lesson.sourceType === 'bilibili' ? (
              <p className={styles.sessionHint}>
                B 站官方外链在部分手机上可能需要你先点一次“开始这段微课”，如果画面没立刻动起来，再点一下播放器里的播放键即可。
              </p>
            ) : null}

            {localBlocked ? (
              <p className={styles.sessionHint}>
                当前设备没有自动开始播放，你可以点“继续播放”或直接用视频控件开始。
              </p>
            ) : null}
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
      acc[clip.id] = clip.blob
      return acc
    }, {})
  }, [importedClips])

  const orderedLessons = useMemo(
    () => getDailyLessonFeed(lessons, favorites, studyEvents),
    [favorites, lessons, studyEvents],
  )
  const activeLesson = orderedLessons[activeIndex]
  const playerLesson = orderedLessons.find((lesson) => lesson.id === playerLessonId) ?? null
  const drawerLesson = orderedLessons.find((lesson) => lesson.id === drawerLessonId) ?? null
  const todayProgress = getTodayProgress(studyEvents)
  const todayFocusText =
    activeLesson?.knowledgePoints.slice(0, 2).map((point) => point.expression).join(' / ') ??
    '准备开始'
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
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]

        if (!visible) {
          return
        }

        const index = Number((visible.target as HTMLElement).dataset.index)
        if (!Number.isNaN(index)) {
          setActiveIndex(index)
        }
      },
      { threshold: 0.42 },
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
    if (playerErrors.includes(lessonId)) {
      return
    }

    setPlayerErrors((state) => [...state, lessonId])
  }

  const handleAddReview = async (lesson: VideoLesson) => {
    await addKnowledgeToReview(lesson.knowledgePoints, lesson.id, lesson.id)
  }

  return (
    <div className={`${styles.page} fadeIn`}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className="chip badgeMint">短视频微课流程已改为“选课 → 播放 → 自动解析”</span>
          <h1 className="pageTitle">先把这一小段看完，再顺手记住对应的词和语法</h1>
          <p className="sectionIntro">
            首页现在优先展示近 5 年番剧相关的官方公开视频微课。卡片负责选课，真正播放在独立学习层里进行，这样手机上能看全视频、能手动暂停、播完也会稳定进入解析。
          </p>
        </div>

        <div className={`${styles.heroStats} glassCard`}>
          <article>
            <small>今日已看</small>
            <strong>{todayProgress.video}</strong>
          </article>
          <article>
            <small>今日主学</small>
            <strong>{todayFocusText}</strong>
          </article>
          <article>
            <small>当前预览句</small>
            <strong>{currentSegment?.ja ?? '准备开始'}</strong>
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
          localBlob={clipMap[playerLesson.id]}
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
                          <span className="chip badgeMint">{point.kind}</span>
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
                {drawerLesson.sourceUrl ? (
                  <a
                    className="softButton"
                    href={drawerLesson.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={18} />
                    打开原视频
                  </a>
                ) : null}
              </div>

              {playerErrors.includes(drawerLesson.id) ? (
                <p className={styles.sessionHint}>这条视频曾出现过加载异常，建议顺手点一下原视频确认来源。</p>
              ) : null}
            </aside>
          </div>
        </OverlayPortal>
      ) : null}
    </div>
  )
}
