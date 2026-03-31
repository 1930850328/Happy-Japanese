import { AnimeStudyPlayer, type StudyPlayerSnapshot } from 'anime-study-player'
import {
  BellRing,
  CheckCircle2,
  Flame,
  Heart,
  Link2,
  Play,
  Save,
  Settings2,
  Sparkles,
  Upload,
  Video,
  Wand2,
  X,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { sourceAttributions } from '../data/sources'
import { generateStudyDataFromVideo } from '../lib/autoSubtitles'
import { countStreak, getMonthCalendar, groupProgressByDate } from '../lib/date'
import { buildLessonsFromImportedClip } from '../lib/lessonSlices'
import { getCompletedDateSet, getGoalCompletionRatio, getTodayProgress } from '../lib/selectors'
import { buildStudyDataFromCues, parseSubtitleFile } from '../lib/subtitles'
import { readVideoMeta } from '../lib/videoMeta'
import { useAppStore } from '../store/useAppStore'
import type { ImportedClip, VideoLesson } from '../types'
import styles from './ProfilePage.module.css'

interface SlicePreviewState {
  file: File
  title: string
  theme: string
  episodeTitle: string
  cover: string
  durationMs: number
  subtitleFileName?: string
  subtitleSource?: ImportedClip['subtitleSource']
  sourceProvider: string
  segments: ImportedClip['segments']
  knowledgePoints: ImportedClip['knowledgePoints']
  lessons: VideoLesson[]
}

interface SlicePreviewOverlayProps {
  lesson: VideoLesson
  file: File
  showRomaji: boolean
  onClose: () => void
}

interface TaskProgressState {
  percent: number
  detail: string
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

function SlicePreviewOverlay({ lesson, file, showRomaji, onClose }: SlicePreviewOverlayProps) {
  const [state, setState] = useState<StudyPlayerSnapshot | null>(null)
  const [objectUrl, setObjectUrl] = useState('')
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    const nextUrl = URL.createObjectURL(file)
    objectUrlRef.current = nextUrl
    setObjectUrl(nextUrl)
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [file])

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  const currentSegment = state?.currentSegment ?? lesson.segments[0]
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

          <AnimeStudyPlayer
            url={objectUrl}
            poster={lesson.cover}
            title={lesson.title}
            sourceLabel="页面切片预览"
            durationMs={lesson.durationMs}
            clipStartMs={lesson.clipStartMs ?? 0}
            clipEndMs={lesson.clipEndMs ?? (lesson.clipStartMs ?? 0) + lesson.durationMs}
            segments={lesson.segments}
            knowledgePoints={lesson.knowledgePoints}
            showRomaji={showRomaji}
            onStateChange={setState}
            onFinish={() => undefined}
            onError={() => undefined}
          />

          {currentSegment ? (
            <div className={styles.previewTranscript}>
              <strong>{currentSegment.ja}</strong>
              <span>
                {showRomaji
                  ? `${currentSegment.kana} / ${currentSegment.romaji}`
                  : currentSegment.kana}
              </span>
              <p>{currentSegment.zh}</p>
            </div>
          ) : null}

          {activePoints.length > 0 ? (
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
  const [slicePreview, setSlicePreview] = useState<SlicePreviewState | null>(null)
  const [selectedSliceIds, setSelectedSliceIds] = useState<string[]>([])
  const [previewLessonId, setPreviewLessonId] = useState<string | null>(null)
  const [buildingPreview, setBuildingPreview] = useState(false)
  const [importingSlices, setImportingSlices] = useState(false)
  const [busyClipId, setBusyClipId] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('')
  const [taskProgress, setTaskProgress] = useState<TaskProgressState | null>(null)
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
    const selectedIdSet = new Set(selectedSliceIds)
    return slicePreview.lessons.filter((lesson) => selectedIdSet.has(lesson.id))
  }, [selectedSliceIds, slicePreview])
  const previewLesson =
    slicePreview?.lessons.find((lesson) => lesson.id === previewLessonId) ?? null

  const updateTaskStatus = (message: string) => {
    setStatusText(message)
    setTaskProgress((state) => deriveTaskProgress(message, state?.percent ?? 0))
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
    updateTaskStatus('准备自动字幕中…')
    try {
      await generateAutoSubtitles(clipId, (message) => updateTaskStatus(message))
    } finally {
      setBusyClipId(null)
    }
  }

  const handleBuildSlicePreview = async () => {
    if (!clipFile) {
      return
    }

    setBuildingPreview(true)
    setTaskProgress({ percent: 4, detail: '正在准备切片任务…' })
    updateTaskStatus('正在读取视频信息…')

    try {
      const normalizedTitle = clipTitle.trim() || clipFile.name.replace(/\.[^.]+$/, '')
      const normalizedTheme = clipTheme.trim() || '日语原片'
      const { durationMs, cover } = await readVideoMeta(clipFile, normalizedTitle, normalizedTheme)

      let subtitleSource: ImportedClip['subtitleSource']
      let subtitleFileName: string | undefined
      let sourceProvider = '页面自动切片预览'
      let segments: ImportedClip['segments'] = []
      let knowledgePoints: ImportedClip['knowledgePoints'] = []

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
        const studyData = await generateStudyDataFromVideo(clipFile, durationMs, (message) =>
          updateTaskStatus(message),
        )
        segments = studyData.segments
        knowledgePoints = studyData.knowledgePoints
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
        blob: clipFile,
        createdAt: new Date().toISOString(),
        segments,
        knowledgePoints,
        tags: ['页面切片预览', normalizedTheme, subtitleSource === 'manual' ? '外部字幕' : '自动字幕'],
        description: '这是页面里生成的临时切片预览，确认后才会正式导入首页短视频流。',
        creditLine: '预览结果仅保留在当前页面中，点击导入后才会持久化到本地学习库。',
      }

      const previewLessons = buildLessonsFromImportedClip(previewClip)
      setSlicePreview({
        file: clipFile,
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
      })
      setSelectedSliceIds(previewLessons.map((lesson) => lesson.id))
      setPreviewLessonId(null)
      updateTaskStatus(`已生成 ${previewLessons.length} 条候选切片，可以先预览再决定是否导入。`)
    } catch (error) {
      setSlicePreview(null)
      setSelectedSliceIds([])
      setPreviewLessonId(null)
      setTaskProgress(null)
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
    setTaskProgress({ percent: 94, detail: '正在导入勾选的切片到首页短视频流…' })
    setStatusText('正在导入勾选的切片到首页短视频流…')

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
      })

      setTaskProgress({ percent: 100, detail: `已导入 ${imported.length} 条切片。现在回首页就能直接刷到这些短视频。` })
      setStatusText(`已导入 ${imported.length} 条切片。现在回首页就能直接刷到这些短视频。`)
      setSlicePreview(null)
      setSelectedSliceIds([])
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
    setSlicerStatusText('正在读取切片 manifest 并匹配视频文件…')
    try {
      const imported = await importSlicerManifest({
        manifestFile: slicerManifestFile,
        clipFiles: slicerClipFiles,
      })
      setSlicerStatusText(`已导入 ${imported.length} 条切片，首页短视频流已同步更新。`)
      setSlicerManifestFile(null)
      setSlicerClipFiles([])
    } catch (error) {
      setSlicerStatusText(error instanceof Error ? error.message : '切片导入失败。')
    } finally {
      setImportingSlicer(false)
    }
  }

  const handleToggleReminder = async () => {
    if (!settings.remindersEnabled && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => undefined)
    }
    await updateSettings({ remindersEnabled: !settings.remindersEnabled })
  }

  const togglePreviewSelection = (lessonId: string) => {
    setSelectedSliceIds((state) =>
      state.includes(lessonId) ? state.filter((id) => id !== lessonId) : [...state, lessonId],
    )
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
            </div>

            <p className={styles.helperNote}>
              你只管选本地视频。系统会优先使用你提供的字幕；如果没有字幕，就自动抽取音频并生成时间轴字幕，然后挑出更适合学语法和单词的候选切片给你预览。
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
                    onClick={() => setSelectedSliceIds(slicePreview.lessons.map((lesson) => lesson.id))}
                  >
                    <CheckCircle2 size={18} />
                    全选
                  </button>
                  <button className="softButton" onClick={() => setSelectedSliceIds([])}>
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
                如果你已经用独立切片工具生成了 `manifest.json + clips`，也可以在这里直接一次性导入首页短视频流。
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
                  </div>
                </article>
              )
            })}
            {visibleImportedClips.length === 0 ? (
              <p className={styles.placeholder}>导入的视频只保存在当前设备，不会上传。</p>
            ) : null}
          </div>
        </div>
        <div className={`${styles.card} glassCard`}>
          <header className={styles.cardHeader}>
            <div>
              <span className="chip badgeMint">收藏回看</span>
              <h2>喜欢的片段放这里</h2>
            </div>
          </header>

          <div className={styles.favoriteList}>
            {favoriteLessons.map((lesson) => (
              <article key={lesson.id}>
                <Heart size={16} />
                <div>
                  <strong>{lesson.title}</strong>
                  <span>{lesson.theme}</span>
                </div>
              </article>
            ))}
            {favoriteLessons.length === 0 ? (
              <p className={styles.placeholder}>还没有收藏的短视频。</p>
            ) : null}
          </div>
        </div>

        <div className={`${styles.card} glassCard`}>
          <header className={styles.cardHeader}>
            <div>
              <span className="chip badgePink">站内设置</span>
              <h2>把体验调成更顺手</h2>
            </div>
          </header>

          <div className={styles.settingList}>
            <button className={styles.settingItem} onClick={() => void handleToggleReminder()}>
              <div>
                <strong>学习提醒</strong>
                <span>当前：{settings.remindersEnabled ? '已开启' : '未开启'}</span>
              </div>
              <BellRing size={18} />
            </button>

            <button
              className={styles.settingItem}
              onClick={() => void updateSettings({ showRomaji: !settings.showRomaji })}
            >
              <div>
                <strong>显示罗马音</strong>
                <span>当前：{settings.showRomaji ? '显示' : '隐藏'}</span>
              </div>
              <Settings2 size={18} />
            </button>
          </div>
        </div>

        <div className={`${styles.card} glassCard`}>
          <header className={styles.cardHeader}>
            <div>
              <span className="chip badgeMint">来源与致谢</span>
              <h2>公开学习素材都记在这里</h2>
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
          onClose={() => setPreviewLessonId(null)}
        />
      ) : null}
    </div>
  )
}
