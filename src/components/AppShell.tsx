import { BookOpenText, GraduationCap, Music2, LibraryBig, UserRound } from 'lucide-react'
import * as Progress from '@radix-ui/react-progress'
import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { useAppBootstrap } from '../hooks/useAppBootstrap'
import { readingCourse, readingCourseVersion } from '../data/readingCourse'
import { useAppStore } from '../store/useAppStore'
import { useCourseStore } from '../store/useCourseStore'
import styles from './AppShell.module.css'

const navItems = [
  { to: '/course', label: '21天课程', icon: GraduationCap },
  { to: '/notes', label: '原文阅读', icon: BookOpenText },
  { to: '/learn', label: '拓展练习', icon: LibraryBig },
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

  const readingProgress = courseState.readingCourse?.version === readingCourseVersion ? courseState.readingCourse : undefined
  const completedDays = readingCourse.filter((lesson) => readingProgress?.lessons[lesson.day]?.completedAt).length
  const completionRatio = completedDays / readingCourse.length
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
          <NavLink to="/" className={styles.brandCard} title="返回官网首页">
            <div className={styles.brandBadge}>日</div>
            <div className={styles.brandText}>
              <strong>Happy Japanese</strong>
              <span>一字一句，读懂日语</span>
            </div>
          </NavLink>

          <nav className={styles.nav}>
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/course'}
                  className={({ isActive }) => `${styles.navItem} ${
                    isActive || (item.to === '/course' && location.pathname.startsWith('/course/'))
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

          <div className={styles.goalMini} aria-label="21天课程进度">
            <div>
              <span>阅读入门</span>
              <strong>{`${completedDays} / 21 天`}</strong>
            </div>
            <Progress.Root
              className={styles.goalBar}
              value={Math.round(completionRatio * 100)}
              aria-label="课程完成度"
            >
              <Progress.Indicator
                className={styles.goalBarIndicator}
                style={{ transform: `translateX(-${100 - completionRatio * 100}%)` }}
              />
            </Progress.Root>
            <small>
              {initialized && courseInitialized
                ? completionRatio >= 1
                  ? '已完成'
                  : '随时暂停，接着学习'
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
                <strong>Happy Japanese</strong>
                <span>一字一句，读懂日语</span>
              </div>
              <span className="chip badgeMint">{`${completedDays} / 21 天`}</span>
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
                end={item.to === '/course'}
                className={({ isActive }) => `${styles.bottomItem} ${
                  isActive || (item.to === '/course' && location.pathname.startsWith('/course/'))
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
