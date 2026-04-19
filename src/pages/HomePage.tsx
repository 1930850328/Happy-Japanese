import {
  AnimeStudyPlayer,
  type AnimeStudyPlayerHandle,
  type StudyPlayerSnapshot,
} from '../components/AnimeStudyPlayer'
import {
  BookMarked,
  Heart,
  HeartOff,
  LibraryBig,
  Pause,
  Play,
  RotateCcw,
  Smartphone,
  Trash2,
  Volume2,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

import { usePreparedPlaybackSource } from '../hooks/usePreparedPlaybackSource'
import { getDailyLessonFeed, getTodayProgress } from '../lib/selectors'
import { speakJapanese } from '../lib/speech'
import { enrichSegmentsWithSentenceTranslations } from '../lib/subtitleDisplay'
import { extractBrowserPlayableAudioClip } from '../lib/videoPlayback'
import { useAppStore } from '../store/useAppStore'
import type { KnowledgePoint, TranscriptSegment, VideoLesson } from '../types'
import styles from './HomePage.module.css'

interface LessonCardProps {
  lesson: VideoLesson
  favorite: boolean
  showRomaji: boolean
  canDelete: boolean
  onFavorite: (lessonId: string) => void
  onStart: (lessonId: string) => void
  onOpenKnowledge: (lessonId: string) => void
  onDelete: (lessonId: string) => void
}

interface PlayerOverlayProps {
  lesson: VideoLesson
  showRomaji: boolean
  showPlaybackKnowledge: boolean
  showJapaneseSubtitle: boolean
  showChineseSubtitle: boolean
  favorite: boolean
  localBlob?: Blob
  localFileName?: string
  onClose: () => void
  onFinish: (lesson: VideoLesson) => void
  onFavorite: (lessonId: string) => void
  onPlayerError: (lessonId: string) => void
}

interface PointExample {
  label: string
  ja: string
  reading: string
  romaji: string
  zh: string
  startMs?: number
  endMs?: number
}

function getPointExample(
  lesson: VideoLesson,
  point: KnowledgePoint,
  segments: TranscriptSegment[] = lesson.segments,
): PointExample {
  const sourceSegment = segments.find((segment) => segment.focusTermIds.includes(point.id))
  if (sourceSegment) {
    return {
      label: '片中原句',
      ja: sourceSegment.ja,
      reading: sourceSegment.kana,
      romaji: sourceSegment.romaji,
      zh: sourceSegment.zh,
      startMs: sourceSegment.startMs,
      endMs: sourceSegment.endMs,
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
  canDelete,
  onFavorite,
  onStart,
  onOpenKnowledge,
  onDelete,
}: LessonCardProps) {
  const previewSegment = lesson.segments[0]
  const previewPoints = lesson.knowledgePoints.slice(0, 3)

  return (
    <article className={styles.slide}>
      <div className={styles.playerCard} data-testid="lesson-card">
        <div className={styles.posterStage}>
          <img className={styles.posterImage} src={lesson.cover} alt={lesson.title} />
          <div className={styles.posterShade} />

          <div className={styles.cardTop}>
            <div className={styles.topChipRow}>
              <span className="chip badgePeach">{lesson.theme}</span>
              <span className="chip">{lesson.difficulty}</span>
              <span className="chip badgeMint">
                {lesson.sliceLabel ?? `${Math.max(10, Math.round(lesson.durationMs / 1000))} 秒学习切片`}
              </span>
            </div>

            <div className={styles.topActions}>
              <button
                className={styles.favoriteButton}
                onClick={() => onFavorite(lesson.id)}
                aria-label={favorite ? `取消收藏 ${lesson.title}` : `收藏 ${lesson.title}`}
                title={favorite ? '取消收藏这条短视频' : '收藏这条短视频'}
              >
                {favorite ? <Heart size={18} fill="currentColor" /> : <HeartOff size={18} />}
              </button>
              {canDelete ? (
                <button
                  className={styles.deleteButton}
                  onClick={() => onDelete(lesson.id)}
                  aria-label={`删除 ${lesson.title}`}
                  title="删除这条本地短视频"
                >
                  <Trash2 size={18} />
                </button>
              ) : null}
            </div>
          </div>

          <button className={styles.playBadge} onClick={() => onStart(lesson.id)}>
            <Play size={22} />
          </button>
        </div>

        <div className={styles.cardBody}>
          <div className={styles.cardHeader}>
            <div className={styles.topChipRow}>
              <span className="chip badgePeach">{lesson.theme}</span>
              <span className="chip">{lesson.difficulty}</span>
              <span className="chip badgeMint">
                {lesson.sliceLabel ?? `${Math.max(10, Math.round(lesson.durationMs / 1000))} 秒学习切片`}
              </span>
            </div>

            <div className={styles.topActions}>
              <button
                className={styles.favoriteButton}
                onClick={() => onFavorite(lesson.id)}
                aria-label={favorite ? `取消收藏 ${lesson.title}` : `收藏 ${lesson.title}`}
              >
                {favorite ? <Heart size={18} fill="currentColor" /> : <HeartOff size={18} />}
              </button>
              {canDelete ? (
                <button
                  className={styles.deleteButton}
                  onClick={() => onDelete(lesson.id)}
                  aria-label={`删除 ${lesson.title}`}
                >
                  <Trash2 size={18} />
                </button>
              ) : null}
            </div>
          </div>

          <div className={styles.lessonTitleBlock}>
            <h2 className={styles.lessonTitle} data-testid="lesson-title">
              {lesson.title}
            </h2>
            <p className={styles.lessonDescription} data-testid="lesson-description">
              {lesson.description}
            </p>
          </div>

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
                  <small>{point.kind === 'grammar' ? '语法' : '短句'}</small>
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
            {canDelete ? (
              <button className="softButton" onClick={() => onDelete(lesson.id)}>
                <Trash2 size={18} />
                删除短片
              </button>
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
  showPlaybackKnowledge,
  showJapaneseSubtitle,
  showChineseSubtitle,
  favorite,
  localBlob,
  localFileName,
  onClose,
  onFinish,
  onFavorite,
  onPlayerError,
}: PlayerOverlayProps) {
  const [playerStateEntry, setPlayerStateEntry] = useState<{
    lessonId: string
    snapshot: StudyPlayerSnapshot
  } | null>(null)
  const playerRef = useRef<AnimeStudyPlayerHandle | null>(null)
  const onPlayerErrorRef = useRef(onPlayerError)
  const finishedRef = useRef(false)
  const clipStartMs = lesson.clipStartMs ?? 0
  const clipEndMs = lesson.clipEndMs ?? clipStartMs + lesson.durationMs
  const {
    sourceUrl: localSourceUrl,
    preparing: preparingSource,
    status: sourceStatus,
    playbackWindow,
  } = usePreparedPlaybackSource({
    lesson,
    localBlob,
    localFileName,
    enabled: true,
  })
  const playerState =
    playerStateEntry?.lessonId === lesson.id ? playerStateEntry.snapshot : null

  const activePoints = playerState?.activePoints ?? []
  const isPlaying = playerState?.isPlaying ?? false
  const [playbackSegmentsEntry, setPlaybackSegmentsEntry] = useState<{
    lessonId: string
    segments: TranscriptSegment[]
  } | null>(null)
  const playbackSegments =
    playbackSegmentsEntry?.lessonId === lesson.id ? playbackSegmentsEntry.segments : lesson.segments

  useEffect(() => {
    onPlayerErrorRef.current = onPlayerError
  }, [onPlayerError])

  useEffect(() => {
    let canceled = false

    void enrichSegmentsWithSentenceTranslations(lesson.segments).then((segments) => {
      if (!canceled) {
        setPlaybackSegmentsEntry({
          lessonId: lesson.id,
          segments,
        })
      }
    })

    return () => {
      canceled = true
    }
  }, [lesson.id, lesson.segments])

  useEffect(() => {
    finishedRef.current = false
  }, [clipEndMs, clipStartMs, lesson.id])

  useEffect(() => {
    if (localBlob && !preparingSource && !localSourceUrl && sourceStatus) {
      onPlayerErrorRef.current(lesson.id)
    }
  }, [lesson.id, localBlob, localSourceUrl, preparingSource, sourceStatus])

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
                {lesson.sliceLabel ?? `${Math.max(10, Math.round(lesson.durationMs / 1000))} 秒学习切片`}
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
            {localSourceUrl ? (
              <AnimeStudyPlayer
                ref={playerRef}
                url={localSourceUrl}
                poster={lesson.cover}
                durationMs={lesson.durationMs}
                clipStartMs={playbackWindow.startMs}
                clipEndMs={playbackWindow.endMs}
                segments={playbackSegments}
                knowledgePoints={lesson.knowledgePoints}
                showRomaji={showRomaji}
                showSubtitleReading={false}
                showJapaneseSubtitle={showJapaneseSubtitle}
                showChineseSubtitle={showChineseSubtitle}
                onStateChange={(snapshot) => {
                  setPlayerStateEntry({
                    lessonId: lesson.id,
                    snapshot,
                  })
                }}
                onFinish={finishSession}
                onError={() => onPlayerError(lesson.id)}
              />
            ) : (
              <div className={styles.playerPreparing}>
                <strong>{preparingSource ? '正在准备视频…' : '视频暂时还没准备好'}</strong>
                <span>{sourceStatus || '请稍等，系统会先把本地视频整理成浏览器可播放的格式。'}</span>
              </div>
            )}

            {showPlaybackKnowledge && activePoints.length > 0 ? (
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
                    <small>{point.kind === 'grammar' ? '语法' : '短句'}</small>
                    <strong>{point.expression}</strong>
                    <span>{point.meaningZh}</span>
                  </button>
                ))}
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
  const deleteLocalLesson = useAppStore((state) => state.deleteLocalLesson)
  const recordStudyEvent = useAppStore((state) => state.recordStudyEvent)
  const addKnowledgeToReview = useAppStore((state) => state.addKnowledgeToReview)

  const [activeIndex, setActiveIndex] = useState(0)
  const [playerLessonId, setPlayerLessonId] = useState<string | null>(null)
  const [drawerLessonId, setDrawerLessonId] = useState<string | null>(null)
  const [playerErrors, setPlayerErrors] = useState<string[]>([])
  const [drawerSegmentsEntry, setDrawerSegmentsEntry] = useState<{
    lessonId: string
    segments: TranscriptSegment[]
  } | null>(null)
  const [exampleAudioState, setExampleAudioState] = useState<{
    pointId: string
    label: string
    loading: boolean
  } | null>(null)
  const cardRefs = useRef<Array<HTMLElement | null>>([])
  const exampleAudioRef = useRef<HTMLAudioElement | null>(null)
  const exampleAudioUrlRef = useRef<string | null>(null)

  const clipMap = useMemo(() => {
    return importedClips.reduce<Record<string, Blob>>((acc, clip) => {
      if (clip.blob) {
        acc[clip.sourceIdOrBlobKey] = clip.blob
      }
      return acc
    }, {})
  }, [importedClips])

  const localLessons = useMemo(() => lessons.filter((lesson) => lesson.sourceType === 'local'), [lessons])
  const removableLessonIds = useMemo(() => {
    return new Set(
      lessons
        .filter(
          (lesson) =>
            lesson.sourceType === 'local' &&
            importedClips.some(
              (clip) =>
                clip.id === lesson.id ||
                (lesson.originClipId ? clip.id === lesson.originClipId : false),
            ),
        )
        .map((lesson) => lesson.id),
    )
  }, [importedClips, lessons])

  const orderedLessons = useMemo(
    () => getDailyLessonFeed(localLessons, favorites, studyEvents),
    [favorites, localLessons, studyEvents],
  )
  const safeActiveIndex =
    orderedLessons.length === 0 ? 0 : Math.min(activeIndex, orderedLessons.length - 1)
  const activeLesson = orderedLessons[safeActiveIndex]
  const playerLesson = orderedLessons.find((lesson) => lesson.id === playerLessonId) ?? null
  const drawerLesson = orderedLessons.find((lesson) => lesson.id === drawerLessonId) ?? null
  const drawerSegments =
    drawerLesson && drawerSegmentsEntry?.lessonId === drawerLesson.id
      ? drawerSegmentsEntry.segments
      : drawerLesson?.segments ?? []
  const todayProgress = getTodayProgress(studyEvents)
  const todayFocusText =
    activeLesson?.knowledgePoints
      .slice(0, 2)
      .map((point) => point.expression)
      .join(' / ') ?? '导入你自己的原片后，这里会显示今天重点'
  const currentSentence = activeLesson?.segments[0]?.ja ?? '导入本地原片后会显示片中原句'

  const stopExampleAudio = () => {
    if (exampleAudioRef.current) {
      exampleAudioRef.current.pause()
      exampleAudioRef.current.src = ''
      exampleAudioRef.current.load()
      exampleAudioRef.current = null
    }

    if (exampleAudioUrlRef.current) {
      URL.revokeObjectURL(exampleAudioUrlRef.current)
      exampleAudioUrlRef.current = null
    }

    setExampleAudioState(null)
  }

  useEffect(() => {
    return () => {
      stopExampleAudio()
    }
  }, [])

  useEffect(() => {
    if (!drawerLesson) {
      return () => {
        stopExampleAudio()
      }
    }

    let canceled = false

    void enrichSegmentsWithSentenceTranslations(drawerLesson.segments).then((segments) => {
      if (!canceled) {
        setDrawerSegmentsEntry({
          lessonId: drawerLesson.id,
          segments,
        })
      }
    })

    return () => {
      canceled = true
      stopExampleAudio()
    }
  }, [drawerLesson])

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

  const handleDeleteLesson = async (lessonId: string) => {
    const target = lessons.find((lesson) => lesson.id === lessonId)
    if (!target) {
      return
    }

    const confirmed = window.confirm(`要从短视频模块里删除「${target.title}」吗？`)
    if (!confirmed) {
      return
    }

    const deleted = await deleteLocalLesson(lessonId)
    if (!deleted) {
      return
    }

    if (playerLessonId === lessonId) {
      setPlayerLessonId(null)
    }
    if (drawerLessonId === lessonId) {
      setDrawerLessonId(null)
    }
  }

  const handleAddReview = async (lesson: VideoLesson) => {
    await addKnowledgeToReview(lesson.knowledgePoints, lesson.id, lesson.id)
  }

  const handlePlayOriginalExample = async (
    lesson: VideoLesson,
    point: KnowledgePoint,
    example: PointExample,
  ) => {
    if (example.startMs === undefined || example.endMs === undefined) {
      speakJapanese(example.ja)
      return
    }

    const localBlob = clipMap[lesson.sourceIdOrBlobKey]
    if (!localBlob) {
      speakJapanese(example.ja)
      return
    }

    stopExampleAudio()
    setExampleAudioState({
      pointId: point.id,
      label: '正在准备片中原声音频…',
      loading: true,
    })

    try {
      const sourceFile =
        localBlob instanceof File
          ? localBlob
          : new File([localBlob], lesson.sourceFileName || `${lesson.id}.mp4`, {
              type: localBlob.type || 'video/mp4',
              lastModified: 0,
            })

      const sourceClipStartMs = lesson.clipStartMs ?? 0
      const sourceClipEndMs = lesson.clipEndMs ?? sourceClipStartMs + lesson.durationMs
      const sourceStartMs = Math.max(0, sourceClipStartMs + example.startMs)
      const sourceEndMs = Math.min(
        Math.max(sourceStartMs + 240, sourceClipStartMs + example.endMs),
        sourceClipEndMs,
      )

      const { file } = await extractBrowserPlayableAudioClip(
        sourceFile,
        sourceStartMs,
        sourceEndMs,
        (message) => {
          setExampleAudioState({
            pointId: point.id,
            label: message,
            loading: true,
          })
        },
      )

      const objectUrl = URL.createObjectURL(file)
      exampleAudioUrlRef.current = objectUrl
      const audio = new Audio(objectUrl)
      audio.preload = 'auto'
      audio.onended = () => {
        stopExampleAudio()
      }
      audio.onerror = () => {
        stopExampleAudio()
        speakJapanese(example.ja)
      }
      exampleAudioRef.current = audio

      await audio.play()
      setExampleAudioState({
        pointId: point.id,
        label: '片中原声播放中…',
        loading: false,
      })
    } catch {
      stopExampleAudio()
      speakJapanese(example.ja)
    }
  }

  return (
    <div className={`${styles.page} fadeIn`}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className="chip badgeMint">短视频模块已切到独立播放器内核</span>
          <h1 className="pageTitle">先把片中原句看清楚，再顺手记住对应的单词和语法</h1>
          <p className="sectionIntro">
            首页会优先展示站内本地学习切片。播放器控制条已经交给独立内核处理，时间轴、音量、倍速、
            全屏和画中画都在视频内完成；页面层主要保留学习字幕、知识点和收藏删除等操作。
          </p>
          <div className={styles.heroActions}>
            <span className="chip badgePeach">当前模式：卡片流</span>
            <Link to="/immersive" className="softButton secondaryButton">
              <Smartphone size={18} />
              打开竖屏刷流
            </Link>
          </div>
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
            <strong>{currentSentence}</strong>
          </article>
        </div>
      </section>

      <section className={styles.feedWrap}>
        <div className={styles.feed} role="feed" aria-label="日语学习短视频流" data-testid="home-feed">
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
                canDelete={removableLessonIds.has(lesson.id)}
                onFavorite={(lessonId) => void toggleFavorite(lessonId)}
                onStart={handleStartLesson}
                onOpenKnowledge={(lessonId) => {
                  setPlayerLessonId(null)
                  setDrawerLessonId(lessonId)
                }}
                onDelete={(lessonId) => void handleDeleteLesson(lessonId)}
              />
            </section>
          ))}
        </div>
      </section>

      {playerLesson ? (
        <LessonPlayerOverlay
          lesson={playerLesson}
          showRomaji={settings.showRomaji}
          showPlaybackKnowledge={settings.showPlaybackKnowledge}
          showJapaneseSubtitle={settings.showJapaneseSubtitle}
          showChineseSubtitle={settings.showChineseSubtitle}
          favorite={favorites.includes(playerLesson.id)}
          localBlob={clipMap[playerLesson.sourceIdOrBlobKey]}
          localFileName={playerLesson.sourceFileName}
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
                  const example = getPointExample(drawerLesson, point, drawerSegments)
                  const isPreparingExample = exampleAudioState?.pointId === point.id

                  return (
                    <article key={point.id}>
                      <header>
                        <div>
                          <span className="chip badgeMint">
                            {point.kind === 'grammar'
                              ? '语法'
                              : point.kind === 'word'
                                ? '单词'
                                : '短句'}
                          </span>
                          <strong>{point.expression}</strong>
                        </div>

                        <div className={styles.pointActions}>
                          <button className="softButton" onClick={() => speakJapanese(point.expression)}>
                            <Volume2 size={18} />
                            发音
                          </button>
                          <button
                            className="softButton"
                            onClick={() => void handlePlayOriginalExample(drawerLesson, point, example)}
                            disabled={Boolean(isPreparingExample && exampleAudioState?.loading)}
                          >
                            <Play size={18} />
                            {isPreparingExample
                              ? exampleAudioState?.loading
                                ? '准备原声…'
                                : '播放中…'
                              : '片中原句'}
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

                      {isPreparingExample ? (
                        <p className={styles.sessionHint}>{exampleAudioState?.label}</p>
                      ) : null}
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
                  这条视频曾经出现过播放异常，建议检查导入的视频格式是否完整，或者重新导入同一片段。
                </p>
              ) : null}
            </aside>
          </div>
        </OverlayPortal>
      ) : null}
    </div>
  )
}
