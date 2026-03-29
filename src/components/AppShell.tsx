import { BookOpenText, House, LibraryBig, RotateCcw, UserRound } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

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

  const studyEvents = useAppStore((state) => state.studyEvents)
  const goal = useAppStore((state) => state.goal)
  const initialized = useAppStore((state) => state.initialized)

  const progress = getTodayProgress(studyEvents)
  const completionRatio = getGoalCompletionRatio(progress, goal)

  return (
    <div className={styles.shell}>
      <aside className={styles.rail}>
        <div className={`${styles.brandCard} glassCard`}>
          <div className={styles.brandBadge}>ゆる</div>
          <div className={styles.brandText}>
            <strong>YuruNihongo</strong>
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

      <main className={styles.main}>
        <div className={styles.mobileTopBar}>
          <div>
            <strong>YuruNihongo</strong>
            <span>今天也轻松学一点</span>
          </div>
          <span className="chip badgeMint">{Math.round(completionRatio * 100)}%</span>
        </div>
        <Outlet />
      </main>

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
    </div>
  )
}
