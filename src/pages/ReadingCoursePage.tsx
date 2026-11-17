import { ArrowRight, BookOpen, Check, Clock3, ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { readingCourse, readingCourseVersion, readingStages } from '../data/readingCourse'
import { useCourseStore } from '../store/useCourseStore'
import styles from './ReadingCourse.module.css'

export function ReadingCoursePage() {
  const initialized = useCourseStore((state) => state.initialized)
  const saved = useCourseStore((state) => state.courseState.readingCourse)
  const progress = saved?.version === readingCourseVersion ? saved : undefined
  const completed = readingCourse.filter((lesson) => progress?.lessons[lesson.day]?.completedAt).length
  const day = progress?.activeDay ?? 1
  const current = readingCourse.find((lesson) => lesson.day === day) ?? readingCourse[0]
  const started = Boolean(progress && Object.keys(progress.lessons).length)

  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <span className={styles.eyebrow}>你的日语阅读课</span>
      <span className={styles.headerNote}><BookOpen size={15} /> 从零开始 · 循序阅读</span>
    </header>
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className={styles.pill}>21 天 · 阅读入门</span>
        <h1>让日语，<br />成为看得懂的文字。</h1>
        <p>从平片假名开始，认识常用词，读懂句子的关系。<br className={styles.desktopBreak} />每天沿着一条清晰的路线，走进日语阅读。</p>
        <div className={styles.heroMeta}><span><Clock3 size={16} /> 每天最多 60 分钟</span><span>可暂停，随时接着学</span></div>
        {initialized ? <Link className={styles.primary} to={`/course/${current.day}`}>
          {completed === 21 ? '回看课程' : started ? `继续第 ${current.day} 天` : '开始第 1 天'} <ArrowRight size={18} />
        </Link> : <span className={styles.loading}>正在读取学习进度…</span>}
      </div>
      <div className={styles.heroArt} aria-hidden="true">
        <div className={styles.artLabel}>一字一句，读懂新的世界</div>
        <div className={styles.kanaLarge}>あ<span>ア</span></div>
        <div className={styles.artLine} />
        <div className={styles.artCaption}>はじめの一歩<small>从第一步开始</small></div>
        <span className={styles.artStamp}>読む</span>
      </div>
    </section>
    <section className={styles.progressStrip} aria-label="21天课程进度">
      <div><strong>{initialized ? completed : '—'}<small> / 21</small></strong><span>已完成的学习日</span></div>
      <div className={styles.progressTrack} role="progressbar" aria-label="课程完成进度" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={21}><span style={{ width: `${completed / 21 * 100}%` }} /></div>
      <p>{completed === 21 ? '课程已走完，回读时仍可以展开提示。' : `下一站：${current.title}`}</p>
    </section>
    <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>一步一步来</span><h2>你的 21 天学习路线</h2></div><span>复习 → 新知识 → 阅读 → 核对</span></div>
    <div className={styles.stages}>
      {readingStages.map((stage, index) => <section className={styles.stage} key={stage.from}>
        <div className={styles.stageHeader}><span className={styles.stageMark}>{stage.mark}</span><div><span className={styles.eyebrow}>阶段 {String(index + 1).padStart(2, '0')} · 第 {stage.from}–{stage.to} 天</span><h3>{stage.title}<small>{stage.subtitle}</small></h3><p>{stage.description}</p></div></div>
        <div className={styles.dayGrid}>{readingCourse.filter((lesson) => lesson.day >= stage.from && lesson.day <= stage.to).map((lesson) => {
          const done = Boolean(progress?.lessons[lesson.day]?.completedAt)
          const active = lesson.day === current.day && !done
          return <Link to={`/course/${lesson.day}`} key={lesson.day} className={`${styles.dayCard} ${active ? styles.dayActive : ''}`} aria-label={`第 ${lesson.day} 天：${lesson.title}${done ? '，已完成' : ''}`}>
            <span className={styles.dayNumber}>{String(lesson.day).padStart(2, '0')}</span>
            <div><strong>{lesson.title}</strong><small>{done ? '已完成 · 可以回看' : active ? '从这里继续' : lesson.day > 19 ? '综合阅读练习' : `${lesson.words.length} 个词形 · 配合短句学习`}</small></div>
            {done ? <Check size={18} className={styles.doneIcon} /> : <ArrowUpRight size={17} />}
          </Link>
        })}</div>
      </section>)}
    </div>
    <footer className={styles.courseFooter}><p>先打好阅读基础，再走进更长的原文。完成课程表示走完学习内容，不代表已经掌握所有日语。</p><Link to="/learn">更多分级练习 <ArrowUpRight size={14} /></Link></footer>
  </div>
}
