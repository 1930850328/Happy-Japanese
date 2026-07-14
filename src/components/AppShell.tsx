import { BookOpenText, BrainCircuit, GraduationCap, Music2, RotateCcw, UserRound } from 'lucide-react'
import * as Progress from '@radix-ui/react-progress'
import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { useAppBootstrap } from '../hooks/useAppBootstrap'
import { getCourseCompletion } from '../lib/courseEngine'
import { useAppStore } from '../store/useAppStore'
import { useCourseStore } from '../store/useCourseStore'
import styles from './AppShell.module.css'

const navItems = [
  { to: '/', label: '今日学习', icon: GraduationCap },
  { to: '/literacy', label: '能力训练', icon: BrainCircuit },
  { to: '/notes', label: '原文阅读', icon: BookOpenText },
  { to: '/learn/review', label: '复习', icon: RotateCcw },
  { to: '/songs', label: '歌曲', icon: Music2 },
  { to: '/profile', label: '我的', icon: UserRound },
]

export function AppShell() {
  useAppBootstrap()
  const location = useLocation()

  const initialized = useAppStore((state) => state.initialized)
  const sliceTask = useAppStore((state) => state.sliceTask)
  const courseInitialized = useCourseStore((state) => state.initialized)
  const courseState = useCourseStore((state) => state.courseState)
  const initializeCourse = useCourseStore((state) => state.initialize)

  const courseCompletion = getCourseCompletion(courseState)
  const completionRatio = courseCompletion.ratio
  const showSliceBanner = sliceTask.status !== 'idle' && Boolean(sliceTask.detail)
  const isSongRoute = location.pathname === '/songs'
  const isImmersiveRoute = location.pathname === '/immersive' || isSongRoute
  const sliceBannerText =
    sliceTask.status === 'running'
      ? `视频处理进行中 · ${sliceTask.percent}% · ${sliceTask.detail}`
      : sliceTask.status === 'completed'
        ? `视频处理已完成 · ${sliceTask.detail}`
        : `视频处理遇到问题 · ${sliceTask.detail}`

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  useEffect(() => {
    void initializeCourse()
  }, [initializeCourse])

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
                  className={({ isActive }) => `${styles.navItem} ${
                    isActive || (item.to === '/' && location.pathname.startsWith('/learn/') && location.pathname !== '/learn/review')
                      ? styles.navItemActive
                      : ''
                  }`}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              )
            })}
          </nav>

          <div className={styles.goalMini} aria-label="今日学习进度">
            <div>
              <span>主课程</span>
              <strong>{courseState.profile ? `${courseCompletion.completed}/${courseCompletion.total} 课` : '尚未开始'}</strong>
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
              {initialized && courseInitialized
                ? completionRatio >= 1
                  ? '已完成'
                  : courseState.profile ? `${Math.round(completionRatio * 100)}%` : '开始课程'
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
              <span className="chip badgeMint">{courseState.profile ? `${Math.round(completionRatio * 100)}%` : '开始'}</span>
            </div>
            {showSliceBanner ? (
              <NavLink
                to="/profile"
                className={`${styles.sliceBanner} ${
                  sliceTask.status === 'error' ? styles.sliceBannerError : ''
                }`}
              >
                <div className={styles.sliceBannerText}>
                  <strong>{sliceTask.status === 'running' ? '视频处理进行中' : '视频处理提醒'}</strong>
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
                className={({ isActive }) => `${styles.bottomItem} ${
                  isActive || (item.to === '/' && location.pathname.startsWith('/learn/') && location.pathname !== '/learn/review')
                    ? styles.bottomItemActive
                    : ''
                }`}
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
