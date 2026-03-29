import {
  BellRing,
  Flame,
  Heart,
  Link2,
  Save,
  Settings2,
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
  const [importing, setImporting] = useState(false)

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

  const handleImport = async () => {
    if (!clipFile) {
      return
    }

    setImporting(true)
    try {
      await importClip(clipFile, clipTitle, clipTheme)
      setClipFile(null)
      setClipTitle('')
      setClipTheme('')
    } finally {
      setImporting(false)
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
            日目标、连续打卡、收藏回看、私有导入和资源致谢都在这里统一管理。
          </p>
        </div>

        <div className={`${styles.highlightCard} glassCard`}>
          <div className={styles.streakBadge}>
            <Flame size={20} />
            连续打卡 {streak} 天
          </div>
          <p>{completionRatio >= 1 ? '今天已经完成全部目标，很稳。' : '再完成一点点，今天就能顺利打卡。'}</p>
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
              <h2>你想今天完成多少</h2>
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
              <h2>这个月已经亮起的日子</h2>
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
            {favoriteLessons.length === 0 ? <p className={styles.placeholder}>还没有收藏的视频。</p> : null}
          </div>
        </div>

        <div className={`${styles.card} glassCard`}>
          <header className={styles.cardHeader}>
            <div>
              <span className="chip badgePeach">私有导入</span>
              <h2>把你自己的片段也放进学习流</h2>
            </div>
          </header>
          <div className={styles.uploadForm}>
            <input
              className={styles.fileInput}
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              onChange={(event) => setClipFile(event.target.files?.[0] ?? null)}
            />
            <input
              className={styles.textInput}
              value={clipTitle}
              onChange={(event) => setClipTitle(event.target.value)}
              placeholder="片段标题（不填则使用文件名）"
            />
            <input
              className={styles.textInput}
              value={clipTheme}
              onChange={(event) => setClipTheme(event.target.value)}
              placeholder="主题，比如：校园 / 动漫 / 面试"
            />
            <button
              className="softButton secondaryButton"
              onClick={() => void handleImport()}
              disabled={importing || !clipFile}
            >
              <Upload size={18} />
              {importing ? '导入中…' : '导入到首页视频流'}
            </button>
          </div>
          <div className={styles.favoriteList}>
            {importedClips.map((clip) => (
              <article key={clip.id}>
                <Video size={16} />
                <div>
                  <strong>{clip.title}</strong>
                  <span>{clip.theme}</span>
                </div>
              </article>
            ))}
            {importedClips.length === 0 ? <p className={styles.placeholder}>你导入的片段会只保存在当前设备。</p> : null}
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
                    {source.provider} · {source.license}
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
