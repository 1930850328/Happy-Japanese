import { BookOpenText, House, LibraryBig, RotateCcw, UserRound } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { useAppBootstrap } from '../hooks/useAppBootstrap'
import { APP_BUILD_LABEL, APP_BUILD_NOTE } from '../lib/appVersion'
import { getGoalCompletionRatio, getTodayProgress } from '../lib/selectors'
import { useAppStore } from '../store/useAppStore'
import styles from './AppShell.module.css'

const navItems = [
  { to: '/', label: '短视频', icon: House },
  { to: '/notes', label: '备注解析', icon: BookOpenText },
  { to: '/review', label: '复习', icon: RotateCcw },
  { to: '/vocab', label: '速记库', icon: LibraryBig },
  { to: '/profile', label: '我的', icon: UserRound },
]

export function AppShell() {
  useAppBootstrap()
  const location = useLocation()

  const studyEvents = useAppStore((state) => state.studyEvents)
  const goal = useAppStore((state) => state.goal)
  const initialized = useAppStore((state) => state.initialized)
  const sliceTask = useAppStore((state) => state.sliceTask)

  const progress = getTodayProgress(studyEvents)
  const completionRatio = getGoalCompletionRatio(progress, goal)
  const showSliceBanner = sliceTask.status !== 'idle' && Boolean(sliceTask.detail)
  const isImmersiveRoute = location.pathname === '/immersive'
  const sliceBannerText =
    sliceTask.status === 'running'
      ? `切片任务进行中 · ${sliceTask.percent}% · ${sliceTask.detail}`
      : sliceTask.status === 'completed'
        ? `切片任务已完成 · ${sliceTask.detail}`
        : `切片任务遇到问题 · ${sliceTask.detail}`

  return (
    <div className={`${styles.shell} ${isImmersiveRoute ? styles.shellImmersive : ''}`}>
      {!isImmersiveRoute ? (
        <aside className={styles.rail}>
          <div className={`${styles.brandCard} glassCard`}>
            <div className={styles.brandBadge}>ゆる</div>
            <div className={styles.brandText}>
              <strong>YuruNihongo</strong>
              <small className={styles.versionBadge}>
                {APP_BUILD_LABEL} · {APP_BUILD_NOTE}
              </small>
              <span>轻松、治愈、能坚持下去的日语学习流</span>
            </div>
          </div>

          <div className={`${styles.goalCard} glassCard`}>
            <div className={styles.goalHeader}>
              <span className="chip badgePeach">今日进度</span>
              <strong>{Math.round(completionRatio * 100)}%</strong>
            </div>
            <div className={styles.goalBar}>
              <div style={{ width: `${Math.max(completionRatio * 100, 6)}%` }} />
            </div>
            <div className={styles.goalGrid}>
              <div>
                <small>视频</small>
                <strong>
                  {progress.video}/{goal.videosTarget}
                </strong>
              </div>
              <div>
                <small>单词</small>
                <strong>
                  {progress.word}/{goal.wordsTarget}
                </strong>
              </div>
              <div>
                <small>语法</small>
                <strong>
                  {progress.grammar}/{goal.grammarTarget}
                </strong>
              </div>
              <div>
                <small>复习</small>
                <strong>
                  {progress.review}/{goal.reviewTarget}
                </strong>
              </div>
            </div>
            <p className={styles.goalHint}>
              {initialized
                ? completionRatio >= 1
                  ? '今天已经顺利打卡，继续保持就很棒。'
                  : '先看一条视频，再顺手记一句话，会很有进入感。'
                : '正在载入你的学习小窝……'}
            </p>
          </div>

          <nav className={styles.nav}>
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
                  }
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </nav>
        </aside>
      ) : null}

      <main className={`${styles.main} ${isImmersiveRoute ? styles.mainImmersive : ''}`}>
        {!isImmersiveRoute ? (
          <>
            <div className={styles.mobileTopBar}>
              <div>
                <strong>YuruNihongo</strong>
                <small className={styles.mobileVersion}>{APP_BUILD_LABEL}</small>
                <span>今天也轻松学一点</span>
              </div>
              <span className="chip badgeMint">{Math.round(completionRatio * 100)}%</span>
            </div>
            {showSliceBanner ? (
              <NavLink
                to="/profile"
                className={`${styles.sliceBanner} ${
                  sliceTask.status === 'error' ? styles.sliceBannerError : ''
                }`}
              >
                <div className={styles.sliceBannerText}>
                  <strong>{sliceTask.status === 'running' ? '切片任务进行中' : '切片任务提醒'}</strong>
                  <span>{sliceBannerText}</span>
                </div>
                <span className="chip badgePeach">回到我的页查看</span>
              </NavLink>
            ) : null}
          </>
        ) : null}
        <Outlet />
      </main>

      {!isImmersiveRoute ? (
        <nav className={styles.bottomNav}>
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `${styles.bottomItem} ${isActive ? styles.bottomItemActive : ''}`
                }
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
      ) : null}
    </div>
  )
}
