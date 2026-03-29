import { BrainCircuit, CalendarClock, CheckCircle2, HelpCircle, RotateCcw, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'

import { formatDateLabel } from '../lib/date'
import { getDueReviewItems, getUpcomingReviewItems } from '../lib/selectors'
import { getReviewKindLabel } from '../lib/review'
import { useAppStore } from '../store/useAppStore'
import styles from './ReviewPage.module.css'

export function ReviewPage() {
  const reviewItems = useAppStore((state) => state.reviewItems)
  const reviewLogs = useAppStore((state) => state.reviewLogs)
  const answerReview = useAppStore((state) => state.answerReview)

  const [showAnswer, setShowAnswer] = useState(false)
  const dueItems = useMemo(() => getDueReviewItems(reviewItems), [reviewItems])
  const upcomingItems = useMemo(() => getUpcomingReviewItems(reviewItems).slice(0, 5), [reviewItems])
  const current = dueItems[0]

  return (
    <div className={`${styles.page} fadeIn`}>
      <section className={styles.hero}>
        <div>
          <span className="chip badgeMint">艾宾浩斯复习</span>
          <h1 className="pageTitle">趁还没忘掉，轻轻复习一下</h1>
          <p className="sectionIntro">
            认识 / 模糊 / 忘记 三选一，系统会自动帮你改下次出现的时间。
          </p>
        </div>

        <div className={`${styles.heroStats} glassCard`}>
          <article>
            <small>待复习</small>
            <strong>{dueItems.length}</strong>
          </article>
          <article>
            <small>复习记录</small>
            <strong>{reviewLogs.length}</strong>
          </article>
          <article>
            <small>下一批</small>
            <strong>{upcomingItems.length}</strong>
          </article>
        </div>
      </section>

      <section className={styles.layout}>
        <div className={`${styles.cardPanel} glassCard`}>
          {current ? (
            <>
              <div className={styles.cardMeta}>
                <span className="chip badgePeach">{getReviewKindLabel(current.kind)}</span>
                <span className="chip">
                  <CalendarClock size={14} />
                  到期于 {formatDateLabel(current.nextReviewAt)}
                </span>
              </div>

              <div className={styles.reviewCard}>
                <p className={styles.expression}>{current.expression}</p>
                <p className={styles.reading}>{current.reading}</p>

                {showAnswer ? (
                  <div className={styles.answerBlock}>
                    <strong>{current.meaningZh}</strong>
                    <p>{current.context}</p>
                  </div>
                ) : (
                  <button className="softButton secondaryButton" onClick={() => setShowAnswer(true)}>
                    <BrainCircuit size={18} />
                    点我揭晓答案
                  </button>
                )}
              </div>

              <div className={styles.actions}>
                <button
                  className="softButton secondaryButton"
                  onClick={() => {
                    setShowAnswer(false)
                    void answerReview(current.id, 'know')
                  }}
                >
                  <CheckCircle2 size={18} />
                  认识
                </button>
                <button
                  className="softButton"
                  onClick={() => {
                    setShowAnswer(false)
                    void answerReview(current.id, 'fuzzy')
                  }}
                >
                  <HelpCircle size={18} />
                  模糊
                </button>
                <button
                  className="softButton dangerButton"
                  onClick={() => {
                    setShowAnswer(false)
                    void answerReview(current.id, 'forget')
                  }}
                >
                  <XCircle size={18} />
                  忘记
                </button>
              </div>
            </>
          ) : (
            <div className={styles.emptyState}>
              <RotateCcw size={32} />
              <strong>今天的复习已经清空啦</strong>
              <p>去首页看两条视频，或者去速记库加几张卡片进复习吧。</p>
            </div>
          )}
        </div>

        <div className={styles.sideColumn}>
          <div className={`${styles.sideCard} glassCard`}>
            <div className={styles.sideHeader}>
              <h2>接下来会出现</h2>
              <span className="chip">{upcomingItems.length} 条</span>
            </div>
            <div className={styles.reviewList}>
              {upcomingItems.map((item) => (
                <article key={item.id}>
                  <strong>{item.expression}</strong>
                  <span>{getReviewKindLabel(item.kind)}</span>
                  <small>{formatDateLabel(item.nextReviewAt)}</small>
                </article>
              ))}
              {upcomingItems.length === 0 ? <p className={styles.placeholder}>暂时没有后续队列。</p> : null}
            </div>
          </div>

          <div className={`${styles.sideCard} glassCard`}>
            <div className={styles.sideHeader}>
              <h2>最近复习记录</h2>
              <span className="chip">{reviewLogs.slice(0, 5).length} 条</span>
            </div>
            <div className={styles.logList}>
              {reviewLogs.slice(0, 5).map((log) => (
                <article key={log.id}>
                  <strong>{log.result === 'know' ? '认识' : log.result === 'fuzzy' ? '模糊' : '忘记'}</strong>
                  <small>{formatDateLabel(log.reviewedAt)}</small>
                </article>
              ))}
              {reviewLogs.length === 0 ? <p className={styles.placeholder}>你完成的复习记录会显示在这里。</p> : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
