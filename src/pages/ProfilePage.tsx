import {
  BellRing,
  BookOpen,
  CheckCircle2,
  Flame,
  HardDrive,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { type CSSProperties, type ReactNode, type UIEvent, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { countStreak, getMonthCalendar, groupProgressByDate } from '../lib/date'
import { getCompletedDateSet, getGoalCompletionRatio, getTodayProgress } from '../lib/selectors'
import {
  deleteSiteVideos,
  listSiteVideoObjects,
  type SiteVideoStorageSummary,
} from '../lib/siteVideoStorage'
import { ensureBrowserPlayableVideo } from '../lib/videoPlayback'
import { useAppStore } from '../store/useAppStore'
import type { ImportedClip, TranscriptSegment } from '../types'
import styles from './ProfilePage.module.css'

interface SubtitleReviewOverlayProps {
  clip: ImportedClip
  segments: TranscriptSegment[]
  saving: boolean
  onChange: (index: number, updates: Partial<TranscriptSegment>) => void
  onSaveTrusted: () => void
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

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function cloneSegments(segments: TranscriptSegment[]) {
  return segments.map((segment) => ({
    ...segment,
    focusTermIds: [...(segment.focusTermIds ?? [])],
  }))
}

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`
}

function fileStem(file: File) {
  return file.name.replace(/\.[^.]+$/, '').trim().toLowerCase()
}

function findSubtitleForVideo(videoFile: File, subtitleFiles: File[], videoCount: number) {
  if (subtitleFiles.length === 0) {
    return null
  }

  if (videoCount === 1 && subtitleFiles.length === 1) {
    return subtitleFiles[0]
  }

  const videoStem = fileStem(videoFile)
  return subtitleFiles.find((subtitleFile) => fileStem(subtitleFile) === videoStem) ?? null
}

function uniqueFiles(files: File[]) {
  const seen = new Set<string>()
  return files.filter((file) => {
    const key = fileKey(file)
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function isUploadedToSite(clip: ImportedClip) {
  return Boolean(clip.sourceUrl)
}

function canUploadRawClipToSite(clip: ImportedClip) {
  return clip.importMode === 'raw' && clip.studyIndex?.quality === 'trusted'
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function getReviewRowHeight() {
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 980px)').matches) {
    return 320
  }

  return 178
}

const REVIEW_LIST_OVERSCAN = 6

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
  } else if (message.includes('尝试读取视频自带字幕轨')) {
    percent = 26
  } else if (message.includes('已读取视频自带字幕轨')) {
    percent = 36
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
  } else if (message.includes('正在加载硬字幕 OCR 模型')) {
    percent = 76
  } else if (message.includes('尝试识别画面底部中文字幕')) {
    percent = 80
  } else if (message.includes('已从画面底部识别出')) {
    percent = 82
  } else if (
    message.includes('生成中文字幕与知识点中') ||
    message.includes('生成中文字幕与索引中') ||
    message.includes('生成中文字幕与字幕时间轴中')
  ) {
    percent = 84
  } else if (message.includes('正在生成字幕草稿')) {
    percent = 86
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

function SubtitleReviewOverlay({
  clip,
  segments,
  saving,
  onChange,
  onSaveTrusted,
  onClose,
}: SubtitleReviewOverlayProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [virtualMetrics, setVirtualMetrics] = useState({
    scrollTop: 0,
    viewportHeight: 560,
    rowHeight: getReviewRowHeight(),
  })

  useEffect(() => {
    const listElement = listRef.current
    if (!listElement) {
      return
    }

    const updateMetrics = () => {
      setVirtualMetrics((metrics) => ({
        ...metrics,
        viewportHeight: listElement.clientHeight || metrics.viewportHeight,
        rowHeight: getReviewRowHeight(),
      }))
    }

    updateMetrics()
    const resizeObserver = new ResizeObserver(updateMetrics)
    resizeObserver.observe(listElement)
    window.addEventListener('resize', updateMetrics)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateMetrics)
    }
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 })
    setVirtualMetrics((metrics) => ({ ...metrics, scrollTop: 0 }))
  }, [clip.id, segments.length])

  const handleReviewScroll = (event: UIEvent<HTMLDivElement>) => {
    const nextScrollTop = event.currentTarget.scrollTop
    setVirtualMetrics((metrics) =>
      Math.abs(metrics.scrollTop - nextScrollTop) < 4
        ? metrics
        : { ...metrics, scrollTop: nextScrollTop },
    )
  }

  const totalRows = segments.length
  const startIndex = Math.max(
    0,
    Math.floor(virtualMetrics.scrollTop / virtualMetrics.rowHeight) - REVIEW_LIST_OVERSCAN,
  )
  const visibleCount =
    Math.ceil(virtualMetrics.viewportHeight / virtualMetrics.rowHeight) +
    REVIEW_LIST_OVERSCAN * 2
  const endIndex = Math.min(totalRows, startIndex + visibleCount)
  const visibleSegments = segments.slice(startIndex, endIndex)
  const canvasHeight = totalRows * virtualMetrics.rowHeight

  return (
    <OverlayPortal>
      <div className={styles.previewBackdrop} role="dialog" aria-modal="true">
        <section className={styles.reviewPanel}>
          <header className={styles.previewPanelHeader}>
            <div>
              <span className="chip badgeMint">字幕预览 / 编辑</span>
              <h2>{clip.title}</h2>
              <p>
                共 {segments.length} 条字幕，正在显示 {totalRows === 0 ? 0 : startIndex + 1}-
                {endIndex} 条。保存后会更新字幕时间轴，并清理旧的按需生成切片。
              </p>
            </div>
            <button className="softButton" onClick={onClose} aria-label="关闭字幕预览编辑">
              <X size={18} />
              关闭
            </button>
          </header>

          <div className={styles.reviewToolbar}>
            <span>
              当前状态：
              {clip.studyIndex?.quality === 'trusted' ? '可信字幕' : '字幕草稿'}
            </span>
            <button
              className="softButton primaryButton"
              onClick={onSaveTrusted}
              disabled={saving}
            >
              <CheckCircle2 size={18} />
              {saving ? '正在保存…' : '保存并标记可信'}
            </button>
          </div>

          <div
            ref={listRef}
            className={styles.reviewListViewport}
            data-testid="subtitle-review-window"
            onScroll={handleReviewScroll}
            aria-label="字幕预览编辑列表"
          >
            <div className={styles.reviewListCanvas} style={{ height: `${canvasHeight}px` }}>
              {visibleSegments.map((segment, offset) => {
                const index = startIndex + offset
                return (
                  <article
                    key={`${segment.startMs}-${segment.endMs}-${index}`}
                    className={`${styles.reviewRow} ${styles.reviewVirtualRow}`}
                    data-testid="subtitle-review-row"
                    style={
                      {
                        height: `${Math.max(120, virtualMetrics.rowHeight - 12)}px`,
                        transform: `translateY(${index * virtualMetrics.rowHeight}px)`,
                      } as CSSProperties
                    }
                  >
                    <div className={styles.reviewTime}>
                      <strong>{index + 1}</strong>
                      <span>{formatRange(segment.startMs, segment.endMs)}</span>
                    </div>
                    <label>
                      <span>日文</span>
                      <textarea
                        value={segment.ja}
                        onChange={(event) => onChange(index, { ja: event.target.value })}
                        rows={2}
                      />
                    </label>
                    <label>
                      <span>中文</span>
                      <textarea
                        value={segment.zh}
                        onChange={(event) => onChange(index, { zh: event.target.value })}
                        rows={2}
                      />
                    </label>
                  </article>
                )
              })}
            </div>
          </div>
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
  const importClip = useAppStore((state) => state.importClip)
  const uploadClipToSite = useAppStore((state) => state.uploadClipToSite)
  const generateAutoSubtitles = useAppStore((state) => state.generateAutoSubtitles)
  const generateGrammarStudyBatch = useAppStore((state) => state.generateGrammarStudyBatch)
  const generateTermStudyBatch = useAppStore((state) => state.generateTermStudyBatch)
  const markClipStudyIndexTrusted = useAppStore((state) => state.markClipStudyIndexTrusted)
  const replaceClipSubtitle = useAppStore((state) => state.replaceClipSubtitle)
  const updateClipTranscript = useAppStore((state) => state.updateClipTranscript)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const deleteLocalLesson = useAppStore((state) => state.deleteLocalLesson)
  const persistedSliceTask = useAppStore((state) => state.sliceTask)
  const setSliceTask = useAppStore((state) => state.setSliceTask)

  const [goalForm, setGoalForm] = useState({
    videosTarget: String(goal.videosTarget),
    wordsTarget: String(goal.wordsTarget),
    grammarTarget: String(goal.grammarTarget),
    reviewTarget: String(goal.reviewTarget),
  })
  const [clipFiles, setClipFiles] = useState<File[]>([])
  const [subtitleFiles, setSubtitleFiles] = useState<File[]>([])
  const [siteUploadPassword, setSiteUploadPassword] = useState('')
  const [storageSummary, setStorageSummary] = useState<SiteVideoStorageSummary | null>(null)
  const [storageLoading, setStorageLoading] = useState(false)
  const [importingSources, setImportingSources] = useState(false)
  const [busyClipId, setBusyClipId] = useState<string | null>(null)
  const [uploadingClipId, setUploadingClipId] = useState<string | null>(null)
  const [termQuery, setTermQuery] = useState('')
  const [grammarQuery, setGrammarQuery] = useState('')
  const [generatingTerm, setGeneratingTerm] = useState(false)
  const [generatingGrammar, setGeneratingGrammar] = useState(false)
  const [replacingSubtitleClipId, setReplacingSubtitleClipId] = useState<string | null>(null)
  const [reviewingClipId, setReviewingClipId] = useState<string | null>(null)
  const [reviewSegments, setReviewSegments] = useState<TranscriptSegment[]>([])
  const [savingTranscript, setSavingTranscript] = useState(false)
  const [statusText, setStatusText] = useState(persistedSliceTask.detail)
  const [taskProgress, setTaskProgress] = useState<{
    percent: number
    detail: string
  } | null>(
    persistedSliceTask.status === 'idle'
      ? null
      : { percent: persistedSliceTask.percent, detail: persistedSliceTask.detail },
  )
  const taskProgressRef = useRef(taskProgress)
  const taskStartedAtRef = useRef(persistedSliceTask.startedAt)
  const lastTaskStatusAtRef = useRef(0)
  const subtitleModelPreloadStartedRef = useRef(false)
  const clipFileInputRef = useRef<HTMLInputElement | null>(null)
  const subtitleFileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setGoalForm({
      videosTarget: String(goal.videosTarget),
      wordsTarget: String(goal.wordsTarget),
      grammarTarget: String(goal.grammarTarget),
      reviewTarget: String(goal.reviewTarget),
    })
  }, [goal])

  useEffect(() => {
    taskStartedAtRef.current = persistedSliceTask.startedAt
    setStatusText(persistedSliceTask.detail)
    const nextTaskProgress =
      persistedSliceTask.status === 'idle'
        ? null
        : {
            percent: persistedSliceTask.percent,
            detail: persistedSliceTask.detail,
          }
    taskProgressRef.current = nextTaskProgress
    setTaskProgress(nextTaskProgress)
  }, [persistedSliceTask])

  useEffect(() => {
    if (subtitleModelPreloadStartedRef.current || clipFiles.length === 0) {
      return
    }

    const hasVideoWithoutSubtitle = clipFiles.some(
      (file) => !findSubtitleForVideo(file, subtitleFiles, clipFiles.length),
    )
    if (!hasVideoWithoutSubtitle) {
      return
    }

    subtitleModelPreloadStartedRef.current = true
    void import('../lib/autoSubtitlesChunked')
      .then(({ preloadSubtitleModel }) =>
        preloadSubtitleModel((message) => {
          if (message.includes('下载字幕模型中') || message.includes('已就绪')) {
            setStatusText(message)
          }
        }),
      )
      .catch(() => {
        subtitleModelPreloadStartedRef.current = false
      })
  }, [clipFiles, subtitleFiles])

  const todayProgress = getTodayProgress(studyEvents)
  const completionRatio = getGoalCompletionRatio(todayProgress, goal)
  const completedDates = getCompletedDateSet(studyEvents, goal)
  const streak = countStreak(completedDates)
  const scoreMap = groupProgressByDate(studyEvents, goal)
  const calendar = getMonthCalendar(scoreMap, goal)
  const favoriteLessons = lessons.filter((lesson) => favorites.includes(lesson.id))
  const sourceImportedClips = useMemo(
    () =>
      importedClips.filter(
        (clip) => clip.importMode !== 'source' && clip.importMode !== 'sliced',
      ),
    [importedClips],
  )
  const sliceImportedClips = useMemo(
    () => importedClips.filter((clip) => clip.importMode === 'sliced'),
    [importedClips],
  )
  const selectedImportRows = useMemo(
    () =>
      clipFiles.map((file) => ({
        file,
        subtitleFile: findSubtitleForVideo(file, subtitleFiles, clipFiles.length),
      })),
    [clipFiles, subtitleFiles],
  )
  const referencedSiteVideoUrls = useMemo(
    () =>
      new Set(
        importedClips
          .map((clip) => clip.sourceUrl)
          .filter((url): url is string => Boolean(url)),
      ),
    [importedClips],
  )
  const unreferencedSiteVideos = useMemo(() => {
    return storageSummary?.blobs.filter((blob) => !referencedSiteVideoUrls.has(blob.url)) ?? []
  }, [referencedSiteVideoUrls, storageSummary])
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
  const reviewingClip = reviewingClipId
    ? importedClips.find((clip) => clip.id === reviewingClipId) ?? null
    : null

  const resetSelectedImportFiles = () => {
    setClipFiles([])
    setSubtitleFiles([])
    if (clipFileInputRef.current) {
      clipFileInputRef.current.value = ''
    }
    if (subtitleFileInputRef.current) {
      subtitleFileInputRef.current.value = ''
    }
  }

  const updateTaskStatus = (message: string) => {
    const now = Date.now()
    const previousPercent = taskProgressRef.current?.percent ?? persistedSliceTask.percent
    const nextProgress = deriveTaskProgress(message, previousPercent)
    const startedAt =
      taskStartedAtRef.current ?? persistedSliceTask.startedAt ?? new Date().toISOString()
    const isTerminalProgress = nextProgress.percent >= 100 || nextProgress.detail.includes('失败')
    const isMeaningfulPercentChange =
      Math.abs(nextProgress.percent - (taskProgressRef.current?.percent ?? 0)) >= 2

    if (
      !isTerminalProgress &&
      !isMeaningfulPercentChange &&
      now - lastTaskStatusAtRef.current < 350
    ) {
      return
    }

    taskProgressRef.current = nextProgress
    taskStartedAtRef.current = startedAt
    lastTaskStatusAtRef.current = now
    setStatusText(message)
    setTaskProgress(nextProgress)
    setSliceTask({
      status: nextProgress.percent >= 100 ? 'completed' : 'running',
      percent: nextProgress.percent,
      detail: nextProgress.detail,
      startedAt,
      updatedAt: new Date().toISOString(),
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

  const handleRefreshSiteStorage = async () => {
    setStorageLoading(true)
    try {
      const summary = await listSiteVideoObjects(siteUploadPassword.trim() || undefined)
      setStorageSummary(summary)
      setStatusText(
        `站点视频存储：${summary.count} 个文件，占用 ${formatFileSize(summary.totalSize)}。其中 ${summary.blobs.filter((blob) => !referencedSiteVideoUrls.has(blob.url)).length} 个当前学习资料未引用。`,
      )
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : '站点视频存储查询失败。')
    } finally {
      setStorageLoading(false)
    }
  }

  const handleDeleteUnreferencedSiteVideos = async () => {
    if (unreferencedSiteVideos.length === 0) {
      setStatusText('没有发现当前学习资料未引用的站点视频。')
      return
    }

    const totalSize = unreferencedSiteVideos.reduce((sum, blob) => sum + blob.size, 0)
    const confirmed = window.confirm(
      `确认删除 ${unreferencedSiteVideos.length} 个未关联站点视频，释放约 ${formatFileSize(totalSize)}？`,
    )
    if (!confirmed) {
      return
    }

    setStorageLoading(true)
    try {
      await deleteSiteVideos(
        unreferencedSiteVideos.map((blob) => blob.url),
        siteUploadPassword.trim() || undefined,
      )
      const summary = await listSiteVideoObjects(siteUploadPassword.trim() || undefined)
      setStorageSummary(summary)
      setStatusText(
        `已清理 ${unreferencedSiteVideos.length} 个未关联站点视频，当前占用 ${formatFileSize(summary.totalSize)}。`,
      )
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : '未关联站点视频清理失败。')
    } finally {
      setStorageLoading(false)
    }
  }

  const handleImportSourceVideos = async () => {
    if (clipFiles.length === 0) {
      return
    }

    const startedAt = new Date().toISOString()
    const failedFiles: string[] = []
    let importedCount = 0

    setImportingSources(true)
    setSliceTask({
      status: 'running',
      percent: 4,
      detail: `正在准备 ${clipFiles.length} 个整片本地处理任务…`,
      startedAt,
      updatedAt: startedAt,
    })
    const initialProgress = {
      percent: 4,
      detail: `正在准备 ${clipFiles.length} 个整片本地处理任务…`,
    }
    taskProgressRef.current = initialProgress
    setTaskProgress(initialProgress)

    try {
      for (const [fileIndex, sourceFile] of clipFiles.entries()) {
        const statusPrefix = clipFiles.length > 1 ? `第 ${fileIndex + 1}/${clipFiles.length} 个视频：` : ''
        const queueStartPercent = 4
        const queueEndPercent = 96
        const fileSharePercent = (queueEndPercent - queueStartPercent) / clipFiles.length
        const setFileProgress = (message: string, percent = 0) => {
          const mappedPercent = Math.round(
            queueStartPercent + fileSharePercent * fileIndex + (percent / 100) * fileSharePercent,
          )
          const detail = `${statusPrefix}${message}`
          const nextPercent = clampProgress(
            Math.max(taskProgressRef.current?.percent ?? queueStartPercent, mappedPercent),
          )
          const nextProgress = { percent: nextPercent, detail }
          taskProgressRef.current = nextProgress
          setTaskProgress(nextProgress)
          setStatusText(detail)
          setSliceTask({
            status: 'running',
            percent: nextPercent,
            detail,
            startedAt,
            updatedAt: new Date().toISOString(),
          })
        }

        try {
          setFileProgress('正在检查视频播放兼容性…', 6)
          const { file: playbackFile } = await ensureBrowserPlayableVideo(sourceFile, (message) =>
            setFileProgress(message, deriveTaskProgress(message, 0).percent),
          )
          const subtitleFile = findSubtitleForVideo(sourceFile, subtitleFiles, clipFiles.length)
          setFileProgress(
            subtitleFile ? `正在解析外部字幕 ${subtitleFile.name}…` : '没有匹配到字幕，暂存后会自动生成字幕草稿…',
            subtitleFile ? 38 : 28,
          )

          const importedClip = await importClip({
            file: playbackFile,
            subtitleFile,
            title: sourceFile.name.replace(/\.[^.]+$/, ''),
            theme: '日语原片',
            onUploadProgress: (message, percent = 0) => {
              setFileProgress(message, subtitleFile ? 46 + percent * 0.48 : 32 + percent * 0.18)
            },
          })
          importedCount += 1

          if (!subtitleFile) {
            setFileProgress('视频已暂存，正在生成字幕草稿…', 52)
            const updatedClip = await generateAutoSubtitles(importedClip.id, (message) => {
              const subtitleProgress = deriveTaskProgress(message, 52).percent
              setFileProgress(message, Math.max(52, Math.min(96, subtitleProgress)))
            })

            if (!updatedClip?.studyIndex) {
              throw new Error('视频已暂存，但字幕草稿没有生成成功。请稍后在视频卡片里重新生成字幕。')
            }
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : '整片处理或字幕草稿生成失败'
          failedFiles.push(`${sourceFile.name}: ${detail}`)
        }
      }

      const detail =
        failedFiles.length > 0
          ? `已入库 ${importedCount} 个视频，${failedFiles.length} 个处理失败：${failedFiles.join('；')}`
          : `已本地入库 ${importedCount} 个视频，并完成字幕草稿/索引。可以先预览编辑字幕，确认后再上传整片。`

      const finalProgress = { percent: failedFiles.length > 0 ? 99 : 100, detail }
      taskProgressRef.current = finalProgress
      setTaskProgress(finalProgress)
      setStatusText(detail)
      setSliceTask({
        status: failedFiles.length > 0 ? 'error' : 'completed',
        percent: failedFiles.length > 0 ? 99 : 100,
        detail,
        startedAt,
        updatedAt: new Date().toISOString(),
      })
      if (importedCount > 0) {
        resetSelectedImportFiles()
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : '整片处理或字幕草稿生成失败，请换一组文件重试。'
      const nextProgress = { percent: taskProgressRef.current?.percent ?? 0, detail }
      taskProgressRef.current = nextProgress
      setTaskProgress(nextProgress)
      setStatusText(detail)
      setSliceTask({
        status: 'error',
        percent: nextProgress.percent,
        detail,
        startedAt,
        updatedAt: new Date().toISOString(),
      })
    } finally {
      setImportingSources(false)
    }
  }

  const handleGenerateGrammarBatch = async (mode: 'beginner' | 'specific') => {
    if (mode === 'specific' && !grammarQuery.trim()) {
      setStatusText('请输入想检索的语法，例如 たい、たことがある、なければならない。')
      return
    }

    setGeneratingGrammar(true)
    const startedAt = new Date().toISOString()
    const detail =
      mode === 'beginner'
        ? '正在根据整片字幕动态匹配初级语法切片…'
        : `正在根据整片字幕检索语法「${grammarQuery.trim()}」…`
    setSliceTask({
      status: 'running',
      percent: 72,
      detail,
      startedAt,
      updatedAt: startedAt,
    })
    taskProgressRef.current = { percent: 72, detail }
    setTaskProgress({ percent: 72, detail })
    setStatusText(detail)

    try {
      const generated = await generateGrammarStudyBatch({
        mode,
        query: mode === 'specific' ? grammarQuery.trim() : undefined,
        maxLessons: 8,
      })
      const nextDetail =
        generated.length > 0
          ? `已生成 ${generated.length} 条语法切片，首页学习流会直接播放整片中的对应区间。`
          : mode === 'beginner'
            ? '还没有可用的初级语法命中。请先上传日文字幕，或给已有视频生成/校对字幕。'
            : `没有找到「${grammarQuery.trim()}」的原句。可以换一个写法，或先上传更完整的日文字幕。`

      const nextProgress = { percent: generated.length > 0 ? 100 : 0, detail: nextDetail }
      taskProgressRef.current = nextProgress
      setTaskProgress(nextProgress)
      setStatusText(nextDetail)
      setSliceTask({
        status: generated.length > 0 ? 'completed' : 'error',
        percent: generated.length > 0 ? 100 : 0,
        detail: nextDetail,
        startedAt,
        updatedAt: new Date().toISOString(),
      })
    } catch (error) {
      const nextDetail = error instanceof Error ? error.message : '语法切片生成失败，请稍后重试。'
      const nextProgress = { percent: taskProgressRef.current?.percent ?? 0, detail: nextDetail }
      taskProgressRef.current = nextProgress
      setTaskProgress(nextProgress)
      setStatusText(nextDetail)
      setSliceTask({
        status: 'error',
        percent: nextProgress.percent,
        detail: nextDetail,
        startedAt,
        updatedAt: new Date().toISOString(),
      })
    } finally {
      setGeneratingGrammar(false)
    }
  }

  const handleGenerateTermBatch = async (mode: 'beginner' | 'specific') => {
    if (mode === 'specific' && !termQuery.trim()) {
      setStatusText('请输入想检索的单词，例如 食べる、学校、ありがとう。')
      return
    }

    setGeneratingTerm(true)
    const startedAt = new Date().toISOString()
    const detail =
      mode === 'beginner'
        ? '正在根据整片字幕动态匹配初级单词切片…'
        : `正在根据整片字幕检索单词「${termQuery.trim()}」…`
    setSliceTask({
      status: 'running',
      percent: 72,
      detail,
      startedAt,
      updatedAt: startedAt,
    })
    taskProgressRef.current = { percent: 72, detail }
    setTaskProgress({ percent: 72, detail })
    setStatusText(detail)

    try {
      const generated = await generateTermStudyBatch({
        mode,
        query: mode === 'specific' ? termQuery.trim() : undefined,
        maxLessons: 8,
      })
      const nextDetail =
        generated.length > 0
          ? `已生成 ${generated.length} 条单词切片，首页学习流会直接播放整片中的对应区间。`
          : mode === 'beginner'
            ? '还没有可用的初级单词命中。请先上传日文字幕，或给已有视频生成/校对字幕。'
            : `没有找到「${termQuery.trim()}」的原句。可以换一个写法，或先上传更完整的日文字幕。`

      const nextProgress = { percent: generated.length > 0 ? 100 : 0, detail: nextDetail }
      taskProgressRef.current = nextProgress
      setTaskProgress(nextProgress)
      setStatusText(nextDetail)
      setSliceTask({
        status: generated.length > 0 ? 'completed' : 'error',
        percent: generated.length > 0 ? 100 : 0,
        detail: nextDetail,
        startedAt,
        updatedAt: new Date().toISOString(),
      })
    } catch (error) {
      const nextDetail = error instanceof Error ? error.message : '单词切片生成失败，请稍后重试。'
      const nextProgress = { percent: taskProgressRef.current?.percent ?? 0, detail: nextDetail }
      taskProgressRef.current = nextProgress
      setTaskProgress(nextProgress)
      setStatusText(nextDetail)
      setSliceTask({
        status: 'error',
        percent: nextProgress.percent,
        detail: nextDetail,
        startedAt,
        updatedAt: new Date().toISOString(),
      })
    } finally {
      setGeneratingTerm(false)
    }
  }

  const handleTrustStudyIndex = async (clipId: string, clipTitle: string) => {
    const confirmed = window.confirm(
      `确认「${clipTitle}」的日文字幕已经校对过，可以作为可信学习材料吗？`,
    )
    if (!confirmed) {
      return
    }

    const ok = await markClipStudyIndexTrusted(clipId)
    setStatusText(ok ? `「${clipTitle}」已标记为可信字幕时间轴。` : '没有找到可确认的字幕时间轴。')
  }

  const handleReplaceClipSubtitle = async (clip: ImportedClip, fileList: FileList | null) => {
    const subtitleFile = fileList?.[0]
    if (!subtitleFile) {
      return
    }

    setReplacingSubtitleClipId(clip.id)
    setStatusText(`正在为「${clip.title}」解析字幕 ${subtitleFile.name}…`)
    try {
      const updated = await replaceClipSubtitle(clip.id, subtitleFile)
      if (!updated) {
        setStatusText('没有找到可替换字幕的整片视频。')
        return
      }

      setStatusText(
        `「${updated.title}」已绑定字幕并更新可信字幕时间轴：${updated.studyIndex?.summary.cueCount ?? 0} 条字幕。`,
      )
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : '字幕导入失败，请检查字幕格式。')
    } finally {
      setReplacingSubtitleClipId(null)
    }
  }

  const handleOpenTranscriptReview = (clip: ImportedClip) => {
    if (clip.segments.length === 0) {
      setStatusText('这个视频还没有可预览编辑的字幕，请先上传字幕或生成自动字幕。')
      return
    }

    setReviewingClipId(clip.id)
    setReviewSegments(cloneSegments(clip.segments))
  }

  const handleChangeReviewSegment = (index: number, updates: Partial<TranscriptSegment>) => {
    setReviewSegments((segments) =>
      segments.map((segment, segmentIndex) =>
        segmentIndex === index ? { ...segment, ...updates } : segment,
      ),
    )
  }

  const handleSaveTranscriptReview = async () => {
    if (!reviewingClip) {
      return
    }

    setSavingTranscript(true)
    try {
      const updated = await updateClipTranscript(reviewingClip.id, reviewSegments, true)
      if (!updated) {
        setStatusText('没有可保存的字幕内容，请至少保留一条有效日文字幕。')
        return
      }

      setStatusText(
        `「${updated.title}」字幕已保存并更新字幕时间轴：${updated.studyIndex?.summary.cueCount ?? 0} 条字幕。`,
      )
      setReviewingClipId(null)
      setReviewSegments([])
    } finally {
      setSavingTranscript(false)
    }
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
    taskProgressRef.current = { percent: 6, detail: '正在准备自动字幕…' }
    updateTaskStatus('准备自动字幕中…')
    try {
      await generateAutoSubtitles(clipId, (message) => updateTaskStatus(message))
      const detail = '自动字幕已生成完成，可以先预览编辑字幕，再按学习目标生成切片。'
      const nextProgress = { percent: 100, detail }
      taskProgressRef.current = nextProgress
      setTaskProgress(nextProgress)
      setStatusText(detail)
      setSliceTask({
        status: 'completed',
        percent: 100,
        detail,
        startedAt,
        updatedAt: new Date().toISOString(),
      })
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : '自动字幕生成失败。请稍后重试，或上传字幕文件。'
      const nextProgress = { percent: taskProgressRef.current?.percent ?? 0, detail }
      taskProgressRef.current = nextProgress
      setTaskProgress(nextProgress)
      setSliceTask({
        status: 'error',
        percent: nextProgress.percent,
        detail,
        startedAt,
        updatedAt: new Date().toISOString(),
      })
      setStatusText(detail)
    } finally {
      setBusyClipId(null)
    }
  }

  const handleUploadClipToSite = async (clip: ImportedClip) => {
    setUploadingClipId(clip.id)
    const startedAt = new Date().toISOString()
    const initialDetail = `正在为「${clip.title}」申请站点上传地址…`
    const initialProgress = { percent: 4, detail: initialDetail }
    taskProgressRef.current = initialProgress
    setTaskProgress(initialProgress)
    setStatusText(initialDetail)
    setSliceTask({
      status: 'running',
      percent: initialProgress.percent,
      detail: initialProgress.detail,
      startedAt,
      updatedAt: startedAt,
    })
    try {
      const updated = await uploadClipToSite(
        clip.id,
        siteUploadPassword.trim() || undefined,
        (message, percent = 0) => {
          const nextPercent = clampProgress(
            Math.max(taskProgressRef.current?.percent ?? 4, Math.round(8 + percent * 0.88)),
          )
          const nextProgress = { percent: nextPercent, detail: message }
          taskProgressRef.current = nextProgress
          setStatusText(message)
          setTaskProgress(nextProgress)
          setSliceTask({
            status: nextPercent >= 100 ? 'completed' : 'running',
            percent: nextPercent,
            detail: message,
            startedAt,
            updatedAt: new Date().toISOString(),
          })
        },
      )
      const detail = updated
        ? `「${updated.title}」已上传到站点。字幕和索引仍可继续编辑。`
        : '没有找到要上传的视频。'
      const nextProgress = { percent: 100, detail }
      taskProgressRef.current = nextProgress
      setStatusText(detail)
      setTaskProgress(nextProgress)
      setSliceTask({
        status: 'completed',
        percent: 100,
        detail,
        startedAt,
        updatedAt: new Date().toISOString(),
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : '整片上传失败，请稍后重试。'
      const nextProgress = { percent: taskProgressRef.current?.percent ?? 0, detail }
      taskProgressRef.current = nextProgress
      setStatusText(detail)
      setTaskProgress(nextProgress)
      setSliceTask({
        status: 'error',
        percent: nextProgress.percent,
        detail,
        startedAt,
        updatedAt: new Date().toISOString(),
      })
    } finally {
      setUploadingClipId(null)
    }
  }

  const handleDeleteImportedClip = async (clipId: string, clipTitle: string) => {
    const confirmed = window.confirm(`要删除「${clipTitle}」以及相关的短视频吗？`)
    if (!confirmed) {
      return
    }

    await deleteLocalLesson(clipId, siteUploadPassword.trim() || undefined)
  }

  const handleToggleReminder = async () => {
    if (!settings.remindersEnabled && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission().catch(() => undefined)
    }
    await updateSettings({ remindersEnabled: !settings.remindersEnabled })
  }

  return (
    <div className={`${styles.page} fadeIn`}>
      <section className={styles.hero}>
        <div>
          <span className="chip badgeMint">我的学习空间</span>
          <h1 className="pageTitle">管理今天的学习节奏</h1>
          <p className="sectionIntro">
            导入和管理自己的日语素材；目标、打卡和播放偏好按需展开。
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
        <details className={`${styles.card} ${styles.detailsCard}`}>
          <summary className={styles.cardHeader}>
            <div>
              <h2>每日目标</h2>
              <small>设置今天想推进多少</small>
            </div>
          </summary>

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
        </details>

        <details className={`${styles.card} ${styles.detailsCard}`}>
          <summary className={styles.cardHeader}>
            <div>
              <h2>打卡日历</h2>
              <small>查看这个月的完成记录</small>
            </div>
          </summary>

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
        </details>

        <div className={`${styles.card} glassCard ${styles.importCard}`}>
          <header className={styles.cardHeader}>
            <div>
              <span className="chip badgePeach">主流程</span>
              <h2>导入整片，建立字幕时间轴</h2>
            </div>
          </header>

          <div className={styles.primaryImportPanel}>
            <div className={styles.importSteps} aria-label="整片处理流程">
              <div className={styles.stepItem}>
                <span>1</span>
                <strong>导入本地</strong>
                <small>先保存到当前浏览器</small>
              </div>
              <div className={styles.stepItem}>
                <span>2</span>
                <strong>确认字幕</strong>
                <small>预览、编辑并标记可信</small>
              </div>
              <div className={styles.stepItem}>
                <span>3</span>
                <strong>上传站点</strong>
                <small>完成后卡片会显示已上传</small>
              </div>
            </div>

            <label className={styles.singleUpload}>
              <span>选择原视频</span>
              <input
                ref={clipFileInputRef}
                className={styles.fileInput}
                type="file"
                accept="video/*,.mp4,.mkv,.mov,.webm,.avi"
                multiple
                onChange={(event) => setClipFiles(uniqueFiles(Array.from(event.target.files ?? [])))}
              />
            </label>

            <label className={styles.singleUpload}>
              <span>选择字幕文件（可选）</span>
              <input
                ref={subtitleFileInputRef}
                className={styles.fileInput}
                type="file"
                accept=".srt,.vtt,.ass,.ssa"
                multiple
                onChange={(event) => setSubtitleFiles(uniqueFiles(Array.from(event.target.files ?? [])))}
              />
            </label>

            {clipFiles.length > 0 ? (
              <div className={styles.selectedImportPlan}>
                <strong>本次导入队列</strong>
                {selectedImportRows.map(({ file, subtitleFile }, index) => (
                  <div key={`${fileKey(file)}-${index}`} className={styles.selectedImportRow}>
                    <Video size={16} />
                    <span>{file.name}</span>
                    <small>
                      {subtitleFile
                        ? `字幕：${subtitleFile.name}`
                        : '未匹配字幕，导入后自动生成草稿'}
                    </small>
                  </div>
                ))}
              </div>
            ) : null}

            {subtitleFiles.length > 0 ? (
              <div className={styles.selectedFileList}>
                <strong>已选择 {subtitleFiles.length} 个字幕文件</strong>
                <div>
                  {subtitleFiles.map((file, index) => (
                    <span key={`${fileKey(file)}-${index}`} className="chip badgeMint">
                      {file.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <details className={styles.uploadSettings}>
              <summary>最终上传提示需要密码时再填写</summary>
              <input
                className={styles.textInput}
                type="password"
                value={siteUploadPassword}
                onChange={(event) => setSiteUploadPassword(event.target.value)}
                placeholder="网站上传密码"
              />
              <div className={styles.storageTool}>
                <div className={styles.storageToolHeader}>
                  <HardDrive size={18} />
                  <div>
                    <strong>站点视频存储</strong>
                    <span>
                      {storageSummary
                        ? `${storageSummary.count} 个文件 / ${formatFileSize(storageSummary.totalSize)}`
                        : '查看 Cloudflare R2 里已有整片视频占用'}
                    </span>
                  </div>
                </div>
                {storageSummary ? (
                  <p>
                    当前学习资料未引用 {unreferencedSiteVideos.length} 个站点视频，可清理后再上传新整片。
                  </p>
                ) : null}
                <div className={styles.storageActions}>
                  <button
                    className="softButton"
                    onClick={() => void handleRefreshSiteStorage()}
                    disabled={storageLoading}
                  >
                    <RefreshCw size={16} />
                    {storageLoading ? '查询中…' : '检查占用'}
                  </button>
                  <button
                    className="softButton"
                    onClick={() => void handleDeleteUnreferencedSiteVideos()}
                    disabled={storageLoading || unreferencedSiteVideos.length === 0}
                  >
                    <Trash2 size={16} />
                    清理未关联视频
                  </button>
                </div>
              </div>
            </details>

            <p className={styles.helperNote}>
              推荐同时上传同名日文字幕，例如 video01.mp4 搭配 video01.srt。视频会先暂存在当前浏览器，没有字幕时会自动生成中日字幕草稿，完成后可以预览和编辑。
            </p>
            {statusText ? <p className={styles.statusNote}>{statusText}</p> : null}
            {taskProgress ? (
              <div className={styles.progressCard} aria-live="polite" role="status">
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
                  {uploadingClipId
                    ? '上传完成后，视频卡片会显示“站点已上传”，本地草稿会自动切换为站点视频。'
                    : '导入完成后会出现一张整片卡片；先确认字幕，再上传整片。学习切片会单独收纳，不会混在上传列表里。'}
                </small>
              </div>
            ) : null}

            <div className={styles.actionRow}>
              <button
                className="softButton primaryButton"
                onClick={() => void handleImportSourceVideos()}
                disabled={importingSources || clipFiles.length === 0}
              >
                <Upload size={18} />
                {importingSources
                  ? '正在导入并生成字幕…'
                  : clipFiles.length > 1
                    ? `导入 ${clipFiles.length} 个视频并生成字幕`
                    : '导入整片并生成字幕'}
              </button>
            </div>
          </div>

          {sourceImportedClips.length > 0 ? (
            <div className={styles.studyPlannerPanel}>
              <div>
                <span className="chip badgeMint">按需生成</span>
                <h3 className={styles.subTitle}>从整片字幕里动态找单词和语法原句</h3>
                <p className={styles.previewSummary}>
                  初级单词会在执行时匹配现有 N5/N4 词卡；初级语法会在执行时检索 N5/N4 常见语法。指定检索可以直接输入想学的词或语法。
                </p>
              </div>

              <div className={styles.plannerGroup}>
                <strong>单词</strong>
                <div className={styles.plannerActions}>
                  <button
                    className="softButton primaryButton"
                    onClick={() => void handleGenerateTermBatch('beginner')}
                    disabled={generatingTerm}
                  >
                    <BookOpen size={18} />
                    {generatingTerm ? '正在生成…' : '生成初级单词切片'}
                  </button>
                  <label className={styles.grammarSearchBox}>
                    <Search size={18} />
                    <input
                      value={termQuery}
                      onChange={(event) => setTermQuery(event.target.value)}
                      placeholder="输入特定单词"
                    />
                  </label>
                  <button
                    className="softButton"
                    onClick={() => void handleGenerateTermBatch('specific')}
                    disabled={generatingTerm}
                  >
                    <Sparkles size={18} />
                    检索并生成
                  </button>
                </div>
              </div>

              <div className={styles.plannerGroup}>
                <strong>语法</strong>
                <div className={styles.plannerActions}>
                  <button
                    className="softButton primaryButton"
                    onClick={() => void handleGenerateGrammarBatch('beginner')}
                    disabled={generatingGrammar}
                  >
                    <BookOpen size={18} />
                    {generatingGrammar ? '正在生成…' : '生成初级语法切片'}
                  </button>
                  <label className={styles.grammarSearchBox}>
                    <Search size={18} />
                    <input
                      value={grammarQuery}
                      onChange={(event) => setGrammarQuery(event.target.value)}
                      placeholder="输入特定语法"
                    />
                  </label>
                  <button
                    className="softButton"
                    onClick={() => void handleGenerateGrammarBatch('specific')}
                    disabled={generatingGrammar}
                  >
                    <Sparkles size={18} />
                    检索并生成
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className={styles.clipSectionHeader}>
            <div>
              <span className="chip badgeMint">整片视频</span>
              <h3 className={styles.subTitle}>需要确认字幕和上传的原片</h3>
            </div>
            <span>{sourceImportedClips.length} 个整片</span>
          </div>

          <div className={styles.favoriteList} data-testid="source-clip-list">
            {sourceImportedClips.map((clip) => {
              const siteUploaded = isUploadedToSite(clip)
              const clipStatus =
                clip.studyIndex
                  ? `${clip.studyIndex.quality === 'trusted' ? '已确认字幕时间轴' : '已建立字幕草稿时间轴'} / ${siteUploaded ? '站点已上传' : '本地草稿'}`
                  : clip.subtitleSource === 'auto'
                    ? '已自动生成双语字幕'
                    : clip.subtitleSource === 'manual'
                      ? `已绑定字幕 / ${clip.subtitleFileName}`
                      : '还没有字幕'
              const subtitleBadge = clip.studyIndex
                ? clip.studyIndex.quality === 'trusted'
                  ? '字幕可信'
                  : '字幕待确认'
                : clip.subtitleSource === 'manual'
                  ? '外部字幕'
                  : clip.subtitleSource === 'auto'
                    ? '自动字幕'
                    : '无字幕'
              const clipSummary =
                clip.studyIndex
                  ? `字幕时间轴包含 ${clip.studyIndex.summary.cueCount} 条字幕；已生成 ${sliceCountMap[clip.id] ?? 0} 条学习切片。${siteUploaded ? '整片已上传到站点。' : '整片还在本地，确认字幕后可上传。'}`
                  : '当前还没有字幕时间轴，可以上传字幕或重新生成自动字幕。'

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
                    <div className={styles.clipBadges}>
                      <span
                        className={`${styles.clipBadge} ${
                          siteUploaded ? styles.clipBadgeUploaded : styles.clipBadgeDraft
                        }`}
                      >
                        {siteUploaded ? '站点已上传' : '本地草稿'}
                      </span>
                      <span className={styles.clipBadge}>{subtitleBadge}</span>
                    </div>
                    <small>{clipSummary}</small>
                    {busyClipId === clip.id || uploadingClipId === clip.id ? (
                      <small>{statusText}</small>
                    ) : null}
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
                    {clip.importMode === 'raw' ? (
                      <label
                        className={`softButton ${styles.fileActionButton} ${
                          replacingSubtitleClipId === clip.id ? styles.fileActionButtonBusy : ''
                        }`}
                        aria-disabled={replacingSubtitleClipId === clip.id}
                      >
                        <Upload size={16} />
                        {replacingSubtitleClipId === clip.id
                          ? '导入字幕中…'
                          : clip.subtitleSource
                            ? '替换字幕'
                            : '上传字幕'}
                        <input
                          className={styles.hiddenFileInput}
                          type="file"
                          accept=".srt,.vtt,.ass,.ssa"
                          disabled={replacingSubtitleClipId === clip.id}
                          onChange={(event) => {
                            void handleReplaceClipSubtitle(clip, event.currentTarget.files)
                            event.currentTarget.value = ''
                          }}
                        />
                      </label>
                    ) : null}
                    {clip.importMode === 'raw' && clip.studyIndex?.quality === 'draft' ? (
                      <button
                        className="softButton"
                        onClick={() => void handleTrustStudyIndex(clip.id, clip.title)}
                      >
                        <CheckCircle2 size={16} />
                        确认字幕可信
                      </button>
                    ) : null}
                    {clip.importMode === 'raw' && clip.studyIndex ? (
                      <button
                        className="softButton"
                        onClick={() => handleOpenTranscriptReview(clip)}
                      >
                        <BookOpen size={16} />
                        预览/编辑字幕
                      </button>
                    ) : null}
                    {canUploadRawClipToSite(clip) && !siteUploaded ? (
                      <button
                        className="softButton primaryButton"
                        onClick={() => void handleUploadClipToSite(clip)}
                        disabled={uploadingClipId === clip.id}
                      >
                        <Upload size={16} />
                        {uploadingClipId === clip.id ? '上传中…' : '上传整片到站点'}
                      </button>
                    ) : null}
                    {canUploadRawClipToSite(clip) && siteUploaded ? (
                      <span className={styles.uploadedState}>
                        <CheckCircle2 size={16} />
                        已上传到站点
                      </span>
                    ) : null}
                    {clip.importMode === 'raw' && clip.studyIndex && !siteUploaded && !canUploadRawClipToSite(clip) ? (
                      <span className={styles.uploadGate}>先确认字幕，再上传整片</span>
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
            {sourceImportedClips.length === 0 ? (
              <p className={styles.placeholder}>导入后的视频会先暂存在当前浏览器；确认字幕后再上传整片到网站存储。</p>
            ) : null}
          </div>

          {sliceImportedClips.length > 0 ? (
            <details className={styles.sliceArchive}>
              <summary data-testid="generated-slice-summary">
                已生成/导入的学习切片 {sliceImportedClips.length} 条
              </summary>
              <div className={styles.sliceArchiveList}>
                {sliceImportedClips.map((clip) => (
                  <article key={clip.id} className={styles.sliceArchiveItem}>
                    <div>
                      <strong>{clip.title}</strong>
                      <span>
                        {clip.sourceAnimeTitle ?? clip.theme} /{' '}
                        {formatRange(
                          clip.clipStartMs ?? 0,
                          clip.clipEndMs ?? (clip.clipStartMs ?? 0) + clip.durationMs,
                        )}
                      </span>
                    </div>
                    <button
                      className="softButton"
                      onClick={() => void handleDeleteImportedClip(clip.id, clip.title)}
                      aria-label={`删除 ${clip.title}`}
                    >
                      <Trash2 size={16} />
                      删除
                    </button>
                  </article>
                ))}
              </div>
            </details>
          ) : null}
        </div>
        <details className={`${styles.card} ${styles.detailsCard}`}>
          <summary className={styles.cardHeader}>
            <div>
              <h2>字幕和提醒</h2>
              <small>调整播放时的显示偏好</small>
            </div>
          </summary>

          <div className={styles.settingList}>
            <button className={styles.settingItem} onClick={() => void handleToggleReminder()}>
              <div>
                <strong>学习提醒</strong>
                <span>当前：{settings.remindersEnabled ? '开启' : '关闭'}</span>
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
                <strong>播放时显示知识点</strong>
                <span>
                  当前：{settings.showPlaybackKnowledge ? '显示单词和语法提示' : '只显示字幕'}
                </span>
              </div>
              <Sparkles size={18} />
            </button>

            <button
              className={styles.settingItem}
              onClick={() => void updateSettings({ showRomaji: !settings.showRomaji })}
            >
              <div>
                <strong>罗马音</strong>
                <span>当前：{settings.showRomaji ? '显示' : '隐藏'}</span>
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
                <strong>日文字幕</strong>
                <span>当前：{settings.showJapaneseSubtitle ? '显示' : '隐藏'}</span>
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
                <strong>中文字幕</strong>
                <span>当前：{settings.showChineseSubtitle ? '显示' : '隐藏'}</span>
              </div>
              <Settings2 size={18} />
            </button>
          </div>
        </details>

      </section>

      {reviewingClip ? (
        <SubtitleReviewOverlay
          clip={reviewingClip}
          segments={reviewSegments}
          saving={savingTranscript}
          onChange={handleChangeReviewSegment}
          onSaveTrusted={() => void handleSaveTranscriptReview()}
          onClose={() => {
            setReviewingClipId(null)
            setReviewSegments([])
          }}
        />
      ) : null}
    </div>
  )
}
