import { BookOpenText, House, LibraryBig, RotateCcw, UserRound } from 'lucide-react'
import * as Progress from '@radix-ui/react-progress'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { useAppBootstrap } from '../hooks/useAppBootstrap'
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
              <span>轻松、治愈、能坚持下去的日语学习流</span>
            </div>
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

          <div className={styles.goalMini} aria-label="今日学习进度">
            <div>
              <span>今日</span>
              <strong>{progress.video}/{goal.videosTarget} 条</strong>
            </div>
            <Progress.Root
              className={styles.goalBar}
              value={Math.round(completionRatio * 100)}
              aria-label="今日目标完成度"
            >
              <Progress.Indicator
                className={styles.goalBarIndicator}
                style={{ transform: `translateX(-${100 - Math.max(completionRatio * 100, 6)}%)` }}
              />
            </Progress.Root>
            <small>
              {initialized
                ? completionRatio >= 1
                  ? '已完成'
                  : `${Math.round(completionRatio * 100)}%`
                : '载入中'}
            </small>
          </div>
        </aside>
      ) : null}

      <main className={`${styles.main} ${isImmersiveRoute ? styles.mainImmersive : ''}`}>
        {!isImmersiveRoute ? (
          <>
            <div className={styles.mobileTopBar}>
              <div>
                <strong>YuruNihongo</strong>
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
