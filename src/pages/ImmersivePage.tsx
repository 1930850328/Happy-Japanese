import {
  AnimeStudyPlayer,
  type AnimeStudyPlayerHandle,
  type StudyPlayerSnapshot,
} from '../components/AnimeStudyPlayer'
import {
  ArrowLeft,
  BookMarked,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Heart,
  HeartOff,
  Sparkles,
} from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Keyboard, Mousewheel } from 'swiper/modules'
import type { Swiper as SwiperInstance } from 'swiper'
import { Swiper, SwiperSlide } from 'swiper/react'
import 'swiper/css'

import { usePreparedPlaybackSource } from '../hooks/usePreparedPlaybackSource'
import { enrichSegmentsWithSentenceTranslations } from '../lib/subtitleDisplay'
import { getDailyLessonFeed } from '../lib/selectors'
import { useAppStore } from '../store/useAppStore'
import type { TranscriptSegment, VideoLesson } from '../types'
import styles from './ImmersivePage.module.css'

interface ImmersiveSlideProps {
  lesson: VideoLesson
  localBlob?: Blob
  active: boolean
  shouldPrepare: boolean
  favorite: boolean
  showRomaji: boolean
  showPlaybackKnowledge: boolean
  showJapaneseSubtitle: boolean
  showChineseSubtitle: boolean
  onToggleFavorite: (lessonId: string) => void
  onAddReview: (lesson: VideoLesson) => Promise<number>
  onRecordCompletion: (lesson: VideoLesson) => Promise<boolean>
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function buildBackdropStyle(cover: string): CSSProperties {
  return {
    backgroundImage: `linear-gradient(180deg, rgba(10, 8, 8, 0.20), rgba(10, 8, 8, 0.78)), url("${cover}")`,
  }
}

function ImmersiveSlide({
  lesson,
  localBlob,
  active,
  shouldPrepare,
  favorite,
  showRomaji,
  showPlaybackKnowledge,
  showJapaneseSubtitle,
  showChineseSubtitle,
  onToggleFavorite,
  onAddReview,
  onRecordCompletion,
}: ImmersiveSlideProps) {
  const playerRef = useRef<AnimeStudyPlayerHandle | null>(null)
  const [playerState, setPlayerState] = useState<StudyPlayerSnapshot | null>(null)
  const [playbackSegments, setPlaybackSegments] = useState<TranscriptSegment[]>(lesson.segments)
  const [reviewFeedback, setReviewFeedback] = useState('')
  const [completionFeedback, setCompletionFeedback] = useState('')
  const { sourceUrl, preparing, status, playbackWindow } = usePreparedPlaybackSource({
    lesson,
    localBlob,
    localFileName: lesson.sourceFileName,
    enabled: shouldPrepare,
  })

  useEffect(() => {
    let canceled = false

    void enrichSegmentsWithSentenceTranslations(lesson.segments).then((segments) => {
      if (!canceled) {
        setPlaybackSegments(segments)
      }
    })

    return () => {
      canceled = true
    }
  }, [lesson.id, lesson.segments])

  useEffect(() => {
    if (!sourceUrl) {
      return
    }

    if (!active) {
      playerRef.current?.pause()
      return
    }

    const timerId = window.setTimeout(() => {
      playerRef.current?.play()
    }, 120)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [active, sourceUrl])

  const currentSegment = playerState?.currentSegment ?? playbackSegments[0]
  const visiblePoints =
    showPlaybackKnowledge && (playerState?.activePoints?.length ?? 0) > 0
      ? playerState?.activePoints ?? []
      : lesson.knowledgePoints.slice(0, 3)

  const handleAddReview = async () => {
    const addedCount = await onAddReview(lesson)
    setReviewFeedback(addedCount > 0 ? `已加入 ${addedCount} 个复习点` : '这些知识点已经在复习列表里了')
  }

  const handleFinish = async () => {
    const recorded = await onRecordCompletion(lesson)
    setCompletionFeedback(recorded ? '已记入今日视频进度' : '今天已经记过这条视频了')
  }

  return (
    <div className={styles.slideScene} aria-hidden={!active} inert={!active ? true : undefined}>
      <div className={styles.slideBackdrop} style={buildBackdropStyle(lesson.cover)} />
      <div className={styles.slideNoise} />

      <div className={styles.slideContent}>
        <div className={styles.viewerShell}>
          <div className={styles.playerStage} data-testid={active ? 'immersive-stage' : undefined}>
            {sourceUrl ? (
              <AnimeStudyPlayer
                ref={playerRef}
                url={sourceUrl}
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
                autoplay={active}
                onStateChange={setPlayerState}
                onFinish={handleFinish}
              />
            ) : (
              <div className={styles.playerFallback}>
                <strong>{preparing ? '正在准备视频…' : shouldPrepare ? '即将开始播放' : '滑到这条时开始准备'}</strong>
                <span>{status || '播放器会在切到当前视频前，优先准备浏览器兼容格式。'}</span>
              </div>
            )}
            <div className={styles.playerShade} />

            <div className={styles.actionRail} data-testid={active ? 'immersive-action-rail' : undefined}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => onToggleFavorite(lesson.id)}
                aria-label={favorite ? `取消收藏 ${lesson.title}` : `收藏 ${lesson.title}`}
              >
                {favorite ? <Heart size={20} fill="currentColor" /> : <HeartOff size={20} />}
                <span>{favorite ? '已收藏' : '收藏'}</span>
              </button>

              <button
                type="button"
                className={styles.actionButton}
                onClick={() => void handleAddReview()}
              >
                <BookMarked size={20} />
                <span>加复习</span>
              </button>

              <a
                className={styles.actionButton}
                href={lesson.sourceUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`打开 ${lesson.title} 的来源页面`}
              >
                <ExternalLink size={20} />
                <span>来源</span>
              </a>
            </div>

            <div className={styles.infoCard} data-testid={active ? 'immersive-info' : undefined}>
              <div className={styles.infoHeader}>
                <div className={styles.infoBadges}>
                  <span className="chip badgeMint">竖屏刷流</span>
                  <span className="chip">{lesson.theme}</span>
                  <span className="chip badgePeach">{lesson.difficulty}</span>
                  <span className="chip">{lesson.sliceLabel ?? `${formatDuration(lesson.durationMs)} 微课`}</span>
                </div>

                <div className={styles.statusStack}>
                  {preparing ? <span className="chip badgePink">视频准备中</span> : null}
                  {!preparing && status ? <span className="chip">{status}</span> : null}
                  {playerState?.isAutoplayBlocked ? (
                    <span className="chip badgePink">自动播放被浏览器拦截</span>
                  ) : null}
                  {completionFeedback ? <span className="chip badgeMint">{completionFeedback}</span> : null}
                  {reviewFeedback ? <span className="chip badgePeach">{reviewFeedback}</span> : null}
                </div>
              </div>

              <div className={styles.lessonHeader}>
                <div>
                  <h1 className={styles.lessonTitle}>{lesson.title}</h1>
                  <p className={styles.lessonMeta}>
                    {lesson.sourceProvider}
                    <span>·</span>
                    <span>{formatDuration(lesson.durationMs)}</span>
                  </p>
                </div>
                <span className={styles.focusTag}>
                  <Sparkles size={16} />
                  学习焦点
                </span>
              </div>

              <p className={styles.lessonDescription}>{lesson.description}</p>

              {currentSegment ? (
                <div className={styles.currentSentenceCard}>
                  <strong>{currentSegment.ja}</strong>
                  <span>
                    {showRomaji
                      ? `${currentSegment.kana} / ${currentSegment.romaji}`
                      : currentSegment.kana}
                  </span>
                  <p>{currentSegment.zh}</p>
                </div>
              ) : null}

              <div className={styles.pointGrid}>
                {visiblePoints.map((point) => (
                  <article key={point.id} className={styles.pointCard}>
                    <small>{point.kind === 'grammar' ? '语法' : point.kind === 'word' ? '单词' : '短句'}</small>
                    <strong>{point.expression}</strong>
                    <span>{point.meaningZh}</span>
                  </article>
                ))}
              </div>

              <div className={styles.tagRow}>
                {lesson.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="chip">
                    {tag}
                  </span>
                ))}
              </div>

