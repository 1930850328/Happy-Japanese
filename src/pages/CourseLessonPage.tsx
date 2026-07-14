import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Check,
  CheckCircle2,
  CircleX,
  Clock3,
  Headphones,
  Lightbulb,
  RotateCcw,
  Sparkles,
  Volume2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { courseLessonMap, courseLessons, courseNodeMap } from '../data/courseCatalog'
import { COURSE_POLICY, getLessonProgress, isLessonAvailable, prepareCourseQuestions, type CourseAnswerResult } from '../lib/courseEngine'
import { speakJapanese } from '../lib/speech'
import { useCourseStore } from '../store/useCourseStore'
import styles from './CourseLessonPage.module.css'

type LessonPhase = 'learn' | 'practice' | 'result'

export function CourseLessonPage() {
  const { lessonId = '' } = useParams()
  const lesson = courseLessonMap.get(lessonId)
  const initialized = useCourseStore((state) => state.initialized)
  const courseState = useCourseStore((state) => state.courseState)
  const initialize = useCourseStore((state) => state.initialize)
  const saveLessonAttempt = useCourseStore((state) => state.saveLessonAttempt)

  const [phase, setPhase] = useState<LessonPhase>('learn')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [answers, setAnswers] = useState<CourseAnswerResult[]>([])
  const [questionStartedAt, setQuestionStartedAt] = useState(() => Date.now())
  const [resultScore, setResultScore] = useState(0)
  const [passed, setPassed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [attemptNumber, setAttemptNumber] = useState(existingAttemptNumber(courseState, lessonId))
  const [showReading, setShowReading] = useState(true)
  const [recallAnswer, setRecallAnswer] = useState('')
  const [recallChecked, setRecallChecked] = useState(false)
  const [recallRevealed, setRecallRevealed] = useState(false)
  const [recallSelfReported, setRecallSelfReported] = useState(false)

  useEffect(() => {
    void initialize()
  }, [initialize])

  const preparedQuestions = useMemo(
    () => lesson ? prepareCourseQuestions(lesson.questions, `${lesson.id}:${attemptNumber}`) : [],
    [attemptNumber, lesson],
  )
  const currentQuestion = preparedQuestions[questionIndex]
  const existingProgress = lesson ? getLessonProgress(courseState, lesson.id) : undefined
  const nextLesson = lesson ? courseLessons.find((item) => item.order > lesson.order) : undefined
  const nodes = useMemo(
    () => lesson?.nodeIds.map((nodeId) => courseNodeMap.get(nodeId)).filter(Boolean) ?? [],
    [lesson],
  )
  const isKanaLesson = nodes.some((node) => node?.kind === 'kana')
  const recallExample = lesson?.examples[0]
  const expectedRecallAnswer = recallExample ? (isKanaLesson ? recallExample.reading : recallExample.ja) : ''
  const recallSucceeded = recallChecked && normalizeRecall(recallAnswer) === normalizeRecall(expectedRecallAnswer)
  const recallCompleted = recallSucceeded || recallSelfReported

  useEffect(() => {
    setPhase('learn')
    setQuestionIndex(0)
    setSelectedIndex(null)
    setAnswers([])
    setResultScore(0)
    setPassed(false)
    setSaving(false)
    setAttemptNumber(existingAttemptNumber(useCourseStore.getState().courseState, lessonId))
    setShowReading(true)
    setRecallAnswer('')
    setRecallChecked(false)
    setRecallRevealed(false)
    setRecallSelfReported(false)
    setQuestionStartedAt(Date.now())
  }, [lessonId])

  if (!lesson) return <Navigate replace to="/" />
  if (!initialized) {
    return <div className={`${styles.loading} glassCard`}>正在打开课程…</div>
  }
  if (!courseState.profile) return <Navigate replace to="/" />
  if (!isLessonAvailable(courseState, lesson.id)) return <Navigate replace to="/" />

  const chooseAnswer = (optionIndex: number) => {
    if (selectedIndex !== null || !currentQuestion) return
    setSelectedIndex(optionIndex)
    setAnswers((items) => [
      ...items,
      {
        questionId: currentQuestion.id,
        nodeId: currentQuestion.nodeId,
        correct: optionIndex === currentQuestion.answerIndex,
        elapsedMs: Math.max(300, Date.now() - questionStartedAt),
      },
    ])
  }

  const advanceQuestion = async () => {
    if (questionIndex < preparedQuestions.length - 1) {
      setQuestionIndex((index) => index + 1)
      setSelectedIndex(null)
      setQuestionStartedAt(Date.now())
      return
    }

    setSaving(true)
    const score = answers.filter((answer) => answer.correct).length / preparedQuestions.length
    const next = await saveLessonAttempt(lesson.id, answers)
    const progress = getLessonProgress(next, lesson.id)
    setResultScore(score)
    setPassed(progress?.status === 'completed')
    setSaving(false)
    setPhase('result')
  }

  const retry = () => {
    setPhase('learn')
    setAttemptNumber((number) => number + 1)
    setQuestionIndex(0)
    setSelectedIndex(null)
    setAnswers([])
    setQuestionStartedAt(Date.now())
  }

  return (
    <div className={`${styles.page} fadeIn`}>
      <header className={styles.topBar}>
        <Link to="/" className="softButton" aria-label="返回学习首页"><ArrowLeft size={18} />返回路径</Link>
        <div className={styles.lessonMeta}>
          <span>{lesson.level === 'foundation' ? '入门' : lesson.level}</span>
          <small><Clock3 size={14} />约 {lesson.durationMinutes} 分钟</small>
        </div>
      </header>

      {phase === 'learn' ? (
        <>
          <section className={styles.lessonHero}>
            <div>
              <span className="chip badgeMint">第 {lesson.order} 单元</span>
              <h1>{lesson.title}</h1>
              <p>{lesson.description}</p>
            </div>
            <div className={`${styles.canDoCard} glassCard`}>
              <TargetIcon />
              <small>完成后你能够</small>
              <strong>{lesson.canDo}</strong>
            </div>
          </section>

          <section className={styles.learningLayout}>
            <div className={styles.mainColumn}>
              <section className={`${styles.contentCard} glassCard`}>
                <header><Lightbulb size={23} /><h2>先理解规则</h2></header>
                <div className={styles.explanationList}>
                  {lesson.explanation.map((item, index) => (
                    <article key={item}>
                      <span>{index + 1}</span>
                      <p>{item}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className={`${styles.contentCard} glassCard`}>
                <header>
                  <div className={styles.contentHeading}>
                    <BookOpenCheck size={23} />
                    <h2>{isKanaLesson ? '从声音到词语' : '放进句子里'}</h2>
                  </div>
                  {isKanaLesson ? (
                    <button className={styles.readingToggle} type="button" onClick={() => setShowReading((visible) => !visible)}>
                      {showReading ? '隐藏读音，自己回忆' : '显示读音'}
                    </button>
                  ) : null}
                </header>
                <div className={styles.exampleList}>
                  {lesson.examples.map((example) => (
                    <article key={example.ja}>
                      <button onClick={() => speakJapanese(example.ja)} aria-label={`朗读 ${example.ja}`}>
                        <Volume2 size={18} />
                      </button>
                      <div>
                        <strong>{example.ja}</strong>
                        <span className={!showReading && isKanaLesson ? styles.hiddenReading : ''}>
                          {!showReading && isKanaLesson ? '读音已隐藏' : example.reading}
                        </span>
                        <p>{!showReading && isKanaLesson ? '先自己读，再点左侧朗读核对。' : example.zh}</p>
                        {example.note ? <small>{example.note}</small> : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <aside className={styles.nodeColumn}>
              {nodes.map((node) => node ? (
                <article key={node.id} className={`${styles.nodeCard} glassCard`}>
                  <span>{node.kind === 'grammar' ? '语法' : node.kind === 'kana' ? '文字' : node.kind === 'reading' ? '阅读' : node.kind === 'listening' ? '听力' : '知识'}</span>
                  <h3>{node.title}</h3>
                  {node.reading ? <small>{node.reading}</small> : null}
                  <strong>{node.meaningZh}</strong>
                  <p>{node.explanationZh}</p>
                </article>
              ) : null)}
            </aside>
          </section>

          <section className={`${styles.startPractice} glassCard`}>
            <div>
              <Sparkles size={25} />
              <div>
                <strong>先自己找回来一次</strong>
                <p>
                  {isKanaLesson
                    ? `不看读音，输入「${recallExample?.ja ?? ''}」的罗马音。`
                    : `不用复制上面的例句，用日语输入：“${recallExample?.zh ?? ''}”`}
                </p>
                <label className={styles.recallInput}>
                  <span>{isKanaLesson ? '你的读音' : '你的日语句子'}</span>
                  <input
                    value={recallAnswer}
                    onChange={(event) => {
                      setRecallAnswer(event.target.value)
                      setRecallChecked(false)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && recallAnswer.trim()) setRecallChecked(true)
                    }}
                    placeholder={isKanaLesson ? '输入罗马音' : '在这里输入日语'}
                  />
                </label>
                <div className={styles.recallActions}>
                  <button type="button" className="softButton" disabled={!recallAnswer.trim()} onClick={() => setRecallChecked(true)}>
                    检查回答
                  </button>
                  <button type="button" className={styles.revealButton} onClick={() => setRecallRevealed(true)}>
                    显示答案并跟读
                  </button>
                </div>
                {recallChecked ? (
                  <p className={recallSucceeded ? styles.recallSuccess : styles.recallRetry} role="status">
                    {recallSucceeded ? '找回来了。接下来用新题确认。' : '还差一点，再听一次或查看参考答案后重新输入。'}
                  </p>
                ) : null}
                {recallRevealed ? (
                  <div className={styles.recallReference}>
                    <p>参考答案：<strong>{expectedRecallAnswer}</strong>。先跟读，再遮住答案自己说一遍。</p>
                    <button type="button" className="softButton" onClick={() => setRecallSelfReported(true)}>
                      {recallSelfReported ? '已完成口头回忆' : '我已经遮住答案说了一遍'}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            <button
              className="softButton primaryButton"
              disabled={!recallCompleted}
              onClick={() => {
                setPhase('practice')
                setQuestionStartedAt(Date.now())
              }}
            >
              {recallCompleted ? '开始检测' : '先完成主动回忆'}<ArrowRight size={18} />
            </button>
          </section>
        </>
      ) : null}

      {phase === 'practice' && currentQuestion ? (
        <section className={`${styles.practiceCard} glassCard`} data-testid="course-practice">
          <header>
            <div>
              <span className="chip badgePeach">掌握检测</span>
              <small>{questionIndex + 1}/{preparedQuestions.length}</small>
            </div>
            <div className={styles.practiceProgress}>
              <i style={{ width: `${((questionIndex + 1) / preparedQuestions.length) * 100}%` }} />
            </div>
          </header>

          <div className={styles.practiceBody}>
            <small>{currentQuestion.kind === 'comprehension' ? '理解题' : currentQuestion.kind === 'usage' ? '用法题' : currentQuestion.kind === 'reading' ? '读音题' : '含义题'}</small>
            {currentQuestion.context ? <p className={styles.context}>{currentQuestion.context}</p> : null}
            <h2>{currentQuestion.prompt}</h2>
            <div className={styles.answerGrid}>
              {currentQuestion.options.map((option, index) => {
                const selected = selectedIndex === index
                const correct = index === currentQuestion.answerIndex
                const revealedClass = selectedIndex === null
                  ? ''
                  : correct
                    ? styles.answerCorrect
                    : selected
                      ? styles.answerWrong
                      : styles.answerMuted
                return (
                  <button key={option} data-option-value={option} className={revealedClass} onClick={() => chooseAnswer(index)} disabled={selectedIndex !== null}>
                    <span>{String.fromCharCode(65 + index)}</span>
                    {option}
                    {selectedIndex !== null && correct ? <Check size={18} /> : null}
                    {selectedIndex !== null && selected && !correct ? <CircleX size={18} /> : null}
                  </button>
                )
              })}
            </div>
          </div>

          {selectedIndex !== null ? (
            <footer className={selectedIndex === currentQuestion.answerIndex ? styles.feedbackCorrect : styles.feedbackWrong}>
              <div>
                {selectedIndex === currentQuestion.answerIndex ? <CheckCircle2 size={23} /> : <Lightbulb size={23} />}
                <div>
                  <strong>{selectedIndex === currentQuestion.answerIndex ? '答对了' : '这里需要再建立一次连接'}</strong>
                  <p>{currentQuestion.explanationZh}</p>
                </div>
              </div>
              <button className="softButton primaryButton" disabled={saving} onClick={() => void advanceQuestion()}>
                {questionIndex < preparedQuestions.length - 1 ? '下一题' : saving ? '正在保存…' : '查看结果'}
                <ArrowRight size={18} />
              </button>
            </footer>
          ) : null}
        </section>
      ) : null}

      {phase === 'result' ? (
        <section className={`${styles.resultCard} glassCard`} data-testid="lesson-result">
          <div className={passed ? styles.resultIconPassed : styles.resultIconRetry}>
            {passed ? <CheckCircle2 size={38} /> : <RotateCcw size={36} />}
          </div>
          <span className="chip badgeMint">本次检测 {Math.round(resultScore * 100)}%</span>
          <h1>{passed ? '你已经完成本课' : '现在发现问题，正是复习的最好时机'}</h1>
          <p>
            {passed
              ? '这是第一次成功回忆，还不等于长期掌握。系统会在一段时间后重新检查，连续想起来才会逐步变成稳定能力。'
              : `本课通过线为 ${Math.round(COURSE_POLICY.lessonPassScore * 100)}%。回看规则后再练一次，错误知识会更早进入复习。`}
          </p>
          <div className={styles.resultActions}>
            {!passed ? <button className="softButton primaryButton" onClick={retry}><RotateCcw size={18} />回看讲解再练</button> : null}
            {passed && nextLesson ? <Link className="softButton primaryButton" to={`/learn/${nextLesson.id}`}>进入下一课<ArrowRight size={18} /></Link> : null}
            <Link className="softButton" to="/"><ArrowLeft size={18} />回到学习路径</Link>
            {lesson.songSearchTerms.length > 0 ? (
              <Link className="softButton" to={`/songs?focus=${encodeURIComponent(lesson.songSearchTerms[0])}`}>
                <Headphones size={18} />用歌曲巩固（可选）
              </Link>
            ) : null}
          </div>
          <div className={styles.answerReview}>
            {preparedQuestions.map((question) => {
              const answer = answers.find((item) => item.questionId === question.id)
              return (
                <article key={question.id} className={answer?.correct ? styles.reviewCorrect : styles.reviewWrong}>
                  <span>{answer?.correct ? <Check size={17} /> : <CircleX size={17} />}</span>
                  <div>
                    <strong>{question.prompt}</strong>
                    <p>正确答案：{question.options[question.answerIndex]}。{question.explanationZh}</p>
                  </div>
                </article>
              )
            })}
          </div>
          {existingProgress?.attempts ? <small>本课累计练习 {existingProgress.attempts} 次</small> : null}
        </section>
      ) : null}
    </div>
  )
}

function existingAttemptNumber(state: ReturnType<typeof useCourseStore.getState>['courseState'], lessonId: string) {
  return getLessonProgress(state, lessonId)?.attempts ?? 0
}

function normalizeRecall(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s。！？、,.!?]/g, '')
}

function TargetIcon() {
  return <div className={styles.targetIcon}><BookOpenCheck size={25} /></div>
}
