import {
  BellRing,
  Flame,
  Heart,
  Link2,
  Save,
  Settings2,
  Sparkles,
  Upload,
  Video,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { sourceAttributions } from '../data/sources'
import { countStreak, getMonthCalendar, groupProgressByDate } from '../lib/date'
import { getCompletedDateSet, getGoalCompletionRatio, getTodayProgress } from '../lib/selectors'
import { useAppStore } from '../store/useAppStore'
import styles from './ProfilePage.module.css'

export function ProfilePage() {
  const goal = useAppStore((state) => state.goal)
  const studyEvents = useAppStore((state) => state.studyEvents)
  const favorites = useAppStore((state) => state.favorites)
  const lessons = useAppStore((state) => state.lessons)
  const importedClips = useAppStore((state) => state.importedClips)
  const settings = useAppStore((state) => state.settings)
  const updateGoal = useAppStore((state) => state.updateGoal)
  const importClip = useAppStore((state) => state.importClip)
  const importSlicerManifest = useAppStore((state) => state.importSlicerManifest)
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
  const [clipFile, setClipFile] = useState<File | null>(null)
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null)
  const [slicerManifestFile, setSlicerManifestFile] = useState<File | null>(null)
  const [slicerClipFiles, setSlicerClipFiles] = useState<File[]>([])
  const [importing, setImporting] = useState(false)
  const [importingSlicer, setImportingSlicer] = useState(false)
  const [busyClipId, setBusyClipId] = useState<string | null>(null)
  const [statusText, setStatusText] = useState('')
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
    setStatusText('准备自动字幕中…')

    try {
      await generateAutoSubtitles(clipId, (message) => setStatusText(message))
    } finally {
      setBusyClipId(null)
    }
  }

  const handleImport = async () => {
    if (!clipFile) {
      return
    }

    setImporting(true)
    setStatusText('正在导入原片…')

    try {
      const clip = await importClip({
        file: clipFile,
        subtitleFile,
        title: clipTitle,
        theme: clipTheme,
      })

      if (!subtitleFile) {
        await handleGenerateForClip(clip.id)
      } else {
        setStatusText('外部字幕已绑定，可直接回首页学习。')
      }

      setClipFile(null)
      setSubtitleFile(null)
      setClipTitle('')
      setClipTheme('')
    } finally {
      setImporting(false)
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

  return (
    <div className={`${styles.page} fadeIn`}>
      <section className={styles.hero}>
        <div>
          <span className="chip badgeMint">目标 / 收藏 / 设置</span>
          <h1 className="pageTitle">把学习节奏调成你最容易坚持的样子</h1>
          <p className="sectionIntro">
            每日目标、连续打卡、收藏回看、原片导入和切片产物导入都放在这里统一管理。
            现在既可以导入整段原片，让系统自动字幕和自动切片，也可以把独立切片仓库生成的
            `manifest + clips` 直接导入首页短视频流。
          </p>
        </div>

        <div className={`${styles.highlightCard} glassCard`}>
          <div className={styles.streakBadge}>
            <Flame size={20} />
            连续打卡 {streak} 天
          </div>
          <p>
            {completionRatio >= 1
              ? '今天已经完成全部目标，继续保持这个节奏。'
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
              <span className="chip badgePeach">导入素材</span>
              <h2>整段原片和切片工具产物都能直接进入短视频模块</h2>
            </div>
          </header>

          <div className={styles.uploadForm}>
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
            <input
              className={styles.textInput}
              value={clipTitle}
              onChange={(event) => setClipTitle(event.target.value)}
              placeholder="原片标题，不填就用文件名"
            />
            <input
              className={styles.textInput}
              value={clipTheme}
              onChange={(event) => setClipTheme(event.target.value)}
              placeholder="主题，例如：校园 / 乐队 / 日常 / 面试"
            />
            <p className={styles.helperNote}>
              第一组是整段原片导入。第二个文件框可选；如果不提供字幕，系统会在导入后继续自动识别日语字幕，
              再补成学习向中文字幕、知识点和自动切片。
            </p>
            {statusText ? <p className={styles.statusNote}>{statusText}</p> : null}
            <button
              className="softButton secondaryButton"
              onClick={() => void handleImport()}
              disabled={importing || !clipFile}
            >
              <Upload size={18} />
              {importing ? '处理中…' : '导入原片并进入首页流'}
            </button>
          </div>

          <div className={styles.subSection}>
            <div>
              <span className="chip badgeMint">切片工具产物导入</span>
              <h3 className={styles.subTitle}>把 `anime-learning-slicer` 输出直接导入首页短视频流</h3>
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
                先选切片工具输出目录里的 `manifest.json`，再选 `clips` 目录中的短视频文件。
                导入后这些视频会直接出现在首页短视频流里，不再二次切片。
              </p>
              {slicerStatusText ? <p className={styles.statusNote}>{slicerStatusText}</p> : null}
              <button
                className="softButton primaryButton"
                onClick={() => void handleImportSlicerOutput()}
                disabled={importingSlicer || !slicerManifestFile || slicerClipFiles.length === 0}
              >
                <Video size={18} />
                {importingSlicer ? '导入切片中…' : '导入切片工具产物'}
              </button>
            </div>
          </div>

          <div className={styles.favoriteList}>
            {importedClips.map((clip) => {
              const clipStatus =
                clip.importMode === 'sliced'
                  ? `已导入切片 / ${clip.sourceAnimeTitle ?? '本地切片'}`
                  : clip.subtitleSource === 'auto'
                    ? '已自动生成双语字幕'
                    : clip.subtitleSource === 'manual'
                      ? `已绑定字幕 ${clip.subtitleFileName}`
                      : '还没有字幕'

              const clipSummary =
                clip.importMode === 'sliced'
                  ? '这条已经是切好的学习短视频，会直接进入首页流。'
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
                    {clip.importMode === 'sliced' ? null : (
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
                    )}
                  </div>
                </article>
              )
            })}
            {importedClips.length === 0 ? (
              <p className={styles.placeholder}>导入的视频只保存在当前设备，不会上传。</p>
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
    </div>
  )
}
