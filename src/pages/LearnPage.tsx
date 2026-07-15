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
  const primaryTask = dueMastery.length > 0
    ? {
        label: '先处理遗忘风险',
        title: `${dueMastery.length} 项知识到期了`,
        description: '先用一次主动回忆稳住已经学过的内容，再继续今天的主课程。',
        action: '开始复习',
        href: '/learn/review',
        meta: `${dueMastery.length} 项`,
        icon: RotateCcw,
      }
    : fullPathComplete
      ? {
          label: '保持真实能力',
          title: '完整学习路径已达标',
          description: '继续阅读真实原文并保持延迟复习，让已经掌握的能力稳定留下来。',
          action: '去读一篇原文',
          href: '/notes',
          meta: '长期保持',
          icon: CheckCircle2,
        }
      : awaitingStageReadiness
        ? {
            label: '补齐阶段能力',
            title: `${weakestDimension?.label ?? '综合能力'}还需要加强`,
            description: '本阶段课程已经学完，补齐这项真实能力后就会解锁下一阶段。',
            action: '开始能力训练',
            href: '/literacy',
            meta: `${weakestDimension?.value ?? 0}/${weakestDimension?.target ?? 0}`,
            icon: BrainCircuit,
          }
        : {
            label: activeLessonProgress?.status === 'in_progress' ? '继续主课程' : '今天的主课程',
            title: activeLesson?.title ?? '继续巩固当前阶段',
            description: activeLesson?.canDo ?? '继续练习已经解锁的知识，补齐当前阶段的能力。',
            action: activeLessonProgress?.status === 'in_progress' ? '继续本课' : '开始今天的主课',
            href: activeLesson ? `/learn/${activeLesson.id}` : '/literacy',
            meta: `约 ${activeLesson?.durationMinutes ?? 12} 分钟`,
            icon: BookOpenCheck,
          }
  const PrimaryTaskIcon = primaryTask.icon
  const weakestRatio = weakestDimension?.target
    ? Math.min(weakestDimension.value / weakestDimension.target, 1)
    : 1

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
      <header className={styles.learningHeader}>
        <div>
          <p>今日学习 · {activeStage?.label}</p>
          <h1>今天只专注下一步</h1>
        </div>
        <div className={styles.pathProgress} aria-label={`长期路径已完成 ${Math.round(completion.ratio * 100)}%`}>
          <span>{completion.completed}/{completion.total} 个核心单元</span>
          <i><b style={{ width: `${completion.ratio * 100}%` }} /></i>
        </div>
      </header>

      <section className={styles.focusPanel} aria-labelledby="primary-task-title">
        <div className={styles.focusIcon}><PrimaryTaskIcon size={28} /></div>
        <div className={styles.focusContent}>
          <div className={styles.focusMeta}>
            <span>{primaryTask.label}</span>
            <small><Clock3 size={15} />{primaryTask.meta}</small>
          </div>
          <h2 id="primary-task-title">{primaryTask.title}</h2>
          <p>{primaryTask.description}</p>
          <Link className="softButton primaryButton" to={primaryTask.href}>
            {primaryTask.action}
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      <section className={styles.routeSection} aria-labelledby="daily-route-title">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="daily-route-title">今天的学习闭环</h2>
            <p>按顺序完成即可，系统会根据你的结果安排下一次出现。</p>
          </div>
        </header>
        <div className={styles.routeSteps}>
          <Link
            to="/learn/review"
            className={`${styles.routeStep} ${dueMastery.length === 0 ? styles.routeStepDone : styles.routeStepCurrent}`}
          >
            <span>{dueMastery.length === 0 ? <Check size={17} /> : '1'}</span>
            <div><strong>到期复习</strong><small>{dueMastery.length === 0 ? '今天没有到期内容' : `${dueMastery.length} 项接近遗忘点`}</small></div>
            <ChevronRight size={17} />
          </Link>
          <Link
            to={activeLesson ? `/learn/${activeLesson.id}` : '/'}
            className={`${styles.routeStep} ${activeLessonProgress?.status === 'completed' ? styles.routeStepDone : dueMastery.length === 0 && !awaitingStageReadiness && !fullPathComplete ? styles.routeStepCurrent : ''}`}
          >
            <span>{activeLessonProgress?.status === 'completed' ? <Check size={17} /> : '2'}</span>
            <div><strong>当前主课</strong><small>{activeLesson?.title ?? '主课已完成'}</small></div>
            <ChevronRight size={17} />
          </Link>
          <Link
            to="/literacy"
            className={`${styles.routeStep} ${dueMastery.length === 0 && awaitingStageReadiness ? styles.routeStepCurrent : ''}`}
          >
            <span>3</span>
            <div><strong>能力训练</strong><small>只练已经解锁的词汇、汉字和语法</small></div>
            <ChevronRight size={17} />
          </Link>
          <Link to="/literacy" className={`${styles.routeStep} ${fullPathComplete ? styles.routeStepCurrent : ''}`}>
            <span>4</span>
            <div><strong>短文迁移</strong><small>不用翻译证明今天真的读懂了</small></div>
            <ChevronRight size={17} />
          </Link>
        </div>
      </section>

      <section className={styles.stageSection} aria-labelledby="stage-progress-title">
        <header className={styles.sectionHeader}>
          <div>
            <h2 id="stage-progress-title">当前阶段：{activeStage?.label} · {activeStage?.title}</h2>
            <p>{activeStage?.canDo}</p>
          </div>
          <Link to="/literacy">查看训练详情 <ChevronRight size={17} /></Link>
        </header>

        <div className={styles.weaknessRow}>
          <div>
            <span>当前最需要补齐</span>
            <strong>{weakestDimension?.label ?? '综合能力'}</strong>
          </div>
          <div className={styles.weaknessProgress}>
            <span>{weakestDimension?.value ?? 0}/{weakestDimension?.target ?? 0}{weakestDimension?.id === 'speed' ? ' 字/分' : ''}</span>
            <i><b style={{ width: `${weakestRatio * 100}%` }} /></i>
          </div>
        </div>

        <details className={styles.detailDisclosure}>
          <summary>
            <span>查看五项毕业条件</span>
            <small>通过全部能力目标后进入下一阶段</small>
          </summary>
          <div className={styles.readinessList}>
            {literacyReadiness.dimensions.map((item) => {
              const ratio = item.target === 0 ? 1 : Math.min(item.value / item.target, 1)
              return <div key={item.id} className={styles.readinessRow}>
                <span>{item.label}</span>
                <i><b style={{ width: `${ratio * 100}%` }} /></i>
                <strong>{item.value}/{item.target}{item.id === 'speed' ? ' 字/分' : ''}</strong>
              </div>
            })}
          </div>
        </details>
      </section>

      <details className={styles.pathDisclosure}>
        <summary>
          <div>
            <strong>从入门到 N1 的完整路线</strong>
            <small>查看各阶段课程、成果与验收方式</small>
          </div>
          <span>{completion.completed}/{completion.total}</span>
        </summary>
        <div className={styles.stageList}>
          {courseStages.map((stage) => {
            const progress = getStageProgress(stage.id, courseState)
            const expanded = expandedStageId === stage.id
            return (
              <article key={stage.id} className={styles.stageItem}>
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
      </details>

      <aside className={styles.evidenceNote}>
        <BrainCircuit size={22} />
        <div>
          <strong>进度来自真实掌握</strong>
          <p>已记录 {courseState.evidence.length} 条答题证据；正确率、反应时间和延迟复习会共同决定进度。</p>
        </div>
      </aside>
    </div>
  )
}
