import { ArrowLeft, ArrowRight, BrainCircuit, Check, CircleX, Clock3, RotateCcw, ShieldCheck, Volume2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { courseLessons, courseNodeMap } from '../data/courseCatalog'
import {
  getCourseQuestionDimension,
  getCourseQuestionInteraction,
  getDueCourseDimension,
  getDueCourseMastery,
  isCourseQuestionCorrect,
  prepareCourseQuestions,
} from '../lib/courseEngine'
import { speakJapanese } from '../lib/speech'
import { useCourseStore } from '../store/useCourseStore'
import type { CourseLearningDimension, CourseQuestion } from '../types'
import styles from './CourseReviewPage.module.css'

function questionsForNode(nodeId: string) {
  return courseLessons.flatMap((lesson) => lesson.questions).filter((question) => question.nodeId === nodeId)
}

function masteryLabel(state: string) {
  if (state === 'stable') return '稳定'
  if (state === 'reviewing') return '巩固中'
  if (state === 'at_risk') return '易忘'
  return '学习中'
}

function dimensionLabel(dimension: CourseLearningDimension) {
  const labels: Record<CourseLearningDimension, string> = {
    recognition: '看字认音',
    listening: '听音辨字',
    recall: '主动回忆',
    production: '完整拼读',
    transfer: '新组合迁移',
  }
  return labels[dimension]
}

export function CourseReviewPage() {
  const initialized = useCourseStore((state) => state.initialized)
  const courseState = useCourseStore((state) => state.courseState)
  const initialize = useCourseStore((state) => state.initialize)
  const saveReviewAnswer = useCourseStore((state) => state.saveReviewAnswer)

  const due = useMemo(() => getDueCourseMastery(courseState), [courseState])
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [question, setQuestion] = useState<CourseQuestion | null>(null)
  const [activeDimension, setActiveDimension] = useState<ReturnType<typeof getDueCourseDimension>>(undefined)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [inputAnswer, setInputAnswer] = useState('')
  const [answerCorrect, setAnswerCorrect] = useState<boolean | null>(null)
  const [questionStartedAt, setQuestionStartedAt] = useState(() => Date.now())
  const [reviewedCount, setReviewedCount] = useState(0)

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    if (activeNodeId || due.length === 0) return
    const mastery = due[0]
    const nodeId = mastery.nodeId
    const dimension = getDueCourseDimension(mastery)
    const allCandidates = questionsForNode(nodeId)
    const dimensionCandidates = allCandidates.filter((item) =>
      !dimension || getCourseQuestionDimension(item) === dimension,
    )
    const candidates = dimensionCandidates.length > 0 ? dimensionCandidates : allCandidates
    const attempts = courseState.evidence.filter((item) => item.nodeId === nodeId).length
    setActiveNodeId(nodeId)
    setActiveDimension(dimension)
    const prepared = prepareCourseQuestions(candidates, `${nodeId}:${attempts}`)
    setQuestion(prepared[attempts % Math.max(prepared.length, 1)] ?? null)
    setQuestionStartedAt(Date.now())
  }, [activeNodeId, courseState.evidence, due])

  if (!initialized) return <div className={`${styles.loading} glassCard`}>正在准备复习…</div>
  if (!courseState.profile) return <Navigate replace to="/" />

  const answer = async (response: string | number) => {
    if (!question || answerCorrect !== null) return
    const correct = isCourseQuestionCorrect(question, response)
    setAnswerCorrect(correct)
    await saveReviewAnswer({
      questionId: question.id,
      nodeId: question.nodeId,
      correct,
      elapsedMs: Math.max(300, Date.now() - questionStartedAt),
      dimension: getCourseQuestionDimension(question),
      response: String(response),
    })
    setReviewedCount((count) => count + 1)
  }

  const continueReview = () => {
    const nextDue = getDueCourseMastery(useCourseStore.getState().courseState)
    const nextNode = nextDue.find((item) => item.nodeId !== activeNodeId) ?? nextDue[0]
    if (!nextNode) {
      setActiveNodeId(null)
      setQuestion(null)
      setSelectedIndex(null)
      return
    }
    const candidates = questionsForNode(nextNode.nodeId)
    const dimension = getDueCourseDimension(nextNode)
    const matchedCandidates = candidates.filter((item) =>
      !dimension || getCourseQuestionDimension(item) === dimension,
    )
    const attempts = useCourseStore.getState().courseState.evidence.filter((item) => item.nodeId === nextNode.nodeId).length
    setActiveNodeId(nextNode.nodeId)
    setActiveDimension(dimension)
    const prepared = prepareCourseQuestions(matchedCandidates.length > 0 ? matchedCandidates : candidates, `${nextNode.nodeId}:${attempts}`)
    setQuestion(prepared[attempts % Math.max(prepared.length, 1)] ?? null)
    setSelectedIndex(null)
    setInputAnswer('')
    setAnswerCorrect(null)
    setQuestionStartedAt(Date.now())
  }

  const sortedMastery = [...courseState.mastery].sort((a, b) => a.confidence - b.confidence)
  const currentNode = activeNodeId ? courseNodeMap.get(activeNodeId) : undefined
  const interaction = question ? getCourseQuestionInteraction(question) : 'choice'

  return (
    <div className={`${styles.page} fadeIn`}>
      <header className={styles.header}>
        <div>
          <span className="chip badgeMint">动态复习</span>
          <h1 className="pageTitle">在快忘记的时候，重新找回来</h1>
          <p className="sectionIntro">复习时间由实际答题表现决定，不需要自己维护卡片和日期。</p>
        </div>
        <div className={styles.headerActions}>
          <Link className="softButton" to="/review"><RotateCcw size={18} />歌曲与词汇复习</Link>
          <Link className="softButton" to="/"><ArrowLeft size={18} />返回今日学习</Link>
        </div>
      </header>

      {question && currentNode ? (
        <section className={`${styles.reviewCard} glassCard`} data-testid="course-review-card">
          <div className={styles.reviewMeta}>
            <span>{masteryLabel(due.find((item) => item.nodeId === activeNodeId)?.state ?? 'reviewing')}</span>
            <small><Clock3 size={15} />已完成 {reviewedCount} 项</small>
          </div>
          <small>{currentNode.title}</small>
          {activeDimension ? <span className={styles.dimensionBadge}>{dimensionLabel(activeDimension)}</span> : null}
          {question.context ? <p className={styles.context}>{question.context}</p> : null}
          <h2>{question.prompt}</h2>
          {interaction === 'listening_choice' ? (
            <button className={styles.audioPrompt} type="button" onClick={() => speakJapanese(question.audioText ?? '')}>
              <Volume2 size={24} />播放声音
            </button>
          ) : null}
          {interaction === 'input' ? (
            <div className={styles.constructedAnswer}>
              <input
                autoFocus
                value={inputAnswer}
                disabled={answerCorrect !== null}
                onChange={(event) => setInputAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && inputAnswer.trim() && answerCorrect === null) void answer(inputAnswer)
                }}
                placeholder="输入罗马音，不区分大小写"
              />
              <button className="softButton primaryButton" disabled={!inputAnswer.trim() || answerCorrect !== null} onClick={() => void answer(inputAnswer)}>检查答案</button>
            </div>
          ) : (
            <div className={styles.answerGrid}>
              {question.options.map((option, index) => {
                const correct = index === question.answerIndex
                const selected = index === selectedIndex
                return (
                  <button
                    key={option}
                    data-option-value={option}
                    disabled={answerCorrect !== null}
                    className={answerCorrect === null ? '' : correct ? styles.correct : selected ? styles.wrong : styles.muted}
                    onClick={() => {
                      setSelectedIndex(index)
                      void answer(index)
                    }}
                  >
                    <span>{String.fromCharCode(65 + index)}</span>
                    {option}
                    {answerCorrect !== null && correct ? <Check size={18} /> : null}
                    {answerCorrect !== null && selected && !correct ? <CircleX size={18} /> : null}
                  </button>
                )
              })}
            </div>
          )}
          {answerCorrect !== null ? (
            <footer className={answerCorrect ? styles.feedbackCorrect : styles.feedbackWrong}>
              <div>
                <strong>{answerCorrect ? '这次独立找回来了' : '这项会更早回来'}</strong>
                <p>{question.explanationZh}</p>
              </div>
              <button className="softButton primaryButton" onClick={continueReview}>
                {getDueCourseMastery(courseState).length > 0 ? '继续复习' : '完成'}<ArrowRight size={18} />
              </button>
            </footer>
          ) : null}
        </section>
      ) : (
        <section className={`${styles.emptyCard} glassCard`}>
          <div><ShieldCheck size={36} /></div>
          <span className="chip badgeMint">当前队列已清空</span>
          <h2>{reviewedCount > 0 ? '今天到期的内容已经处理完了' : '现在没有到期复习'}</h2>
          <p>系统会根据每项知识的稳定性自动安排下一次出现。继续主课，不需要为了打卡重复已经稳定的内容。</p>
          <Link className="softButton primaryButton" to="/">继续今日主课<ArrowRight size={18} /></Link>
        </section>
      )}

      <details className={styles.masterySection}>
        <summary>
          <div><BrainCircuit size={22} /><h2>掌握状态</h2></div>
          <span>{sortedMastery.length} 个知识节点</span>
        </summary>
        {sortedMastery.length > 0 ? (
          <div className={styles.masteryGrid}>
            {sortedMastery.map((item) => {
              const node = courseNodeMap.get(item.nodeId)
              return (
                <article key={item.nodeId} className="glassCard">
                  <div>
                    <strong>{node?.title ?? item.nodeId}</strong>
                    <span>{masteryLabel(item.state)}</span>
                  </div>
                  <p>{node?.meaningZh}</p>
                  <div className={styles.confidenceBar}><i style={{ width: `${item.confidence * 100}%` }} /></div>
                  <small>掌握证据 {Math.round(item.confidence * 100)}%</small>
                </article>
              )
            })}
          </div>
        ) : (
          <div className={`${styles.noMastery} glassCard`}>
            <RotateCcw size={24} />
            <p>完成第一课检测后，这里会出现真实掌握状态。</p>
          </div>
        )}
      </details>
    </div>
  )
}
