import {
  ArrowRight,
  BookOpenCheck,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  LockKeyhole,
  Map,
  RotateCcw,
  Sparkles,
  Target,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { courseLessonMap, courseLessons, courseStages, placementQuestions } from '../data/courseCatalog'
import {
  getCourseCompletion,
  getDueCourseMastery,
  getLessonProgress,
  isLessonAvailable,
  prepareCourseQuestions,
  type CourseAnswerResult,
} from '../lib/courseEngine'
import { getLiteracyReadiness } from '../lib/literacyEngine'
import { useCourseStore } from '../store/useCourseStore'
import styles from './LearnPage.module.css'

function getStageProgress(stageId: string, state: ReturnType<typeof useCourseStore.getState>['courseState']) {
  const lessons = courseLessons.filter((lesson) => lesson.level === stageId)
  const completed = lessons.filter((lesson) => {
    const progress = getLessonProgress(state, lesson.id)
    return progress?.status === 'completed' || progress?.status === 'placed'
  }).length
  return { completed, total: lessons.length }
}

export function LearnPage() {
  const initialized = useCourseStore((state) => state.initialized)
  const initializing = useCourseStore((state) => state.initializing)
  const courseState = useCourseStore((state) => state.courseState)
  const initialize = useCourseStore((state) => state.initialize)
  const startFromBeginning = useCourseStore((state) => state.startFromBeginning)
  const finishPlacement = useCourseStore((state) => state.finishPlacement)

  const [showPlacement, setShowPlacement] = useState(false)
  const [placementIndex, setPlacementIndex] = useState(0)
  const [placementAnswers, setPlacementAnswers] = useState<CourseAnswerResult[]>([])
  const [questionStartedAt, setQuestionStartedAt] = useState(() => Date.now())
  const [placementSeed] = useState(() => crypto.randomUUID())
  const [expandedStageId, setExpandedStageId] = useState('foundation')

  const preparedPlacementQuestions = useMemo(
    () => prepareCourseQuestions(placementQuestions, placementSeed, false),
    [placementSeed],
  )

  useEffect(() => {
    void initialize()
  }, [initialize])

  const completion = useMemo(() => getCourseCompletion(courseState), [courseState])
  const dueMastery = useMemo(() => getDueCourseMastery(courseState), [courseState])
  const activeLesson = courseState.profile
    ? courseLessonMap.get(courseState.profile.activeLessonId)
    : undefined
  const literacyLevel = activeLesson?.level ?? 'foundation'
  const literacyReadiness = useMemo(
    () => getLiteracyReadiness(courseState, literacyLevel),
    [courseState, literacyLevel],
  )
  const weakestDimension = [...literacyReadiness.dimensions]
    .filter((item) => item.target > 0)
    .sort((left, right) => (left.value / left.target) - (right.value / right.target))[0]
  const activeLessonProgress = activeLesson ? getLessonProgress(courseState, activeLesson.id) : undefined
  const awaitingStageReadiness = activeLessonProgress?.status === 'completed' && !literacyReadiness.ready
  const fullPathComplete = completion.ratio >= 1 && literacyReadiness.ready
  const activeStage = courseStages.find((stage) => stage.id === literacyLevel)

  useEffect(() => {
    if (activeLesson) setExpandedStageId(activeLesson.level)
  }, [activeLesson?.id, activeLesson?.level])

  const answerPlacement = async (optionIndex: number) => {
    const question = preparedPlacementQuestions[placementIndex]
    const nextAnswers = [
      ...placementAnswers,
      {
        questionId: question.id,
        nodeId: question.nodeId,
        correct: optionIndex === question.answerIndex,
        elapsedMs: Math.max(300, Date.now() - questionStartedAt),
      },
    ]

    if (placementIndex >= preparedPlacementQuestions.length - 1) {
      await finishPlacement(nextAnswers)
      setShowPlacement(false)
      return
    }

    setPlacementAnswers(nextAnswers)
    setPlacementIndex((index) => index + 1)
    setQuestionStartedAt(Date.now())
  }

  if (!initialized || initializing) {
    return (
      <div className={`${styles.page} fadeIn`}>
        <section className={`${styles.loadingCard} glassCard`}>
          <Sparkles size={24} />
          <strong>正在整理你的学习路径…</strong>
        </section>
      </div>
    )
  }

  if (!courseState.profile) {
    const placementQuestion = preparedPlacementQuestions[placementIndex]
    return (
      <div className={`${styles.page} fadeIn`}>
        {showPlacement ? (
          <section className={`${styles.placementCard} glassCard`} data-testid="placement-panel">
            <header className={styles.placementHeader}>
              <div>
                <span className="chip badgeMint">快速定位</span>
                <h1>不用猜水平，做几道题就开始</h1>
              </div>
              <strong>{placementIndex + 1}/{preparedPlacementQuestions.length}</strong>
            </header>
            <div className={styles.placementProgress}>
              <div style={{ width: `${((placementIndex + 1) / preparedPlacementQuestions.length) * 100}%` }} />
            </div>
            <div className={styles.questionBlock}>
              <small>请选择最准确的答案</small>
              <h2>{placementQuestion.prompt}</h2>
              {placementQuestion.context ? <p>{placementQuestion.context}</p> : null}
              <div className={styles.optionGrid}>
                {placementQuestion.options.map((option, index) => (
                  <button key={option} data-option-value={option} onClick={() => void answerPlacement(index)}>
                    <span>{String.fromCharCode(65 + index)}</span>
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className={styles.welcomeHero}>
              <div className={styles.welcomeCopy}>
                <span className="chip badgeMint">从今天开始，系统带你学</span>
                <h1>不再收藏知识，<br />开始真正掌握日语</h1>
                <p>
                  每天只有一条清晰路径：学习新知识、在真实句子里使用、完成检测，
                  然后由系统在你快忘记时安排复习。
                </p>
                <div className={styles.welcomeActions}>
                  <button className="softButton primaryButton" onClick={() => void startFromBeginning()}>
                    我从零开始
                    <ArrowRight size={18} />
                  </button>
                  <button
                    className="softButton secondaryButton"
                    onClick={() => {
                      setShowPlacement(true)
                      setQuestionStartedAt(Date.now())
                    }}
                  >
                    我学过，先定位水平
                    <Target size={18} />
                  </button>
                </div>
                <small>目标：建立真实日语能力，并持续推进到 N1 准备水平</small>
              </div>
              <div className={`${styles.promiseCard} glassCard`}>
                <div className={styles.promiseIcon}><Map size={28} /></div>
                <h2>你不需要自己制定计划</h2>
                <ul>
                  <li><Check size={17} />系统决定今天最值得学什么</li>
                  <li><Check size={17} />答题结果决定何时再次出现</li>
                  <li><Check size={17} />每课都在新句子和短文中完成迁移</li>
                  <li><Check size={17} />所有进度都落在一张长期能力地图上</li>
                </ul>
              </div>
            </section>

            <section className={styles.routePreview}>
              {courseStages.map((stage, index) => (
                <article key={stage.id}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{stage.label}</strong>
                    <small>{stage.title}</small>
                  </div>
                  {index < courseStages.length - 1 ? <ChevronRight size={17} /> : null}
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    )
  }

  return (
    <div className={`${styles.page} fadeIn`}>
      <section className={styles.dashboardHero}>
        <div>
          <span className="chip badgeMint">今日学习</span>
          <h1 className="pageTitle">沿着一条路，今天再前进一步</h1>
          <p className="sectionIntro">
            先处理遗忘风险，再学主课、练配套知识、读一篇当前难度的短文。每一步都服务于可验证的阅读成果。
          </p>
        </div>
        <div className={`${styles.levelCard} glassCard`}>
          <small>目标路径</small>
          <strong>N1</strong>
          <span>{completion.completed}/{completion.total} 个核心单元已通过</span>
          <small>这是主干进度，不等于考试准备度</small>
          <div><i style={{ width: `${completion.ratio * 100}%` }} /></div>
        </div>
      </section>

      <section className={`${styles.dailyRoute} glassCard`} aria-label="今天按顺序完成">
        <header>
          <div>
            <span className="chip badgePeach">今天按这个顺序</span>
            <h2>不用自己拼计划，完成一条学习闭环</h2>
          </div>
          <strong>{activeStage?.label} · {activeStage?.title}</strong>
        </header>
        <div className={styles.dailySteps}>
          <Link to="/learn/review" className={dueMastery.length === 0 ? styles.stepDone : ''}>
            <span>{dueMastery.length === 0 ? <Check size={17} /> : '1'}</span>
            <div><strong>到期复习</strong><small>{dueMastery.length === 0 ? '今天已清空' : `${dueMastery.length} 项接近遗忘点`}</small></div>
          </Link>
          <Link to={activeLesson ? `/learn/${activeLesson.id}` : '/'} className={activeLessonProgress?.status === 'completed' ? styles.stepDone : ''}>
            <span>{activeLessonProgress?.status === 'completed' ? <Check size={17} /> : '2'}</span>
            <div><strong>当前主课</strong><small>{activeLesson?.title ?? '主课已完成'}</small></div>
          </Link>
          <Link to="/literacy">
            <span>3</span>
            <div><strong>配套知识训练</strong><small>只练已经解锁的词汇、汉字和语法</small></div>
          </Link>
          <Link to="/literacy">
            <span>4</span>
            <div><strong>短文迁移</strong><small>不用翻译证明今天真的读懂了</small></div>
          </Link>
        </div>
        <p><strong>本阶段成果：</strong>{activeStage?.canDo} <span>验收方式：{activeStage?.evidence}</span></p>
      </section>

      <section className={styles.todayGrid} aria-label="今日学习路径">
        <article className={`${styles.todayPrimary} glassCard`}>
          <div className={styles.stepMeta}>
            <span>主课程</span>
            <small><Clock3 size={15} />约 {activeLesson?.durationMinutes ?? 12} 分钟</small>
          </div>
          <div className={styles.stepIcon}><BookOpenCheck size={27} /></div>
          <h2>{fullPathComplete ? '完整学习路径已达标' : awaitingStageReadiness ? `完成 ${literacyLevel} 阶段能力` : activeLesson?.title ?? '课程已完成'}</h2>
          <p>{fullPathComplete ? '你已完成主课程并达到 N1 阶段的五项能力目标，可以继续用真实原文保持能力。' : awaitingStageReadiness ? `本阶段课程已经学完，但${weakestDimension?.label ?? '综合能力'}还没有达标。补齐真实能力后才会解锁下一阶段。` : activeLesson?.canDo ?? '你已经完成当前课程路径，可以继续巩固薄弱知识。'}</p>
          {activeLesson && !fullPathComplete ? (
            <Link className="softButton primaryButton" to={awaitingStageReadiness ? '/literacy' : `/learn/${activeLesson.id}`}>
              {awaitingStageReadiness ? '完成阶段能力训练' : activeLessonProgress?.status === 'in_progress' ? '继续本课' : '开始今天的主课'}
              <ArrowRight size={18} />
            </Link>
          ) : null}
        </article>

        <article className={`${styles.todayCard} glassCard`}>
          <div className={styles.stepIconSoft}><RotateCcw size={24} /></div>
          <small>动态复习</small>
          <strong>{dueMastery.length}</strong>
          <p>{dueMastery.length > 0 ? '项知识正在接近遗忘点' : '现在没有到期内容'}</p>
          <Link className="softButton" to="/learn/review">
            {dueMastery.length > 0 ? '先完成复习' : '查看掌握状态'}
          </Link>
        </article>

        <article className={`${styles.todayCard} glassCard`}>
          <div className={styles.stepIconSoft}><BrainCircuit size={24} /></div>
          <small>能力训练</small>
          <strong>{weakestDimension?.label ?? '综合训练'}</strong>
          <p>{weakestDimension ? `${weakestDimension.value}/${weakestDimension.target}，这是当前最需要补齐的一项` : '继续巩固词汇、汉字、语法与阅读'}</p>
          <Link className="softButton" to="/literacy">开始训练</Link>
        </article>
      </section>

      <section className={`${styles.readinessCard} glassCard`}>
        <header>
          <div>
            <span className="chip badgeMint">真实能力</span>
            <h2>{literacyLevel === 'foundation' ? '入门阶段' : literacyLevel} 毕业条件</h2>
          </div>
          <Link to="/literacy">查看训练详情 <ChevronRight size={17} /></Link>
        </header>
        <p>{activeStage?.canDo} 以下五项同时达到目标，才算能够稳定运用并进入下一阶段。</p>
        <div className={styles.readinessGrid}>
          {literacyReadiness.dimensions.map((item) => {
            const ratio = item.target === 0 ? 1 : Math.min(item.value / item.target, 1)
            return <article key={item.id}>
              <span>{item.label}</span>
              <strong>{item.value}/{item.target}{item.id === 'speed' ? ' 字/分' : ''}</strong>
              <i><b style={{ width: `${ratio * 100}%` }} /></i>
            </article>
          })}
        </div>
      </section>

      <section className={styles.pathSection}>
        <header>
          <div>
            <span className="chip badgePeach">长期路线</span>
            <h2>从入门到 N1 的课程地图</h2>
          </div>
          <p>每阶段都写明“能读懂什么”和“怎样证明”，通过检测才会推进，不用课数冒充能力。</p>
        </header>

        <div className={styles.stageList}>
          {courseStages.map((stage) => {
            const progress = getStageProgress(stage.id, courseState)
            const expanded = expandedStageId === stage.id
            return (
              <article key={stage.id} className={`${styles.stageCard} glassCard`}>
                <div className={styles.stageHeader}>
                  <div>
                    <span>{stage.label}</span>
                    <h3>{stage.title}</h3>
                    <p>{stage.description}</p>
                    <div className={styles.stageOutcome}><strong>完成后</strong><span>{stage.canDo}</span><small>验收：{stage.evidence}</small></div>
                  </div>
                  <div className={styles.stageActions}>
                    <strong>{progress.completed}/{progress.total}</strong>
                    <button type="button" aria-expanded={expanded} onClick={() => setExpandedStageId(expanded ? '' : stage.id)}>
                      {expanded ? '收起' : '查看课程'}
                    </button>
                  </div>
                </div>
                {expanded ? <div className={styles.lessonList}>
                  {stage.lessonIds.map((lessonId) => {
                    const item = courseLessonMap.get(lessonId)!
                    const itemProgress = getLessonProgress(courseState, lessonId)
                    const available = isLessonAvailable(courseState, lessonId)
                    const done = itemProgress?.status === 'completed' || itemProgress?.status === 'placed'
                    const content = (
                      <>
                        <span className={done ? styles.doneIcon : styles.lessonIcon}>
                          {done ? <CheckCircle2 size={18} /> : available ? <Circle size={18} /> : <LockKeyhole size={17} />}
                        </span>
                        <div>
                          <strong>{item.title}</strong>
                          <small>{item.canDo}</small>
                        </div>
                        <ChevronRight size={17} />
                      </>
                    )
                    return available ? (
                      <Link key={item.id} to={`/learn/${item.id}`} className={styles.lessonRow}>{content}</Link>
                    ) : (
                      <div key={item.id} className={`${styles.lessonRow} ${styles.lessonLocked}`}>{content}</div>
                    )
                  })}
                </div> : null}
              </article>
            )
          })}
        </div>
      </section>

      <section className={`${styles.evidenceCard} glassCard`}>
        <BrainCircuit size={25} />
        <div>
          <strong>系统不是按“看过”计算进度</strong>
          <p>当前已经记录 {courseState.evidence.length} 条答题证据，掌握度会随正确率、反应时间和延迟复习动态变化。</p>
        </div>
      </section>
    </div>
  )
}
