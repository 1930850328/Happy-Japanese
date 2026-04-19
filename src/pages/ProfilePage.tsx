import { AnimeStudyPlayer, type StudyPlayerSnapshot } from 'anime-study-player'
import {
  BellRing,
  CheckCircle2,
  Flame,
  Link2,
  Play,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Video,
  Wand2,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { sourceAttributions } from '../data/sources'
import { countStreak, getMonthCalendar, groupProgressByDate } from '../lib/date'
import { buildLessonsFromImportedClip } from '../lib/lessonSlices'
import { getCompletedDateSet, getGoalCompletionRatio, getTodayProgress } from '../lib/selectors'
import { enrichSegmentsWithSentenceTranslations } from '../lib/subtitleDisplay'
import { buildStudyDataFromCues, parseSubtitleFile } from '../lib/subtitles'
import { ensureBrowserPlayableVideo } from '../lib/videoPlayback'
import { readVideoCoverAt, readVideoMeta } from '../lib/videoMeta'
import { useAppStore } from '../store/useAppStore'
import type { ImportedClip, SlicePreviewDraft, TranscriptSegment, VideoLesson } from '../types'
import styles from './ProfilePage.module.css'

interface SlicePreviewOverlayProps {
  lesson: VideoLesson
  file: File
  showRomaji: boolean
  showPlaybackKnowledge: boolean
  showJapaneseSubtitle: boolean
  showChineseSubtitle: boolean
  onClose: () => void
}


function OverlayPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(children, document.body)
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatRange(startMs: number, endMs: number) {
  return `${formatDuration(startMs)} - ${formatDuration(endMs)}`
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function deriveTaskProgress(message: string, previousPercent: number) {
  const downloadMatch = message.match(/(\d{1,3})%/)
  const embeddedPercent = downloadMatch ? Number(downloadMatch[1]) : null

  let percent = previousPercent
  if (message.includes('检查视频播放兼容性')) {
    percent = 6
  } else if (message.includes('准备视频兼容引擎')) {
    percent = 10
  } else if (message.includes('转换为浏览器兼容格式')) {
    percent = embeddedPercent === null ? 16 : 16 + embeddedPercent * 0.14
  } else if (message.includes('已转换为浏览器兼容格式')) {
    percent = 30
  } else
  if (message.includes('读取视频信息')) {
    percent = 8
  } else if (message.includes('解析外部字幕')) {
    percent = 22
  } else if (message.includes('准备音频引擎')) {
    percent = 12
  } else if (message.includes('从视频中提取音频')) {
    percent = embeddedPercent === null ? 18 : 18 + embeddedPercent * 0.2
  } else if (message.includes('正在加载 Whisper') || message.includes('正在加载')) {
    percent = 40
  } else if (message.includes('下载字幕模型中')) {
    percent = embeddedPercent === null ? 48 : 48 + embeddedPercent * 0.18
  } else if (message.includes('已就绪')) {
    percent = 66
  } else if (message.includes('识别日语字幕中')) {
    percent = 72
  } else if (message.includes('生成中文字幕与知识点中')) {
    percent = 84
  } else if (message.includes('正在分析并切片')) {
    percent = 92
  } else if (message.includes('已生成')) {
    percent = 100
  } else if (message.includes('已导入')) {
    percent = 100
  }

  return {
    percent: clampProgress(Math.max(previousPercent, percent)),
    detail: message,
  }
}

function SlicePreviewOverlay({
  lesson,
  file,
  showRomaji,
  showPlaybackKnowledge,
  showJapaneseSubtitle,
  showChineseSubtitle,
  onClose,
}: SlicePreviewOverlayProps) {
  const [state, setState] = useState<StudyPlayerSnapshot | null>(null)
  const [objectUrl, setObjectUrl] = useState('')
  const [sourceStatus, setSourceStatus] = useState('正在检查视频兼容性…')
  const [preparingSource, setPreparingSource] = useState(true)
  const [playbackSegments, setPlaybackSegments] = useState<TranscriptSegment[]>(lesson.segments)
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    let canceled = false
    setPlaybackSegments(lesson.segments)

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
    let canceled = false

    const releaseObjectUrl = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }

    const prepareSource = async () => {
      setPreparingSource(true)
      setSourceStatus('正在检查视频兼容性…')

      try {
        const { file: playbackFile, converted } = await ensureBrowserPlayableVideo(file, (message) => {
          if (!canceled) {
            setSourceStatus(message)
          }
        })

        if (canceled) {
          return
        }

        releaseObjectUrl()
        const nextUrl = URL.createObjectURL(playbackFile)
        objectUrlRef.current = nextUrl
        setObjectUrl(nextUrl)
        setSourceStatus(converted ? '已转换为兼容格式，正在准备预览…' : '视频已准备完成')
      } catch (error) {
        if (canceled) {
          return
        }

        setSourceStatus(
          error instanceof Error ? error.message : '当前视频暂时无法预览，请换一个更通用的编码格式。',
        )
        setObjectUrl('')
      } finally {
        if (!canceled) {
          setPreparingSource(false)
        }
      }
    }

    void prepareSource()

    return () => {
      canceled = true
      releaseObjectUrl()
    }
  }, [file])

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  const activePoints = state?.activePoints ?? []

  return (
    <OverlayPortal>
      <div className={styles.previewBackdrop} onClick={onClose}>
        <section className={styles.previewPanel} onClick={(event) => event.stopPropagation()}>
          <header className={styles.previewPanelHeader}>
            <div>
              <span className="chip badgeMint">{lesson.sliceLabel ?? '候选切片'}</span>
              <h2>{lesson.title}</h2>
              <p>{formatRange(lesson.clipStartMs ?? 0, lesson.clipEndMs ?? lesson.durationMs)}</p>
            </div>
            <button className="softButton" onClick={onClose}>
              <X size={18} />
              关闭
            </button>
          </header>

          {objectUrl ? (
          <AnimeStudyPlayer
            url={objectUrl}
            poster={lesson.cover}
            title={lesson.title}
            sourceLabel="页面切片预览"
            durationMs={lesson.durationMs}
            clipStartMs={lesson.clipStartMs ?? 0}
            clipEndMs={lesson.clipEndMs ?? (lesson.clipStartMs ?? 0) + lesson.durationMs}
            segments={playbackSegments}
            knowledgePoints={lesson.knowledgePoints}
            showRomaji={showRomaji}
            showSubtitleReading={false}
            showJapaneseSubtitle={showJapaneseSubtitle}
            showChineseSubtitle={showChineseSubtitle}
            onStateChange={setState}
            onFinish={() => undefined}
            onError={() => undefined}
          />
          ) : (
            <div className={styles.previewPlayerLoading}>
              <strong>{preparingSource ? '正在准备预览播放器…' : '预览暂时还没准备好'}</strong>
              <span>{sourceStatus || '片段文件已经切好，播放器初始化完成后会自动开始预览。'}</span>
            </div>
          )}

          {showPlaybackKnowledge && activePoints.length > 0 ? (
            <div className={styles.previewPointRow}>
              {activePoints.map((point) => (
                <div key={point.id} className={styles.previewPointChip}>
                  <small>{point.kind === 'grammar' ? '语法' : '词句'}</small>
                  <strong>{point.expression}</strong>
                  <span>{point.meaningZh}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </OverlayPortal>
  )
}

export function ProfilePage() {
  const goal = useAppStore((state) => state.goal)
  const studyEvents = useAppStore((state) => state.studyEvents)
  const favorites = useAppStore((state) => state.favorites)
  const lessons = useAppStore((state) => state.lessons)
  const importedClips = useAppStore((state) => state.importedClips)
  const settings = useAppStore((state) => state.settings)
  const updateGoal = useAppStore((state) => state.updateGoal)
  const importSlicerManifest = useAppStore((state) => state.importSlicerManifest)
  const importSelectedSlices = useAppStore((state) => state.importSelectedSlices)
  const generateAutoSubtitles = useAppStore((state) => state.generateAutoSubtitles)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const deleteLocalLesson = useAppStore((state) => state.deleteLocalLesson)
  const persistedSliceTask = useAppStore((state) => state.sliceTask)
  const persistedSlicePreview = useAppStore((state) => state.slicePreviewDraft)
  const setSliceTask = useAppStore((state) => state.setSliceTask)
  const setSlicePreviewDraft = useAppStore((state) => state.setSlicePreviewDraft)
  const clearSliceWorkflow = useAppStore((state) => state.clearSliceWorkflow)

  const [goalForm, setGoalForm] = useState({
    videosTarget: String(goal.videosTarget),
    wordsTarget: String(goal.wordsTarget),
    grammarTarget: String(goal.grammarTarget),
    reviewTarget: String(goal.reviewTarget),
  })
  const [clipTitle, setClipTitle] = useState('')
  const [clipTheme, setClipTheme] = useState('')
  const [episodeTitle, setEpisodeTitle] = useState('')
  const [clipFile, setClipFile] = useState<File | null>(null)
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null)
  const [siteUploadPassword, setSiteUploadPassword] = useState('')
  const [slicePreview, setSlicePreview] = useState<SlicePreviewDraft | null>(persistedSlicePreview)
  const [selectedSliceIds, setSelectedSliceIds] = useState<string[]>(
    persistedSlicePreview?.selectedLessonIds ?? [],
  )
  const [previewLessonId, setPreviewLessonId] = useState<string | null>(null)
  const [buildingPreview, setBuildingPreview] = useState(persistedSliceTask.status === 'running')
  const [importingSlices, setImportingSlices] = useState(false)
  const [busyClipId, setBusyClipId] = useState<string | null>(null)
  const [statusText, setStatusText] = useState(persistedSliceTask.detail)
  const [taskProgress, setTaskProgress] = useState<{
    percent: number
    detail: string
  } | null>(
    persistedSliceTask.status === 'idle'
      ? null
      : { percent: persistedSliceTask.percent, detail: persistedSliceTask.detail },
  )
  const [slicerManifestFile, setSlicerManifestFile] = useState<File | null>(null)
  const [slicerClipFiles, setSlicerClipFiles] = useState<File[]>([])
  const [importingSlicer, setImportingSlicer] = useState(false)
  const [slicerStatusText, setSlicerStatusText] = useState('')

  useEffect(() => {
    setGoalForm({
      videosTarget: String(goal.videosTarget),
      wordsTarget: String(goal.wordsTarget),
      grammarTarget: String(goal.grammarTarget),
      reviewTarget: String(goal.reviewTarget),
    })
  }, [goal])

  useEffect(() => {
    if (previewLessonId && !slicePreview?.lessons.some((lesson) => lesson.id === previewLessonId)) {
      setPreviewLessonId(null)
    }
  }, [previewLessonId, slicePreview])

  useEffect(() => {
    setSlicePreview(persistedSlicePreview)
    setSelectedSliceIds(persistedSlicePreview?.selectedLessonIds ?? [])
  }, [persistedSlicePreview])

  useEffect(() => {
    setBuildingPreview(persistedSliceTask.status === 'running')
    setStatusText(persistedSliceTask.detail)
    setTaskProgress(
      persistedSliceTask.status === 'idle'
        ? null
        : {
            percent: persistedSliceTask.percent,
            detail: persistedSliceTask.detail,
          },
    )
  }, [persistedSliceTask])

  const todayProgress = getTodayProgress(studyEvents)
  const completionRatio = getGoalCompletionRatio(todayProgress, goal)
  const completedDates = getCompletedDateSet(studyEvents, goal)
  const streak = countStreak(completedDates)
  const scoreMap = groupProgressByDate(studyEvents, goal)
  const calendar = getMonthCalendar(scoreMap, goal)
  const favoriteLessons = lessons.filter((lesson) => favorites.includes(lesson.id))
  const visibleImportedClips = useMemo(
    () => importedClips.filter((clip) => clip.importMode !== 'source'),
    [importedClips],
  )
  const sliceCountMap = useMemo(() => {
    return lessons.reduce<Record<string, number>>((acc, lesson) => {
      const clipId = lesson.originClipId
      if (!clipId) {
        return acc
      }
      acc[clipId] = (acc[clipId] ?? 0) + 1
      return acc
    }, {})
  }, [lessons])
  const monthlyCompleteCount = useMemo(() => {
    return calendar.filter((cell) => cell.inCurrentMonth && cell.completed).length
  }, [calendar])
  const selectedPreviewLessons = useMemo(() => {
    if (!slicePreview) {
      return []
    }
    const selectedIdSet = new Set(slicePreview.selectedLessonIds)
    return slicePreview.lessons.filter((lesson) => selectedIdSet.has(lesson.id))
  }, [slicePreview])
  const previewLesson =
    slicePreview?.lessons.find((lesson) => lesson.id === previewLessonId) ?? null

  const updateTaskStatus = (message: string) => {
    setStatusText(message)
    setTaskProgress((state) => {
      const nextProgress = deriveTaskProgress(message, state?.percent ?? persistedSliceTask.percent)
      setSliceTask({
        status: nextProgress.percent >= 100 ? 'completed' : 'running',
        percent: nextProgress.percent,
        detail: nextProgress.detail,
        startedAt: persistedSliceTask.startedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      return nextProgress
    })
  }

  const handleGoalSave = async () => {
    await updateGoal({
      videosTarget: Number(goalForm.videosTarget) || 0,
      wordsTarget: Number(goalForm.wordsTarget) || 0,
      grammarTarget: Number(goalForm.grammarTarget) || 0,
      reviewTarget: Number(goalForm.reviewTarget) || 0,
    })
  }

  const handleGenerateForClip = async (clipId: string) => {
    setBusyClipId(clipId)
    const startedAt = new Date().toISOString()
    setSliceTask({
      status: 'running',
      percent: 6,
      detail: '正在准备自动字幕…',
      startedAt,
      updatedAt: startedAt,
    })
    updateTaskStatus('准备自动字幕中…')
    try {
      await generateAutoSubtitles(clipId, (message) => updateTaskStatus(message))
      setSliceTask({
        status: 'completed',
        percent: 100,
        detail: '自动字幕已生成完成，可以继续切片或回到首页学习。',
        startedAt,
        updatedAt: new Date().toISOString(),
      })
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : '自动字幕生成失败。当前只支持按字幕里的语法和单词切片。'
      setSliceTask({
        status: 'error',
        percent: 0,
        detail,
        startedAt,
        updatedAt: new Date().toISOString(),
      })
      setStatusText(detail)
    } finally {
      setBusyClipId(null)
    }
  }

  const handleBuildSlicePreview = async () => {
    if (!clipFile) {
      return
    }

    const startedAt = new Date().toISOString()
    setSlicePreviewDraft(null)
    setBuildingPreview(true)
    setSliceTask({
      status: 'running',
      percent: 4,
      detail: '正在准备切片任务…',
      startedAt,
      updatedAt: startedAt,
    })
    setTaskProgress({ percent: 4, detail: '正在准备切片任务…' })
    updateTaskStatus('正在读取视频信息…')

    try {
      const normalizedTitle = clipTitle.trim() || clipFile.name.replace(/\.[^.]+$/, '')
      const normalizedTheme = clipTheme.trim() || '日语原片'
      const { file: playbackFile, converted } = await ensureBrowserPlayableVideo(
        clipFile,
        (message) => updateTaskStatus(message),
      )
      const { durationMs, cover } = await readVideoMeta(playbackFile, normalizedTitle, normalizedTheme)

      let subtitleSource: ImportedClip['subtitleSource']
      let subtitleFileName: string | undefined
      let sourceProvider = '页面自动切片预览'
      let segments: ImportedClip['segments'] = []
      let knowledgePoints: ImportedClip['knowledgePoints'] = []
      let autoSubtitleTag: string | undefined

      if (subtitleFile) {
        updateTaskStatus('正在解析外部字幕并提取知识点…')
        const cues = await parseSubtitleFile(subtitleFile)
        const studyData = await buildStudyDataFromCues(cues)
        segments = studyData.segments
        knowledgePoints = studyData.knowledgePoints
        subtitleSource = 'manual'
        subtitleFileName = subtitleFile.name
        sourceProvider = '页面自动切片预览 / 外部字幕'
      } else {
        const { generateStudyDataFromVideo } = await import('../lib/autoSubtitlesStrict')
        const studyData = await generateStudyDataFromVideo(playbackFile, durationMs, (message) =>
          updateTaskStatus(message),
        )
        segments = studyData.segments
        knowledgePoints = studyData.knowledgePoints
        autoSubtitleTag = studyData.usedFallback ? '字幕兜底' : undefined
        subtitleSource = 'auto'
        subtitleFileName = '自动生成字幕'
        sourceProvider = `页面自动切片预览 / ${studyData.modelLabel}`
      }

      updateTaskStatus('正在分析并切片…')

      const previewClip: ImportedClip = {
        id: `preview-${crypto.randomUUID()}`,
        title: normalizedTitle,
        theme: normalizedTheme,
        difficulty: 'Custom',
        importMode: 'raw',
        sourceAnimeTitle: normalizedTitle,
        sourceEpisodeTitle: episodeTitle.trim() || undefined,
        sourceType: 'local',
        sourceIdOrBlobKey: `preview-blob-${crypto.randomUUID()}`,
        sourceUrl: '',
        sourceProvider,
        cover,
        durationMs,
        fileType: clipFile.type || 'video/mp4',
        subtitleFileName,
        subtitleSource,
        blob: playbackFile,
        createdAt: new Date().toISOString(),
        segments,
        knowledgePoints,
        tags: [
          '页面切片预览',
          normalizedTheme,
          autoSubtitleTag,
          subtitleSource === 'manual' ? '外部字幕' : '自动字幕',
          converted ? '兼容转换' : undefined,
        ].filter(Boolean) as string[],
        description: '这是页面里生成的临时切片预览，确认后才会正式导入首页短视频流。',
        creditLine: '预览结果仅保留在当前页面中，点击导入后才会持久化到本地学习库。',
      }

      const candidateLessons = buildLessonsFromImportedClip(previewClip)
      if (candidateLessons.length === 0) {
        throw new Error(
          '没有找到足够的语法/单词切片。当前不会再按时间粗切，请先导入字幕文件，或换更短、更清晰的片段。',
        )
      }

      const previewLessons = await Promise.all(
        candidateLessons.map(async (lesson) => {
          const clipCover = await readVideoCoverAt(
            playbackFile,
            lesson.title,
            normalizedTheme,
            (lesson.clipStartMs ?? 0) + Math.max(300, Math.min(lesson.durationMs / 2, 1500)),
          ).catch(() => cover)

          return {
            ...lesson,
            cover: clipCover,
          }
        }),
      )
      setSlicePreview({
        file: playbackFile,
        title: normalizedTitle,
        theme: normalizedTheme,
        episodeTitle: episodeTitle.trim(),
        cover,
        durationMs,
        subtitleFileName,
        subtitleSource,
        sourceProvider,
        segments,
        knowledgePoints,
        lessons: previewLessons,
        selectedLessonIds: previewLessons.map((lesson) => lesson.id),
      })
      setSlicePreviewDraft({
        file: playbackFile,
        title: normalizedTitle,
        theme: normalizedTheme,
        episodeTitle: episodeTitle.trim(),
        cover,
        durationMs,
        subtitleFileName,
        subtitleSource,
        sourceProvider,
        segments,
        knowledgePoints,
        lessons: previewLessons,
        selectedLessonIds: previewLessons.map((lesson) => lesson.id),
      })
      setSelectedSliceIds(previewLessons.map((lesson) => lesson.id))
      setPreviewLessonId(null)
      setSliceTask({
        status: 'completed',
        percent: 100,
        detail: `已生成 ${previewLessons.length} 条候选切片，可以先预览再决定是否导入。`,
        startedAt,
        updatedAt: new Date().toISOString(),
      })
      updateTaskStatus(`已生成 ${previewLessons.length} 条候选切片，可以先预览再决定是否导入。`)
    } catch (error) {
      setSlicePreview(null)
      setSelectedSliceIds([])
      setSlicePreviewDraft(null)
      setPreviewLessonId(null)
      setTaskProgress(null)
      setSliceTask({
        status: 'error',
        percent: 0,
        detail: error instanceof Error ? error.message : '切片预览生成失败，请换一个文件重试。',
        startedAt,
        updatedAt: new Date().toISOString(),
      })
      setStatusText(error instanceof Error ? error.message : '切片预览生成失败，请换一个文件重试。')
    } finally {
      setBuildingPreview(false)
    }
  }

  const handleImportSelectedSlices = async () => {
    if (!slicePreview || selectedPreviewLessons.length === 0) {
      return
    }

    setImportingSlices(true)
    setTaskProgress({ percent: 94, detail: '正在把勾选切片上传到网站并写入首页短视频流…' })
    setStatusText('正在把勾选切片上传到网站并写入首页短视频流…')

    try {
      const imported = await importSelectedSlices({
        file: slicePreview.file,
        title: slicePreview.title,
        theme: slicePreview.theme,
        cover: slicePreview.cover,
        durationMs: slicePreview.durationMs,
        subtitleFileName: slicePreview.subtitleFileName,
        subtitleSource: slicePreview.subtitleSource,
        sourceProvider: slicePreview.sourceProvider,
        sourceAnimeTitle: slicePreview.title,
        sourceEpisodeTitle: slicePreview.episodeTitle || undefined,
        baseSegments: slicePreview.segments,
        baseKnowledgePoints: slicePreview.knowledgePoints,
        selectedLessons: selectedPreviewLessons,
        uploadPassword: siteUploadPassword.trim() || undefined,
        onUploadProgress: (message, percent = 0) => {
          const mappedPercent = Math.min(99, 94 + Math.round(percent * 0.05))
          setTaskProgress({ percent: mappedPercent, detail: message })
          setStatusText(message)
        },
      })

      setTaskProgress({
        percent: 100,
        detail: `已导入 ${imported.length} 条切片，视频文件现在保存在网站上。`,
      })
      setStatusText(`已导入 ${imported.length} 条切片，视频文件现在保存在网站上。`)
      setSlicePreview(null)
      setSelectedSliceIds([])
      setSliceTask({
        status: 'completed',
        percent: 100,
        detail: `已导入 ${imported.length} 条切片，视频文件现在保存在网站上。`,
        startedAt: persistedSliceTask.startedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      setSlicePreviewDraft(null)
      setPreviewLessonId(null)
    } finally {
      setImportingSlices(false)
    }
  }

  const handleImportSlicerOutput = async () => {
    if (!slicerManifestFile || slicerClipFiles.length === 0) {
      return
    }

    setImportingSlicer(true)
    setSlicerStatusText('正在读取切片 manifest，并把视频上传到网站…')
    try {
      const imported = await importSlicerManifest({
        manifestFile: slicerManifestFile,
        clipFiles: slicerClipFiles,
        uploadPassword: siteUploadPassword.trim() || undefined,
        onUploadProgress: (message) => {
          setSlicerStatusText(message)
        },
      })
      setSlicerStatusText(`已导入 ${imported.length} 条切片，视频文件现在保存在网站上。`)
      setSlicerManifestFile(null)
      setSlicerClipFiles([])
    } catch (error) {
      setSlicerStatusText(error instanceof Error ? error.message : '切片导入失败。')
    } finally {
      setImportingSlicer(false)
    }
  }

  const handleDeleteImportedClip = async (clipId: string, clipTitle: string) => {
    const confirmed = window.confirm(`要删除「${clipTitle}」以及相关的短视频吗？`)
    if (!confirmed) {
      return
    }

    await deleteLocalLesson(clipId)
  }

  const handleToggleReminder = async () => {
    if (!settings.remindersEnabled && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => undefined)
    }
    await updateSettings({ remindersEnabled: !settings.remindersEnabled })
  }

  const togglePreviewSelection = (lessonId: string) => {
    setSelectedSliceIds((state) => {
      const nextSelectedIds = state.includes(lessonId)
        ? state.filter((id) => id !== lessonId)
        : [...state, lessonId]

      if (slicePreview) {
        setSlicePreviewDraft({
          ...slicePreview,
          selectedLessonIds: nextSelectedIds,
        })
      }

      return nextSelectedIds
    })
  }

  return (
    <div className={`${styles.page} fadeIn`}>
      <section className={styles.hero}>
        <div>
          <span className="chip badgeMint">目标 / 导入 / 设置</span>
          <h1 className="pageTitle">把切片、预览和导入都收在一个页面里完成</h1>
          <p className="sectionIntro">
            现在你只需要在页面里选择番剧文件。系统会自动读取视频、生成字幕、提炼知识点、做候选切片，再让你先看结果、再勾选导入首页短视频流。
          </p>
        </div>

        <div className={`${styles.highlightCard} glassCard`}>
          <div className={styles.streakBadge}>
            <Flame size={20} />
            连续打卡 {streak} 天
          </div>
          <p>
            {completionRatio >= 1
              ? '今天的目标已经全部完成，继续保持这个轻松但稳定的节奏。'
              : '今天还差一点点，再推进一个小目标就能顺利打卡。'}
          </p>
          <div className={styles.highlightStats}>
            <span>本月完成 {monthlyCompleteCount} 天</span>
            <span>收藏 {favoriteLessons.length} 条</span>
          </div>
        </div>
      </section>

      <section className={styles.grid}>
        <div className={`${styles.card} glassCard`}>
          <header className={styles.cardHeader}>
            <div>
              <span className="chip badgePeach">每日目标</span>
              <h2>今天想推进多少</h2>
            </div>
          </header>

          <div className={styles.goalForm}>
            <label>
              <span>视频</span>
              <input
                type="number"
                min="0"
                value={goalForm.videosTarget}
                onChange={(event) =>
                  setGoalForm((state) => ({ ...state, videosTarget: event.target.value }))
                }
              />
            </label>
            <label>
              <span>单词</span>
              <input
                type="number"
                min="0"
                value={goalForm.wordsTarget}
                onChange={(event) =>
                  setGoalForm((state) => ({ ...state, wordsTarget: event.target.value }))
                }
              />
            </label>
            <label>
              <span>语法</span>
              <input
                type="number"
                min="0"
                value={goalForm.grammarTarget}
                onChange={(event) =>
                  setGoalForm((state) => ({ ...state, grammarTarget: event.target.value }))
                }
              />
            </label>
            <label>
              <span>复习</span>
              <input
                type="number"
                min="0"
                value={goalForm.reviewTarget}
                onChange={(event) =>
                  setGoalForm((state) => ({ ...state, reviewTarget: event.target.value }))
                }
              />
            </label>
          </div>

          <button className="softButton primaryButton" onClick={() => void handleGoalSave()}>
            <Save size={18} />
            保存目标
          </button>
        </div>

        <div className={`${styles.card} glassCard`}>
          <header className={styles.cardHeader}>
            <div>
              <span className="chip badgePink">打卡日历</span>
              <h2>这个月已经亮起来的日子</h2>
            </div>
          </header>

          <div className={styles.calendar}>
            {calendar.map((cell) => (
              <div
                key={cell.key}
                className={`${styles.dayCell} ${cell.inCurrentMonth ? '' : styles.dayCellMuted}`}
                style={{
                  opacity: cell.inCurrentMonth ? Math.max(cell.ratio, 0.16) : 0.12,
                  background: cell.completed
                    ? 'linear-gradient(135deg, rgba(255,198,173,0.96), rgba(207,234,223,0.9))'
                    : 'rgba(255,255,255,0.8)',
                }}
                title={cell.key}
              >
                {cell.date.getDate()}
              </div>
            ))}
          </div>
        </div>

        <div className={`${styles.card} glassCard ${styles.importCard}`}>
          <header className={styles.cardHeader}>
            <div>
              <span className="chip badgePeach">一键切片预览</span>
              <h2>页面里直接选番剧文件，然后先看切片结果</h2>
            </div>
          </header>

          <div className={styles.uploadForm}>
            <div className={styles.fileGrid}>
              <input
                className={styles.fileInput}
                type="file"
                accept="video/*,.mp4,.mkv,.mov,.webm,.avi"
                onChange={(event) => setClipFile(event.target.files?.[0] ?? null)}
              />
              <input
                className={styles.fileInput}
                type="file"
                accept=".srt,.vtt,.ass,text/vtt,application/x-subrip"
                onChange={(event) => setSubtitleFile(event.target.files?.[0] ?? null)}
              />
            </div>

            <div className={styles.fileMeta}>
              <input
                className={styles.textInput}
                value={clipTitle}
                onChange={(event) => setClipTitle(event.target.value)}
                placeholder="番剧或片段标题，不填就使用文件名"
              />
              <input
                className={styles.textInput}
                value={episodeTitle}
                onChange={(event) => setEpisodeTitle(event.target.value)}
                placeholder="集数或片段编号，例如 EP01 / 第3话"
              />
              <input
                className={styles.textInput}
                value={clipTheme}
                onChange={(event) => setClipTheme(event.target.value)}
                placeholder="主题，例如 校园 / 乐队 / 日常 / 面试"
              />
              <input
                className={styles.textInput}
                type="password"
                value={siteUploadPassword}
                onChange={(event) => setSiteUploadPassword(event.target.value)}
                placeholder="网站上传密码，可选；已配置 VIDEO_UPLOAD_PASSWORD 时填写"
              />
            </div>

            <p className={styles.helperNote}>
              你只管选本地视频。系统会优先使用你提供的字幕；如果没有字幕，就自动抽取音频并生成时间轴字幕，然后挑出更适合学语法和单词的候选切片给你预览。确认导入后，视频文件会上传到你的网站存储，不再依赖当前浏览器本地保存。
            </p>
            {statusText ? <p className={styles.statusNote}>{statusText}</p> : null}
            {taskProgress ? (
              <div className={styles.progressCard} aria-live="polite">
                <div className={styles.progressMeta}>
                  <strong>{taskProgress.detail}</strong>
                  <span>{taskProgress.percent}%</span>
                </div>
                <div className={styles.progressTrack}>
                  <span
                    className={styles.progressFill}
                    style={{ width: `${taskProgress.percent}%` }}
                  />
                </div>
                <small className={styles.progressHint}>
                  字幕识别现在会在后台 worker 中执行，页面应该不会再整页卡死。
                </small>
              </div>
            ) : null}

            <div className={styles.actionRow}>
              <button
                className="softButton primaryButton"
                onClick={() => void handleBuildSlicePreview()}
                disabled={buildingPreview || !clipFile}
              >
                <Wand2 size={18} />
                {buildingPreview ? '正在分析并切片…' : '生成切片预览'}
              </button>

              {slicePreview ? (
                <button
                  className="softButton"
                  onClick={() => {
                    setSlicePreview(null)
                    setSelectedSliceIds([])
                    clearSliceWorkflow()
                    setPreviewLessonId(null)
                    setTaskProgress(null)
                    setStatusText('已清空本次切片预览。')
                  }}
                >
                  <X size={18} />
                  清空预览
                </button>
              ) : null}
            </div>
          </div>

          {slicePreview ? (
            <div className={styles.previewSection}>
              <div className={styles.previewHeader}>
                <div>
                  <span className="chip badgeMint">候选切片 {slicePreview.lessons.length} 条</span>
                  <h3 className={styles.subTitle}>
                    {slicePreview.title}
                    {slicePreview.episodeTitle ? ` / ${slicePreview.episodeTitle}` : ''}
                  </h3>
                  <p className={styles.previewSummary}>
                    原片时长 {formatDuration(slicePreview.durationMs)}，当前已勾选{' '}
                    {selectedPreviewLessons.length} 条准备导入首页短视频流。
                  </p>
                </div>

                <div className={styles.previewHeaderActions}>
                  <button
                    className="softButton"
                    onClick={() => {
                      const nextSelectedIds = slicePreview.lessons.map((lesson) => lesson.id)
                      setSelectedSliceIds(nextSelectedIds)
                      setSlicePreviewDraft({
                        ...slicePreview,
                        selectedLessonIds: nextSelectedIds,
                      })
                    }}
                  >
                    <CheckCircle2 size={18} />
                    全选
                  </button>
                  <button
                    className="softButton"
                    onClick={() => {
                      setSelectedSliceIds([])
                      setSlicePreviewDraft({
                        ...slicePreview,
                        selectedLessonIds: [],
                      })
                    }}
                  >
                    <X size={18} />
                    清空勾选
                  </button>
                  <button
                    className="softButton primaryButton"
                    onClick={() => void handleImportSelectedSlices()}
                    disabled={importingSlices || selectedPreviewLessons.length === 0}
                  >
                    <Upload size={18} />
                    {importingSlices
                      ? '正在导入…'
                      : `导入勾选的 ${selectedPreviewLessons.length} 条切片`}
                  </button>
                </div>
              </div>

              <div className={styles.previewGrid}>
                {slicePreview.lessons.map((lesson) => {
                  const selected = selectedSliceIds.includes(lesson.id)
                  const leadSegment = lesson.segments[0]
                  return (
                    <article
                      key={lesson.id}
                      className={`${styles.previewCard} ${selected ? styles.previewCardSelected : ''}`}
                    >
                      <div className={styles.previewCardTop}>
                        <label className={styles.checkboxRow}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => togglePreviewSelection(lesson.id)}
                          />
                          <span>导入这条切片</span>
                        </label>
                        <span className="chip">{lesson.sliceLabel}</span>
                      </div>

                      <button
                        className={styles.previewPosterButton}
                        onClick={() => setPreviewLessonId(lesson.id)}
                      >
                        <img src={lesson.cover} alt={lesson.title} />
                        <span className={styles.previewPosterShade} />
                        <span className={styles.previewPosterPlay}>
                          <Play size={18} />
                          预览
                        </span>
                      </button>

                      <div className={styles.previewBody}>
                        <strong>{lesson.title}</strong>
                        <span className={styles.previewMeta}>
                          {formatRange(lesson.clipStartMs ?? 0, lesson.clipEndMs ?? lesson.durationMs)}
                        </span>
                        <p>{lesson.description}</p>

                        {leadSegment ? (
                          <div className={styles.previewSentence}>
                            <strong>{leadSegment.ja}</strong>
                            <span>
                              {settings.showRomaji
                                ? `${leadSegment.kana} / ${leadSegment.romaji}`
                                : leadSegment.kana}
                            </span>
                            <p>{leadSegment.zh}</p>
                          </div>
                        ) : null}

                        <div className={styles.previewChips}>
                          {lesson.knowledgePoints.slice(0, 4).map((point) => (
                            <span key={point.id} className="chip badgePeach">
                              {point.kind === 'grammar' ? '语法' : '词句'} · {point.expression}
                            </span>
                          ))}
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>
          ) : null}

          <div className={styles.subSection}>
            <div>
              <span className="chip badgeMint">高级导入</span>
              <h3 className={styles.subTitle}>导入独立切片工具产物</h3>
            </div>

            <div className={styles.uploadForm}>
              <input
                className={styles.fileInput}
                type="file"
                accept=".json,application/json"
                onChange={(event) => setSlicerManifestFile(event.target.files?.[0] ?? null)}
              />
              <input
                className={styles.fileInput}
                type="file"
                multiple
                accept="video/*,.mp4,.mkv,.mov,.webm,.avi"
                onChange={(event) => setSlicerClipFiles(Array.from(event.target.files ?? []))}
              />
              <p className={styles.helperNote}>
                如果你已经用独立切片工具生成了 `manifest.json + clips`，也可以在这里直接一次性导入首页短视频流。上面的“网站上传密码”会同时用于这批视频文件。
              </p>
              {slicerStatusText ? <p className={styles.statusNote}>{slicerStatusText}</p> : null}
              <button
                className="softButton"
                onClick={() => void handleImportSlicerOutput()}
                disabled={importingSlicer || !slicerManifestFile || slicerClipFiles.length === 0}
              >
                <Video size={18} />
                {importingSlicer ? '导入切片中…' : '导入切片工具产物'}
              </button>
            </div>
          </div>

          <div className={styles.favoriteList}>
            {visibleImportedClips.map((clip) => {
              const clipStatus =
                clip.importMode === 'sliced'
                  ? `已导入切片 / ${clip.sourceAnimeTitle ?? '页面切片'}`
                  : clip.subtitleSource === 'auto'
                    ? '已自动生成双语字幕'
                    : clip.subtitleSource === 'manual'
                      ? `已绑定字幕 / ${clip.subtitleFileName}`
                      : '还没有字幕'
              const clipSummary =
                clip.importMode === 'sliced'
                  ? `片段区间 ${formatRange(
                      clip.clipStartMs ?? 0,
                      clip.clipEndMs ?? (clip.clipStartMs ?? 0) + clip.durationMs,
                    )}`
                  : `当前已切出 ${sliceCountMap[clip.id] ?? 1} 段可学习短视频。`

              return (
                <article key={clip.id} className={styles.clipCard}>
                  <img className={styles.clipCover} src={clip.cover} alt={clip.title} />
                  <div className={styles.clipMeta}>
                    <div className={styles.clipTitleRow}>
                      <Video size={16} />
                      <strong>{clip.title}</strong>
                    </div>
                    <span>
                      {clip.theme} / {clipStatus}
                    </span>
                    <small>{clipSummary}</small>
                    {busyClipId === clip.id ? <small>{statusText}</small> : null}
                  </div>

                  <div className={styles.clipActions}>
                    {clip.importMode === 'raw' ? (
                      <button
                        className="softButton"
                        onClick={() => void handleGenerateForClip(clip.id)}
                        disabled={busyClipId === clip.id}
                      >
                        <Sparkles size={16} />
                        {busyClipId === clip.id
                          ? '生成中…'
                          : clip.subtitleSource === 'auto'
                            ? '重新生成字幕'
                            : '自动生成字幕'}
                      </button>
                    ) : null}
                    <button
                      className="softButton"
                      onClick={() => void handleDeleteImportedClip(clip.id, clip.title)}
                      aria-label={`删除 ${clip.title}`}
                      title="删除这个导入片段以及相关短视频"
                    >
                      <Trash2 size={16} />
                      删除
                    </button>
                  </div>
                </article>
              )
            })}
            {visibleImportedClips.length === 0 ? (
              <p className={styles.placeholder}>导入后的视频文件会上传到网站存储；当前浏览器只保留学习资料和导入记录。</p>
            ) : null}
          </div>
        </div>
        <div className={`${styles.card} glassCard`}>
          <header className={styles.cardHeader}>
            <div>
              <span className="chip badgePink">Settings</span>
              <h2>Tune the subtitle experience</h2>
            </div>
          </header>

          <div className={styles.settingList}>
            <button className={styles.settingItem} onClick={() => void handleToggleReminder()}>
              <div>
                <strong>Study reminder</strong>
                <span>Current: {settings.remindersEnabled ? 'On' : 'Off'}</span>
              </div>
              <BellRing size={18} />
            </button>

            <button
              className={styles.settingItem}
              onClick={() =>
                void updateSettings({ showPlaybackKnowledge: !settings.showPlaybackKnowledge })
              }
            >
              <div>
                <strong>Playback knowledge</strong>
                <span>
                  Current: {settings.showPlaybackKnowledge ? 'Show grammar hints' : 'Subtitles only'}
                </span>
              </div>
              <Sparkles size={18} />
            </button>

            <button
              className={styles.settingItem}
              onClick={() => void updateSettings({ showRomaji: !settings.showRomaji })}
            >
              <div>
                <strong>Romaji</strong>
                <span>Current: {settings.showRomaji ? 'Show' : 'Hide'}</span>
              </div>
              <Settings2 size={18} />
            </button>

            <button
              className={styles.settingItem}
              onClick={() =>
                void updateSettings({ showJapaneseSubtitle: !settings.showJapaneseSubtitle })
              }
            >
              <div>
                <strong>Japanese subtitle</strong>
                <span>Current: {settings.showJapaneseSubtitle ? 'Show' : 'Hide'}</span>
              </div>
              <Settings2 size={18} />
            </button>

            <button
              className={styles.settingItem}
              onClick={() =>
                void updateSettings({ showChineseSubtitle: !settings.showChineseSubtitle })
              }
            >
              <div>
                <strong>Chinese subtitle</strong>
                <span>Current: {settings.showChineseSubtitle ? 'Show' : 'Hide'}</span>
              </div>
              <Settings2 size={18} />
            </button>
          </div>
        </div>

        <div className={`${styles.card} glassCard`}>
          <header className={styles.cardHeader}>
            <div>
              <span className="chip badgeMint">Sources</span>
              <h2>Credits and attributions</h2>
            </div>
          </header>

          <div className={styles.sourceList}>
            {sourceAttributions.map((source) => (
              <a key={source.id} href={source.href} target="_blank" rel="noreferrer">
                <div>
                  <strong>{source.title}</strong>
                  <span>
                    {source.provider} / {source.license}
                  </span>
                  <small>{source.note}</small>
                </div>
                <Link2 size={16} />
              </a>
            ))}
          </div>
        </div>
      </section>

      {previewLesson && slicePreview ? (
        <SlicePreviewOverlay
          lesson={previewLesson}
          file={slicePreview.file}
          showRomaji={settings.showRomaji}
          showPlaybackKnowledge={settings.showPlaybackKnowledge}
          showJapaneseSubtitle={settings.showJapaneseSubtitle}
          showChineseSubtitle={settings.showChineseSubtitle}
          onClose={() => setPreviewLessonId(null)}
        />
      ) : null}
    </div>
  )
}