              <p className={styles.creditLine}>{lesson.creditLine}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ImmersivePage() {
  const lessons = useAppStore((state) => state.lessons)
  const importedClips = useAppStore((state) => state.importedClips)
  const favorites = useAppStore((state) => state.favorites)
  const studyEvents = useAppStore((state) => state.studyEvents)
  const settings = useAppStore((state) => state.settings)
  const toggleFavorite = useAppStore((state) => state.toggleFavorite)
  const addKnowledgeToReview = useAppStore((state) => state.addKnowledgeToReview)
  const recordStudyEvent = useAppStore((state) => state.recordStudyEvent)

  const [activeIndex, setActiveIndex] = useState(0)
  const swiperRef = useRef<SwiperInstance | null>(null)

  const clipMap = useMemo(() => {
    return importedClips.reduce<Record<string, Blob>>((acc, clip) => {
      if (clip.blob) {
        acc[clip.sourceIdOrBlobKey] = clip.blob
      }
      return acc
    }, {})
  }, [importedClips])

  const orderedLessons = useMemo(() => {
    const localLessons = lessons.filter((lesson) => lesson.sourceType === 'local')
    return getDailyLessonFeed(localLessons, favorites, studyEvents)
  }, [favorites, lessons, studyEvents])

  const safeActiveIndex =
    orderedLessons.length === 0 ? 0 : Math.min(activeIndex, orderedLessons.length - 1)
  const activeLesson = orderedLessons[safeActiveIndex] ?? null

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  const handleAddReview = async (lesson: VideoLesson) => {
    return addKnowledgeToReview(lesson.knowledgePoints, lesson.id, lesson.id)
  }

  const handleRecordCompletion = async (lesson: VideoLesson) => {
    const recorded = await recordStudyEvent({
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

    return recorded
  }

  if (orderedLessons.length === 0) {
    return (
      <div className={styles.emptyPage}>
        <div className={`${styles.emptyCard} glassCard`}>
          <span className="chip badgeMint">竖屏刷流</span>
          <h1>还没有可刷的本地学习切片</h1>
          <p>先去导入你自己的原片，或者回到首页看看现有的卡片模式课程。</p>
          <div className={styles.emptyActions}>
            <Link to="/" className="softButton secondaryButton">
              返回卡片流
            </Link>
            <Link to="/profile" className="softButton primaryButton">
              去我的页导入视频
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.headerCluster}>
          <Link to="/" className={`${styles.headerButton} ${styles.headerBackButton}`}>
            <ArrowLeft size={18} />
            返回卡片流
          </Link>
          <div className={styles.headerMeta}>
            <span className="chip badgeMint">沉浸竖屏</span>
            <strong>
              {safeActiveIndex + 1} / {orderedLessons.length}
            </strong>
            <span>{activeLesson?.theme ?? '学习流'}</span>
          </div>
        </div>

        <div className={styles.headerCluster}>
          <button
            type="button"
            className={styles.headerButton}
            onClick={() => swiperRef.current?.slidePrev()}
            disabled={safeActiveIndex === 0}
          >
            <ChevronUp size={18} />
            上一条
          </button>
          <button
            type="button"
            className={styles.headerButton}
            onClick={() => swiperRef.current?.slideNext()}
            disabled={safeActiveIndex === orderedLessons.length - 1}
          >
            <ChevronDown size={18} />
            下一条
          </button>
        </div>
      </header>

      <Swiper
        className={styles.swiper}
        modules={[Keyboard, Mousewheel]}
        direction="vertical"
        slidesPerView={1}
        speed={480}
        threshold={6}
        keyboard={{ enabled: true }}
        mousewheel={{ forceToAxis: true, sensitivity: 0.9 }}
        onSwiper={(instance) => {
          swiperRef.current = instance
        }}
        onSlideChange={(instance) => {
          setActiveIndex(instance.activeIndex)
        }}
      >
        {orderedLessons.map((lesson, index) => (
          <SwiperSlide key={lesson.id} className={styles.swiperSlide}>
            <ImmersiveSlide
              lesson={lesson}
              localBlob={clipMap[lesson.sourceIdOrBlobKey]}
              active={index === safeActiveIndex}
              shouldPrepare={index === safeActiveIndex || index === safeActiveIndex + 1}
              favorite={favorites.includes(lesson.id)}
              showRomaji={settings.showRomaji}
              showPlaybackKnowledge={settings.showPlaybackKnowledge}
              showJapaneseSubtitle={settings.showJapaneseSubtitle}
              showChineseSubtitle={settings.showChineseSubtitle}
              onToggleFavorite={(lessonId) => void toggleFavorite(lessonId)}
              onAddReview={handleAddReview}
              onRecordCompletion={handleRecordCompletion}
            />
          </SwiperSlide>
        ))}
      </Swiper>

      <div className={styles.swipeHint}>
        <span>手指上滑 / 鼠标滚轮 / 键盘上下键切换下一条</span>
      </div>
    </div>
  )
}
