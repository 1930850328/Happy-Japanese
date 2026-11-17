import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock3, List, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { LessonMarkdown } from '../components/readingCourse/LessonMarkdown'
import { readingCourse, readingCourseVersion } from '../data/readingCourse'
import { useCourseStore } from '../store/useCourseStore'
import styles from './ReadingCourse.module.css'

export function ReadingLessonPage() {
  const { day } = useParams()
  const lesson = readingCourse.find((item) => String(item.day) === day)
  const initialized = useCourseStore((state) => state.initialized)
  if (!lesson) return <div className={styles.empty}><h1>没有找到这一天的课程</h1><Link to="/">返回21天课程</Link></div>
  if (!initialized) return <div className={styles.loading}>正在读取学习进度…</div>
  return <Lesson key={lesson.day} lesson={lesson} />
}

function Lesson({ lesson }: { lesson: typeof readingCourse[number] }) {
  const stored = useCourseStore((state) => state.courseState.readingCourse)
  const save = useCourseStore((state) => state.saveReadingCourse)
  const progress = stored?.version === readingCourseVersion ? stored : undefined
  const savedLesson = progress?.lessons[lesson.day]
  const [section, setSection] = useState(Math.min(savedLesson?.section ?? 0, lesson.sections.length - 1))
  const [saving, setSaving] = useState(false)
  const [finished, setFinished] = useState(false)
  const completedSections = savedLesson?.completedSections ?? []
  const current = lesson.sections[section]
  const isLast = section === lesson.sections.length - 1

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [section, finished])

  async function move(nextSection: number, complete = false) {
    if (saving) return
    setSaving(true)
    const completed = complete ? [...new Set([...completedSections, section])] : completedSections
    const allDone = completed.length === lesson.sections.length
    const lessons = {
      ...progress?.lessons,
      [lesson.day]: {
        section: nextSection,
        completedSections: completed,
        ...(savedLesson?.completedAt || allDone ? { completedAt: savedLesson?.completedAt ?? new Date().toISOString() } : {}),
      },
    }
    const nextDay = complete && isLast && allDone
      ? readingCourse.find((item) => !lessons[item.day]?.completedAt)?.day ?? lesson.day
      : lesson.day
    try {
      await save({ version: readingCourseVersion, activeDay: nextDay, lessons })
      setSection(nextSection)
      if (complete && isLast && allDone) setFinished(true)
    } catch {
      toast.error('进度没有保存成功，请再试一次。')
    } finally { setSaving(false) }
  }

  const nextUnread = lesson.sections.findIndex((_, index) => !completedSections.includes(index) && index !== section)
  const nextSection = isLast ? Math.max(0, nextUnread) : section + 1
  return <div className={styles.page}>
    <header className={styles.lessonTop}><Link to="/"><ArrowLeft size={16} /> 学习路线</Link><span><Clock3 size={15} /> 今天最多 60 分钟，包含复习与休息</span></header>
    <div className={styles.lessonHeading}><span className={styles.eyebrow}>DAY {String(lesson.day).padStart(2, '0')} / 21</span><h1>{lesson.title}</h1><p>先自己想一想，再展开核对。随时可以停下，下次从这里继续。</p></div>
    {finished ? <section className={styles.finish}>
      <CheckCircle2 size={44} /><span className={styles.eyebrow}>第 {lesson.day} 天 · 学习已记录</span><h2>{lesson.day === 21 ? '走完这段路，继续读下去。' : '今天就到这里。'}</h2><p>已经保存本课进度。留一点时间休息，让学过的内容慢慢沉淀。</p>
      <div className={styles.finishActions}><Link className={styles.primary} to="/">回到学习路线 <ArrowRight size={16} /></Link><button className={styles.secondary} onClick={() => setFinished(false)}>回看这一课</button></div>
    </section> : <div className={styles.lessonLayout}>
      <aside className={styles.lessonOutline}><div className={styles.outlineLabel}><List size={16} /> 本课内容 <span>{completedSections.length}/{lesson.sections.length}</span></div>
        <nav aria-label="本课步骤">{lesson.sections.map((item, index) => <button key={index} disabled={saving} aria-current={section === index ? 'step' : undefined} className={section === index ? styles.currentStep : ''} onClick={() => void move(index)}>
          <span>{completedSections.includes(index) ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</span>{item.title}
        </button>)}</nav>
        <p>每一步都可以回看。<br />完成记录不等于掌握程度。</p>
      </aside>
      <div className={styles.lessonBody}>
        <article className={styles.lessonPaper} key={section}>
          <div className={styles.paperMeta}><span>STEP {String(section + 1).padStart(2, '0')}</span><span>{section + 1} / {lesson.sections.length}</span></div>
          <h2>{current.title}</h2>
          <LessonMarkdown>{current.body}</LessonMarkdown>
          {section === 0 && lesson.review.length > 0 && <section id="daily-review" className={styles.dailyReview}>
            <h3><RotateCcw size={18} /> 今天的词形回想 <small>{lesson.review.length} 个</small></h3>
            <p>先看日文，在心里回想意思，再点击核对。计入今天的复习时间，时间到了就结束。</p>
            <div className={styles.reviewGrid}>{lesson.review.map((word) => <details key={`${word.form}-${word.reading}`}><summary lang="ja">{word.form}</summary><span lang="ja">{word.reading}</span><p>{word.gloss}</p></details>)}</div>
            {lesson.day >= 4 && lesson.day <= 10 && <p>假名回认：从<Link to="/course/1">平假名字表</Link>和<Link to="/course/2">片假名字表</Link>各找 5 个字，包含在今日复习时间内。</p>}
          </section>}
        </article>
        <div className={styles.lessonActions}>
          <button className={styles.secondary} disabled={section === 0 || saving} onClick={() => void move(section - 1)}><ArrowLeft size={16} /> 上一步</button>
          <button className={styles.primary} disabled={saving} onClick={() => void move(nextSection, true)}>{saving ? '正在保存…' : isLast && nextUnread === -1 ? '完成今天的学习' : isLast ? '继续未完成的步骤' : '完成这一步，继续'} <ArrowRight size={16} /></button>
        </div>
        <p className={styles.saveHint}>进度随步骤保存。今天学满 60 分钟即可暂停，不需要赶完。</p>
      </div>
    </div>}
  </div>
}
