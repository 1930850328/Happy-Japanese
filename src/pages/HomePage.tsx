import {
  BookMarked,
  Heart,
  HeartOff,
  LibraryBig,
  PlayCircle,
  Volume2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import YouTube from 'react-youtube'

import { getDailyLessonFeed, getTodayProgress } from '../lib/selectors'
import { speakJapanese } from '../lib/speech'
import { useAppStore } from '../store/useAppStore'
import type { TranscriptSegment, VideoLesson } from '../types'
import styles from './HomePage.module.css'

interface SlideProps {
  lesson: VideoLesson
  active: boolean
  favorite: boolean
  showRomaji: boolean
  localBlob?: Blob
  unavailable: boolean
  onEnded: (lesson: VideoLesson) => void
  onFavorite: (lessonId: string) => void
  onPlayerError: (lessonId: string) => void
}

function getCurrentSegment(lesson: VideoLesson, currentMs: number) {
  return (
    lesson.segments.find(
      (segment) => currentMs >= segment.startMs && currentMs < segment.endMs,
    ) ?? lesson.segments.at(0)
  )
}

function LessonSlide({
  lesson,
  active,
  favorite,
  showRomaji,
  localBlob,
  unavailable,
  onEnded,
  onFavorite,
  onPlayerError,
}: SlideProps) {
  const [currentMs, setCurrentMs] = useState(0)
  const youtubePlayerRef = useRef<any>(null)
  const intervalRef = useRef<number | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const segment = getCurrentSegment(lesson, currentMs)

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current)
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const player = youtubePlayerRef.current
    if (!player || lesson.sourceType !== 'youtube') {
      return
    }

    try {
      if (active) {
        player.playVideo()
      } else {
        player.pauseVideo()
      }
    } catch {
      // Ignore autoplay restrictions.
    }
  }, [active, lesson.sourceType])

  useEffect(() => {
    const video = localVideoRef.current
    if (!video || lesson.sourceType !== 'local') {
      return
    }

    if (active) {
      void video.play().catch(() => undefined)
    } else {
      video.pause()
    }
  }, [active, lesson.sourceType])

  useEffect(() => {
    if (lesson.sourceType !== 'local' || !localBlob) {
      return
    }

    const objectUrl = URL.createObjectURL(localBlob)
    objectUrlRef.current = objectUrl
    if (localVideoRef.current) {
      localVideoRef.current.src = objectUrl
    }

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [lesson.sourceType, localBlob])

  const startPolling = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current)
    }
    intervalRef.current = window.setInterval(() => {
      if (youtubePlayerRef.current) {
        try {
          const second = youtubePlayerRef.current.getCurrentTime()
          setCurrentMs(Math.round(second * 1000))
        } catch {
          // Ignore transient iframe errors.
        }
      }
    }, 300)
  }

  const stopPolling = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  return (
    <article className={styles.slide}>
      <div className={styles.playerCard}>
        <div className={styles.playerArea}>
          {lesson.sourceType === 'youtube' ? (
            <YouTube
              className={styles.youtubeFrame}
              iframeClassName={styles.youtubeIframe}
              videoId={lesson.sourceIdOrBlobKey}
              opts={{
                width: '100%',
                height: '100%',
                playerVars: {
                  autoplay: active ? 1 : 0,
                  controls: 1,
                  rel: 0,
                  playsinline: 1,
                  modestbranding: 1,
                },
              }}
              onReady={(event: any) => {
                youtubePlayerRef.current = event.target
                if (active) {
                  try {
                    event.target.playVideo()
                  } catch {
                    // Ignore autoplay restrictions.
                  }
                }
              }}
              onStateChange={(event: any) => {
                if (event.data === 1) startPolling()
                if (event.data === 2 || event.data === -1) stopPolling()
                if (event.data === 0) {
                  stopPolling()
                  onEnded(lesson)
                }
              }}
              onError={() => onPlayerError(lesson.id)}
            />
          ) : (
            <video
              ref={localVideoRef}
              className={styles.localVideo}
              controls
              playsInline
              onTimeUpdate={(event) =>
                setCurrentMs(Math.round(event.currentTarget.currentTime * 1000))
              }
              onEnded={() => onEnded(lesson)}
            />
          )}

          <div className={styles.topOverlay}>
            <div>
              <span className="chip badgePeach">{lesson.theme}</span>
              <span className="chip">{lesson.difficulty}</span>
            </div>
            <button className={styles.favoriteButton} onClick={() => onFavorite(lesson.id)}>
              {favorite ? <Heart size={18} fill="currentColor" /> : <HeartOff size={18} />}
            </button>
          </div>

          <div className={styles.bottomOverlay}>
            <div className={styles.copyBlock}>
              <h2>{lesson.title}</h2>
              <p>{lesson.description}</p>
            </div>

            {segment ? (
              <div className={styles.subtitleBox}>
                <strong>{segment.ja}</strong>
                <span>{showRomaji ? `${segment.kana} · ${segment.romaji}` : segment.kana}</span>
                <p>{segment.zh}</p>
              </div>
            ) : null}
          </div>

          {unavailable ? (
            <div className={styles.unavailable}>
              <strong>当前视频嵌入受限，已建议你切到下一条。</strong>
              {lesson.sourceUrl ? (
                <a className="softButton" href={lesson.sourceUrl} target="_blank" rel="noreferrer">
                  <PlayCircle size={18} />
                  打开原视频
                </a>
              ) : null}
            </div>
          ) : null}
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
  const drawerLesson = orderedLessons.find((lesson) => lesson.id === drawerLessonId) ?? null
  const todayProgress = getTodayProgress(studyEvents)

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
      { threshold: 0.65 },
    )

    for (const node of cardRefs.current) {
      if (node) {
        observer.observe(node)
      }
    }

    return () => observer.disconnect()
  }, [orderedLessons])

  const handleEnded = async (lesson: VideoLesson) => {
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

    const nextRef = cardRefs.current[activeIndex + 1]
    if (nextRef) {
      nextRef.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const handleAddReview = async (lesson: VideoLesson) => {
    await addKnowledgeToReview(lesson.knowledgePoints, lesson.id, lesson.id)
  }

  const currentSegment: TranscriptSegment | undefined =
    activeLesson?.segments[0]

  return (
    <div className={`${styles.page} fadeIn`}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className="chip badgeMint">沉浸式短视频学习</span>
          <h1 className="pageTitle">刷一条，就顺手学一条真正会用的日语</h1>
          <p className="sectionIntro">
            首页会按当天状态优先推荐没看过的片段，喜欢的可以收藏，播完会自动弹知识点。
          </p>
        </div>

        <div className={`${styles.heroStats} glassCard`}>
          <article>
            <small>今日已看</small>
            <strong>{todayProgress.video}</strong>
          </article>
          <article>
            <small>已收藏</small>
            <strong>{favorites.length}</strong>
          </article>
          <article>
            <small>当前片段</small>
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
              <LessonSlide
                lesson={lesson}
                active={index === activeIndex}
                favorite={favorites.includes(lesson.id)}
                showRomaji={settings.showRomaji}
                localBlob={clipMap[lesson.id]}
                unavailable={playerErrors.includes(lesson.id)}
                onEnded={handleEnded}
                onFavorite={(lessonId) => void toggleFavorite(lessonId)}
                onPlayerError={handlePlayerError}
              />
            </section>
          ))}
        </div>
      </section>

      {drawerLesson ? (
        <div className={styles.drawerBackdrop} onClick={() => setDrawerLessonId(null)}>
          <aside className={styles.drawer} onClick={(event) => event.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <div>
                <span className="chip badgePeach">知识点解析</span>
                <h2>{drawerLesson.title}</h2>
              </div>
              <button className="softButton" onClick={() => setDrawerLessonId(null)}>
                收起
              </button>
            </div>

            <div className={styles.pointList}>
              {drawerLesson.knowledgePoints.map((point) => (
                <article key={point.id}>
                  <header>
                    <div>
                      <span className="chip badgeMint">{point.kind}</span>
                      <strong>{point.expression}</strong>
                    </div>
                    <button className="softButton" onClick={() => speakJapanese(point.expression)}>
                      <Volume2 size={18} />
                      发音
                    </button>
                  </header>
                  <p className={styles.pointReading}>
                    {settings.showRomaji ? `${point.reading}` : point.reading}
                  </p>
                  <p>{point.meaningZh}</p>
                  <p>{point.explanationZh}</p>
                  <div className={styles.exampleBox}>
                    <strong>{point.exampleJa}</strong>
                    <span>{point.exampleZh}</span>
                  </div>
                </article>
              ))}
            </div>

            <div className={styles.drawerActions}>
              <button
                className="softButton primaryButton"
                onClick={() => void handleAddReview(drawerLesson)}
              >
                <LibraryBig size={18} />
                知识点加入复习
              </button>
              <button
                className="softButton"
                onClick={() => void toggleFavorite(drawerLesson.id)}
              >
                <BookMarked size={18} />
                {favorites.includes(drawerLesson.id) ? '已收藏' : '收藏这条视频'}
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
