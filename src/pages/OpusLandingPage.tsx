import '@fontsource/noto-serif-sc/600.css'
import '@fontsource/noto-serif-sc/900.css'
import '@fontsource/noto-serif-jp/500.css'
import '@fontsource/noto-serif-jp/700.css'

import { ArrowRight, ArrowUpRight, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import { readingCourse, readingCourseVersion, readingStages } from '../data/readingCourse'
import { useCourseStore } from '../store/useCourseStore'
import styles from './OpusLandingPage.module.css'

/* ------------------------------------------------------------------ */
/* Data                                                                 */
/* ------------------------------------------------------------------ */

interface Tok {
  t: string
  r?: string
  d?: number
  g?: string
}

// 第 20 天课上的「使用通知」。每个词的天数取自课程词表 inventory.json 的 first_day，
// 语法块取自对应课次（第 10 天转折、第 12 天请求与禁止、第 13 天可能、第 14 天时间条件）。
const NOTICE: { tokens: Tok[]; zh: string }[] = [
  {
    tokens: [
      { t: 'この', d: 4, g: '这个' },
      { t: '部屋', r: 'へや', d: 9, g: '房间' },
      { t: 'は', d: 4 },
      { t: '今週', r: 'こんしゅう', d: 16, g: '本周' },
      { t: 'の', d: 4 },
      { t: '日曜日', r: 'にちようび', d: 16, g: '星期日' },
      { t: 'まで', d: 16, g: '到……为止' },
      { t: '使', r: 'つか', d: 13 },
      { t: 'えます', d: 13, g: '可以使用' },
      { t: '。' },
    ],
    zh: '这个房间到本周日为止都可以使用。',
  },
  {
    tokens: [
      { t: '来週', r: 'らいしゅう', d: 16, g: '下周' },
      { t: 'は', d: 4 },
      { t: '使', r: 'つか', d: 13 },
      { t: 'えません', d: 13, g: '不能使用' },
      { t: '。' },
    ],
    zh: '下周不能使用。',
  },
  {
    tokens: [
      { t: '本', r: 'ほん', d: 4, g: '书' },
      { t: 'を', d: 5 },
      { t: '読', r: 'よ', d: 12 },
      { t: 'んでもいい', d: 12, g: '读也可以' },
      { t: 'ですが', d: 10, g: '……，但是' },
      { t: '、' },
      { t: 'ご飯', r: 'ごはん', d: 5, g: '饭' },
      { t: 'を', d: 5 },
      { t: '食', r: 'た', d: 12 },
      { t: 'べてはいけません', d: 12, g: '不许吃' },
      { t: '。' },
    ],
    zh: '可以看书，但不能吃东西。',
  },
  {
    tokens: [
      { t: '帰', r: 'かえ', d: 5 },
      { t: 'る', d: 5, g: '回去' },
      { t: '時', r: 'とき', d: 14, g: '……的时候' },
      { t: 'は', d: 4 },
      { t: '、' },
      { t: 'ドア', d: 8, g: '门' },
      { t: 'を', d: 5 },
      { t: '閉', r: 'し', d: 12 },
      { t: 'めてください', d: 12, g: '请关上' },
      { t: '。' },
    ],
    zh: '离开的时候，请把门关好。',
  },
  {
    tokens: [
      { t: '料金', r: 'りょうきん', d: 16, g: '费用' },
      { t: 'は', d: 4 },
      { t: '無料', r: 'むりょう', d: 16, g: '免费' },
      { t: 'です', d: 4 },
      { t: '。' },
    ],
    zh: '费用全免。',
  },
]

const KANJI = /[\u4e00-\u9faf]/u
const KATAKANA = /[\u30a0-\u30ff]/u

function soundDay(tok: Tok) {
  if (tok.d === undefined) return 0
  if (KANJI.test(tok.t)) return tok.d
  if (KATAKANA.test(tok.t)) return 2
  return 1
}

const NOTICE_TOTAL = NOTICE.flatMap((s) => s.tokens).reduce((n, tok) => n + (tok.d ? tok.t.length : 0), 0)

function readablePercent(day: number) {
  const known = NOTICE.flatMap((s) => s.tokens).reduce(
    (n, tok) => n + (tok.d && day >= tok.d ? tok.t.length : 0),
    0,
  )
  return Math.round((known / NOTICE_TOTAL) * 100)
}

function sentenceUnlockDay(tokens: Tok[]) {
  return Math.max(...tokens.map((tok) => tok.d ?? 0))
}

const LESSON_FLOW = [
  { key: 'recall', num: '一', label: '回想', min: 12, title: '先把学过的想起来', body: '遮住释义回想前几天的词形。学过的词会在之后第 2、4、8 天按时回来找你。' },
  { key: 'words', num: '二', label: '新词与短句', min: 18, title: '新词马上放回句子里', body: '每组几个词，看完就放进本课短句里认，不把整张表连续抄写。' },
  { key: 'grammar', num: '三', label: '句子关系', min: 12, title: '弄清谁做了什么', body: '只讲今天要用的那条规则：时间、肯否、谁对谁——读完整句才判断。' },
  { key: 'read', num: '四', label: '阅读与核对', min: 13, title: '自己读，再展开核对', body: '读一段原创短文，先写下你的判断，再打开「核对」看哪里读反了。' },
  { key: 'rest', num: '休', label: '休息', min: 5, title: '', body: '' },
] as const

const LYRIC_LINES = [
  { ja: ['朝', 'の', '駅', 'で', '　', '君', 'を', '待', 'つ'], rubies: { 朝: 'あさ', 駅: 'えき', 君: 'きみ', 待: 'ま' } as Record<string, string>, zh: '在清晨的车站等你' },
  { ja: ['少', 'し', 'だ', 'け', '　', '明', '日', 'が', '見', 'え', 'る'], rubies: { 少: 'すこ', 明: 'あ', 日: 'した', 見: 'み' } as Record<string, string>, zh: '好像能看见一点明天了' },
]

const LYRIC_STARTS = LYRIC_LINES.map((_, i) => LYRIC_LINES.slice(0, i).reduce((n, l) => n + l.ja.length, 0))

const LYRIC_WORDS = [
  { w: '朝', day: 6 },
  { w: '駅', day: 5 },
  { w: '待つ', day: 6 },
  { w: '少し', day: 6 },
  { w: '明日', day: 6 },
]

const FAQ = [
  {
    q: '完全零基础，可以直接开始吗？',
    a: '可以。第 1 天从平假名开始，学的第一个词是「あさ」（早晨）。每认识几个假名，就立刻放进真实的词里读，而不是先背完整张五十音表。',
  },
  {
    q: '每天要花多长时间？断了一天怎么办？',
    a: '每节课都有时间上限，最多 60 分钟，其中包括 5 分钟休息。进度只保存在你自己的浏览器里，隔几天回来，也能从上次停下的地方继续。',
  },
  {
    q: '需要注册或者付费吗？',
    a: '不需要。打开网页就能学，没有账号，也没有会员。',
  },
  {
    q: '21 天学完以后呢？',
    a: '去「拓展练习」做几道题定位水平，继续分级学习；也可以用歌曲和原文阅读，把学过的词放回真实语境里再见一次。',
  },
]

/* ------------------------------------------------------------------ */
/* Small pieces                                                         */
/* ------------------------------------------------------------------ */

function Hanko({ char, className, style }: { char: string; className?: string; style?: CSSProperties }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg className={className} style={style} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <filter id={`ink-${id}`} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.2" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      <g filter={`url(#ink-${id})`}>
        <rect x="7" y="7" width="86" height="86" rx="16" fill="currentColor" />
        <rect x="14" y="14" width="72" height="72" rx="11" fill="none" stroke="#fbf6ee" strokeWidth="2" opacity="0.55" />
        <text
          x="50"
          y="53"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="54"
          fontWeight="700"
          fill="#fbf6ee"
          style={{ fontFamily: "'Noto Serif JP', 'Hiragino Mincho ProN', serif" }}
        >
          {char}
        </text>
      </g>
    </svg>
  )
}

function useReveal(rootRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (!('IntersectionObserver' in window)) {
      nodes.forEach((n) => (n.dataset.shown = 'true'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            ;(entry.target as HTMLElement).dataset.shown = 'true'
            io.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
    nodes.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [rootRef])
}

function useInView<T extends HTMLElement>(options?: IntersectionObserverInit) {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), options)
    io.observe(node)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return [ref, inView] as const
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/* ------------------------------------------------------------------ */
/* Hero: the notice that becomes readable                               */
/* ------------------------------------------------------------------ */

function NoticeReader() {
  const [day, setDay] = useState(0)
  const [cardRef, inView] = useInView<HTMLDivElement>({ threshold: 0.35 })
  const playedRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  const play = () => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    if (prefersReducedMotion()) {
      setDay(21)
      return
    }
    let d = 0
    setDay(0)
    timerRef.current = window.setInterval(() => {
      d += 1
      setDay(d)
      if (d >= 21 && timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
    }, 150)
  }

  useEffect(() => {
    if (!inView || playedRef.current) return
    const t = window.setTimeout(() => {
      playedRef.current = true
      play()
    }, 500)
    return () => window.clearTimeout(t)
  }, [inView])

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current)
  }, [])

  const stopAuto = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const pct = readablePercent(day)
  const lesson = day > 0 ? readingCourse.find((l) => l.day === day) : undefined
  const fill = `${(day / 21) * 100}%`
  const complete = pct === 100

  return (
    <div className={styles.reader} ref={cardRef}>
      <div className={styles.paperWrap}>
        <span className={styles.tape} aria-hidden="true" />
        <article className={styles.paper} aria-label="第 20 天课上的一张使用通知">
          <header className={styles.paperHead}>
            <span>お知らせ</span>
          </header>
          <p className={styles.paperBody} lang="ja">
            {NOTICE.map((sentence, si) =>
              sentence.tokens.map((tok, ti) => {
                const key = `${si}-${ti}`
                if (tok.d === undefined) {
                  return (
                    <span key={key} className={day >= 1 ? styles.tSound : styles.tUnknown}>
                      {tok.t}
                    </span>
                  )
                }
                const known = day >= tok.d
                const sound = day >= soundDay(tok)
                const cls = known ? styles.tKnown : sound ? styles.tSound : styles.tUnknown
                if (tok.r) {
                  return (
                    <ruby key={key} className={cls} title={known ? tok.g : undefined}>
                      {tok.t}
                      <rt className={known ? styles.rtOn : styles.rtOff}>{tok.r}</rt>
                    </ruby>
                  )
                }
                return (
                  <span key={key} className={cls} title={known ? tok.g : undefined}>
                    {tok.t}
                  </span>
                )
              }),
            )}
          </p>
          <footer className={styles.paperFoot}>
            <span>第 20 天 · 阅读材料</span>
          </footer>
          <Hanko char="読" className={`${styles.paperStamp} ${complete ? styles.paperStampOn : ''}`} />
        </article>
      </div>

      <div className={styles.dial}>
        <div className={styles.dialTop}>
          <div className={styles.dialDay}>
            <span>第</span>
            <strong>{String(day).padStart(2, '0')}</strong>
            <span>天</span>
          </div>
          <div className={styles.dialPct} aria-live="polite">
            读懂 <strong>{pct}%</strong>
          </div>
        </div>

        <input
          className={styles.range}
          type="range"
          min={0}
          max={21}
          step={1}
          value={day}
          style={{ '--fill': fill } as CSSProperties}
          onChange={(e) => {
            stopAuto()
            setDay(Number(e.target.value))
          }}
          onPointerDown={stopAuto}
          aria-label="拖动选择学到第几天"
          aria-valuetext={`第 ${day} 天，读懂 ${pct}%`}
        />
        <div className={styles.rangeMarks} aria-hidden="true">
          {readingStages.map((stage) => (
            <span
              key={stage.from}
              className={day >= stage.from ? styles.markOn : ''}
              style={{ left: `calc(13px + (100% - 26px) * ${stage.from / 21})` }}
            >
              {stage.mark}
            </span>
          ))}
        </div>

        <p className={styles.dialCaption}>
          {day === 0
            ? '开课前：这张通知对你来说，只是一堆符号。'
            : day <= 3
              ? `第 ${day} 天 · ${lesson?.title}——假名能念出来了，意思还要再等等。`
              : complete && day < 20
                ? `第 ${day} 天 · 这张通知已经难不倒你了。`
                : `第 ${day} 天 · ${lesson?.title}`}
        </p>

        <ol className={styles.zhList}>
          {NOTICE.map((s) => {
            const unlock = sentenceUnlockDay(s.tokens)
            const open = day >= unlock
            return (
              <li key={s.zh} className={open ? styles.zhOpen : ''}>
                {open ? s.zh : <span className={styles.zhLocked}>第 {unlock} 天读懂这一句</span>}
              </li>
            )
          })}
        </ol>

        <div className={styles.dialFoot}>
          <div className={styles.legend} aria-hidden="true">
            <span><i className={styles.lgUnknown} />看不懂</span>
            <span><i className={styles.lgSound} />念得出</span>
            <span><i className={styles.lgKnown} />读懂了</span>
          </div>
          <button type="button" className={styles.replay} onClick={play}>
            <RotateCcw size={14} />
            重放
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Lesson flow                                                          */
/* ------------------------------------------------------------------ */

function LessonFlow() {
  const [active, setActive] = useState<string>('read')
  const [answer, setAnswer] = useState<'a' | 'b' | null>(null)

  return (
    <div className={styles.flow}>
      <div className={styles.flowBar} role="list" aria-label="第 6 天的 60 分钟安排">
        {LESSON_FLOW.map((step) => (
          <button
            key={step.key}
            type="button"
            role="listitem"
            className={`${styles.flowSeg} ${styles[`seg_${step.key}`]} ${active === step.key ? styles.flowSegActive : ''}`}
            style={{ flexGrow: step.min }}
            onClick={() => step.key !== 'rest' && setActive(step.key)}
            aria-label={`${step.label} ${step.min} 分钟`}
            disabled={step.key === 'rest'}
          >
            <span className={styles.flowSegMin}>{step.min}′</span>
          </button>
        ))}
      </div>
      <div className={styles.flowScale} aria-hidden="true">
        <span>0</span>
        <span>60 分钟</span>
      </div>

      <div className={styles.flowGrid}>
        <ol className={styles.steps}>
          {LESSON_FLOW.filter((s) => s.key !== 'rest').map((step) => (
            <li key={step.key}>
              <button
                type="button"
                className={`${styles.step} ${active === step.key ? styles.stepActive : ''}`}
                onClick={() => setActive(step.key)}
                aria-pressed={active === step.key}
              >
                <span className={`${styles.stepNum} ${styles[`num_${step.key}`]}`}>{step.num}</span>
                <span className={styles.stepText}>
                  <span className={styles.stepTitle}>
                    {step.title}
                    <small>{step.label} · {step.min} 分钟</small>
                  </span>
                  <span className={styles.stepBody}>{step.body}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div className={styles.quiz} data-reveal>
          <span className={styles.quizTag}>试一题 · 第 6 天开头</span>
          <p className={styles.quizQ}>哪一句是「不读书」？</p>
          <div className={styles.quizOptions}>
            {(
              [
                { k: 'a', ja: '本を読みます。' },
                { k: 'b', ja: '本を読みません。' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.k}
                type="button"
                lang="ja"
                className={`${styles.quizOpt} ${
                  answer === opt.k ? (opt.k === 'b' ? styles.quizRight : styles.quizWrong) : ''
                }`}
                onClick={() => setAnswer(opt.k)}
                aria-pressed={answer === opt.k}
              >
                {opt.ja}
              </button>
            ))}
          </div>
          <details className={styles.check} open={answer !== null}>
            <summary>核对</summary>
            <p>
              {answer === 'a' ? '再看一眼句尾。' : answer === 'b' ? '对。' : ''}
              后一句的「ません」是否定，意思是不读书。另外，「ます」不等于「正在」——过去形式今天就会补上。
            </p>
          </details>
          <p className={styles.quizNote}>先自己判断，再展开核对。课里的每个练习都是这样。</p>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 21-day calendar                                                      */
/* ------------------------------------------------------------------ */

function stageIndexOf(day: number) {
  return readingStages.findIndex((s) => day >= s.from && day <= s.to)
}

function CourseCalendar({ completed, activeDay }: { completed: Set<number>; activeDay: number }) {
  const [picked, setSelected] = useState<number | null>(null)
  const selected = picked ?? activeDay

  const lesson = readingCourse.find((l) => l.day === selected) ?? readingCourse[0]
  const stage = readingStages[stageIndexOf(selected)]
  const weeks = [0, 1, 2].map((w) => readingCourse.slice(w * 7, w * 7 + 7))

  return (
    <div className={styles.calendar}>
      <div className={styles.stageRow}>
        {readingStages.map((s, i) => (
          <div key={s.from} className={`${styles.stageChip} ${styles[`stage${i}`]}`}>
            <span className={styles.stageMark}>{s.mark}</span>
            <span>
              <strong>{s.title}</strong>
              <small>第 {s.from}–{s.to} 天</small>
            </span>
          </div>
        ))}
      </div>

      <div className={styles.weeks}>
        {weeks.map((week, wi) => (
          <div key={wi} className={styles.week}>
            <span className={styles.weekLabel}>第{['一', '二', '三'][wi]}周</span>
            <div className={styles.weekDays}>
              {week.map((l) => {
                const si = stageIndexOf(l.day)
                const done = completed.has(l.day)
                return (
                  <button
                    key={l.day}
                    type="button"
                    className={`${styles.dayCell} ${styles[`stage${si}`]} ${selected === l.day ? styles.daySelected : ''}`}
                    onClick={() => setSelected(l.day)}
                    aria-pressed={selected === l.day}
                    aria-label={`第 ${l.day} 天：${l.title}${done ? '（已完成）' : ''}`}
                  >
                    <span className={styles.dayNum}>{String(l.day).padStart(2, '0')}</span>
                    {done ? <Hanko char="済" className={styles.dayDone} /> : null}
                    {l.day === activeDay && !done ? <span className={styles.dayNow}>今天</span> : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.dayDetail} key={selected}>
        <div className={styles.dayDetailHead}>
          <span className={styles.dayDetailNum}>{String(selected).padStart(2, '0')}</span>
          <div>
            <span className={styles.dayDetailStage}>
              {stage.mark} · {stage.title} · {stage.subtitle}
            </span>
            <h3>{lesson.title}</h3>
          </div>
        </div>
        <p className={styles.dayDetailMeta}>
          {lesson.words.length > 0 ? `${lesson.words.length} 个新词形` : '不加新词，只用学过的'}
          <span>·</span>
          回想 {lesson.review.length} 个旧词
          <span>·</span>
          最多 60 分钟
        </p>
        <Link to={`/course/${selected}`} className={styles.textLink}>
          {completed.has(selected) ? '回看这一天' : '打开这一天'}
          <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Karaoke card                                                         */
/* ------------------------------------------------------------------ */

function KaraokeCard() {
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.3 })
  const [tick, setTick] = useState(0)
  const total = LYRIC_LINES.reduce((n, l) => n + l.ja.length, 0)

  useEffect(() => {
    if (!inView || prefersReducedMotion()) return
    const t = window.setInterval(() => setTick((v) => (v + 1) % (total + 6)), 260)
    return () => window.clearInterval(t)
  }, [inView, total])

  return (
    <div className={styles.karaoke} ref={ref}>
      {LYRIC_LINES.map((line, li) => {
        const start = LYRIC_STARTS[li]
        const lineActive = tick >= start && tick < start + line.ja.length
        return (
          <div key={line.zh} className={`${styles.kLine} ${lineActive ? styles.kLineOn : ''}`}>
            <p lang="ja" className={styles.kJa}>
              {line.ja.map((ch, i) => {
                const idx = start + i
                const cls = tick > idx ? styles.kSung : tick === idx ? styles.kNow : ''
                const rb = line.rubies[ch]
                return rb ? (
                  <ruby key={i} className={cls}>
                    {ch}
                    <rt>{rb}</rt>
                  </ruby>
                ) : (
                  <span key={i} className={cls}>{ch}</span>
                )
              })}
            </p>
            <p className={styles.kZh}>{line.zh}</p>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export function OpusLandingPage() {
  const pageRef = useRef<HTMLDivElement | null>(null)
  useReveal(pageRef)

  const initialized = useCourseStore((s) => s.initialized)
  const courseState = useCourseStore((s) => s.courseState)
  const initializeCourse = useCourseStore((s) => s.initialize)
  useEffect(() => {
    void initializeCourse()
  }, [initializeCourse])

  const [showReading, setShowReading] = useState(true)

  const progress = courseState.readingCourse?.version === readingCourseVersion ? courseState.readingCourse : undefined
  const completed = useMemo(
    () => new Set(readingCourse.filter((l) => progress?.lessons[l.day]?.completedAt).map((l) => l.day)),
    [progress],
  )
  const started = Boolean(progress && Object.keys(progress.lessons).length > 0)
  const activeDay = progress?.activeDay ?? 1
  const ctaLabel = completed.size === 21 ? '回看课程' : started ? `继续第 ${activeDay} 天` : '开始第 1 天'
  const ctaTo = `/course/${activeDay}`

  // Mobile sticky CTA: visible when neither hero CTA nor final CTA is on screen.
  const [heroCtaRef, heroCtaInView] = useInView<HTMLDivElement>()
  const [endCtaRef, endCtaInView] = useInView<HTMLDivElement>()
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 240)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const showDock = scrolled && !heroCtaInView && !endCtaInView

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const prevColor = meta?.content
    const prevTitle = document.title
    if (meta) meta.content = '#f4efe4'
    document.title = 'Happy Japanese · 三周，自己读懂一篇日语'
    return () => {
      if (meta && prevColor) meta.content = prevColor
      document.title = prevTitle
    }
  }, [])

  return (
    <div className={styles.page} ref={pageRef}>
      {/* ---------------- Nav ---------------- */}
      <header className={styles.nav}>
        <div className={`${styles.wrap} ${styles.navInner}`}>
          <Link to="/opus" className={styles.brand} aria-label="Happy Japanese 首页">
            <Hanko char="楽" className={styles.brandStamp} />
            <span className={styles.brandText}>
              <strong>Happy Japanese</strong>
              <small lang="ja">たのしい日本語</small>
            </span>
          </Link>
          <nav className={styles.navLinks} aria-label="页面导航">
            <a href="#lesson">一节课</a>
            <a href="#route">21 天路线</a>
            <a href="#more">课外阅读</a>
            <a href="#faq">常见问题</a>
          </nav>
          <Link to={ctaTo} className={styles.navCta}>
            {initialized ? ctaLabel : '开始学习'}
          </Link>
        </div>
      </header>

      <main>
        {/* ---------------- Hero ---------------- */}
        <section className={styles.hero}>
          <div className={`${styles.wrap} ${styles.heroGrid}`}>
            <div className={styles.heroCopy}>
              <p className={styles.kicker} lang="ja">
                <span className={styles.kickerLine} />
                21日間の日本語リーディング入門
              </p>
              <h1 className={styles.heroTitle}>
                三周后，
                <br />
                自己
                <em className={styles.brush}>
                  读懂
                  <svg viewBox="0 0 200 24" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M4 16 C 46 7, 118 5, 196 11" />
                  </svg>
                </em>
                一篇日语。
              </h1>
              <p className={styles.heroLead}>
                从平假名开始，每天不超过一小时：认词形、读句子、自己核对。
                第 21 天，你能独立读完一则留言、一份通知和一个小故事。
              </p>
              <div className={styles.heroActions} ref={heroCtaRef}>
                <Link to={ctaTo} className={styles.btnInk}>
                  {ctaLabel}
                  <ArrowRight size={18} />
                </Link>
                <a href="#route" className={styles.btnGhost}>
                  先看 21 天学什么
                </a>
              </div>
              <ul className={styles.heroFacts}>
                <li>免费</li>
                <li>不用注册</li>
                <li>进度只存在你的浏览器里</li>
              </ul>
            </div>

            <div className={styles.heroVisual}>
              <p className={styles.visualHint}>
                <span>↓</span> 拖一下：学到第几天，这张通知你能读懂多少
              </p>
              <NoticeReader />
            </div>
          </div>
          <p className={styles.verticalNote} lang="ja" aria-hidden="true">
            一字一句、読めるようになる。
          </p>
        </section>

        {/* ---------------- Lesson ---------------- */}
        <section id="lesson" className={`${styles.section} ${styles.sectionAlt}`}>
          <div className={styles.wrap}>
            <div className={styles.sectionHead} data-reveal>
              <p className={styles.eyebrow} lang="ja">一日のながれ</p>
              <h2>每天一节课，到点就停。</h2>
              <p>
                每节课都写好了时间上限，不留课后作业，也不用你自己排计划。下面是第 6 天的 60 分钟。
              </p>
            </div>
            <div data-reveal>
              <LessonFlow />
            </div>
          </div>
        </section>

        {/* ---------------- Route ---------------- */}
        <section id="route" className={styles.section}>
          <div className={styles.wrap}>
            <div className={styles.sectionHead} data-reveal>
              <p className={styles.eyebrow} lang="ja">二十一日のみちのり</p>
              <h2>三周，四个阶段，一天往前一小步。</h2>
              <p>每一天都建立在前一天上。点任意一天，看看那天学什么。</p>
            </div>
            <div data-reveal>
              <CourseCalendar completed={completed} activeDay={activeDay} />
            </div>
          </div>
        </section>

        {/* ---------------- More ---------------- */}
        <section id="more" className={`${styles.section} ${styles.sectionAlt}`}>
          <div className={styles.wrap}>
            <div className={styles.sectionHead} data-reveal>
              <p className={styles.eyebrow} lang="ja">もっと読む</p>
              <h2>学过的词，在歌和原文里再遇见。</h2>
              <p>课外的内容不是另起炉灶，而是让你在真实语境里，把课上的词再认一次。</p>
            </div>

            <div className={styles.moreGrid}>
              <article className={`${styles.moreCard} ${styles.moreSongs}`} data-reveal>
                <div className={styles.moreHead}>
                  <span className={styles.moreTag}>歌曲</span>
                  <h3>跟着节奏，一个字一个字地读歌词</h3>
                </div>
                <KaraokeCard />
                <div className={styles.lyricWords}>
                  <span>这两句里，课上学过的词：</span>
                  <div>
                    {LYRIC_WORDS.map((w) => (
                      <em key={w.w}>
                        <b lang="ja">{w.w}</b>第 {w.day} 天
                      </em>
                    ))}
                  </div>
                </div>
                <Link to="/songs" className={styles.moreLinkLight}>
                  去听歌 <ArrowUpRight size={15} />
                </Link>
              </article>

              <article className={styles.moreCard} data-reveal>
                <div className={styles.moreHead}>
                  <span className={styles.moreTag}>原文阅读</span>
                  <h3>看到想读的日语，贴进来</h3>
                </div>
                <div className={styles.paste}>
                  <div className={styles.pasteInput} lang="ja">
                    ご自由にお取りください
                  </div>
                  <div className={styles.pasteOut} lang="ja">
                    <span className={styles.pasteTok}>
                      <ruby>
                        ご自由に<rt className={showReading ? styles.rtOn : styles.rtOff}>ごじゆうに</rt>
                      </ruby>
                      <small>随意</small>
                    </span>
                    <span className={styles.pasteTok}>
                      <ruby>
                        お取り<rt className={showReading ? styles.rtOn : styles.rtOff}>おとり</rt>
                      </ruby>
                      <small>拿取</small>
                    </span>
                    <span className={styles.pasteTok}>
                      <ruby>
                        ください<rt className={styles.rtOff}>ください</rt>
                      </ruby>
                      <small>请</small>
                    </span>
                  </div>
                  <div className={styles.pasteFoot}>
                    <span>请随意取用。</span>
                    <button
                      type="button"
                      className={styles.switch}
                      role="switch"
                      aria-checked={showReading}
                      onClick={() => setShowReading((v) => !v)}
                    >
                      <i />
                      读音
                    </button>
                  </div>
                </div>
                <Link to="/notes" className={styles.moreLink}>
                  打开原文阅读 <ArrowUpRight size={15} />
                </Link>
              </article>

              <article className={styles.moreCard} data-reveal>
                <div className={styles.moreHead}>
                  <span className={styles.moreTag}>拓展练习</span>
                  <h3>不用猜水平，做几道题就开始</h3>
                </div>
                <p className={styles.moreBody}>
                  学完 21 天，或者以前零散学过一些？先做几道题定位起点，之后每天只给你下一步。
                </p>
                <ol className={styles.loop}>
                  <li>理解</li>
                  <li>辨认</li>
                  <li>回忆</li>
                  <li>复习</li>
                </ol>
                <Link to="/learn" className={styles.moreLink}>
                  去做定位 <ArrowUpRight size={15} />
                </Link>
              </article>
            </div>
          </div>
        </section>

        {/* ---------------- Promise ---------------- */}
        <section className={styles.promise}>
          <div className={styles.wrap}>
            <p className={styles.promiseJa} lang="ja" data-reveal>
              「
              <ruby>
                読<rt>よ</rt>
              </ruby>
              めた」を、ひとつずつ。
            </p>
            <p className={styles.promiseZh} data-reveal>把「读懂了」，一个一个攒起来。</p>
            <div className={styles.promiseGrid}>
              <div data-reveal>
                <h3>不打卡，不攒经验值</h3>
                <p>没有连胜天数，也没有彩纸动画。进度只看一件事：你是不是真的读懂了。</p>
              </div>
              <div data-reveal>
                <h3>到点就停</h3>
                <p>每节课都有时间上限。没学完就如实记下，明天接着来，不用熬夜补课。</p>
              </div>
              <div data-reveal>
                <h3>不夸口</h3>
                <p>21 天不会让你精通日语。但第 21 天，你会清楚知道自己能独立读懂哪些信息。</p>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- FAQ ---------------- */}
        <section id="faq" className={styles.section}>
          <div className={`${styles.wrap} ${styles.faqWrap}`}>
            <div className={styles.sectionHead} data-reveal>
              <p className={styles.eyebrow} lang="ja">よくある質問</p>
              <h2>开始之前</h2>
            </div>
            <div className={styles.faq}>
              {FAQ.map((item, i) => (
                <details key={item.q} className={styles.faqItem} open={i === 0} data-reveal>
                  <summary>
                    <span>{item.q}</span>
                    <Plus size={18} className={styles.faqIcon} />
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- Final CTA ---------------- */}
        <section className={styles.final}>
          <div className={`${styles.wrap} ${styles.finalInner}`} data-reveal>
            <Hanko char="朝" className={styles.finalStamp} />
            <h2>
              今天，从「
              <ruby lang="ja">
                あさ<rt>早晨</rt>
              </ruby>
              」开始。
            </h2>
            <p>第 1 天学的第一个词。五分钟后，你就能把它从一句日语里认出来。</p>
            <div ref={endCtaRef}>
              <Link to={ctaTo} className={styles.btnShu}>
                {ctaLabel}
                <ArrowRight size={18} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.wrap} ${styles.footerInner}`}>
          <div className={styles.footerBrand}>
            <Hanko char="楽" className={styles.footerStamp} />
            <span>Happy Japanese · 一字一句，读懂日语</span>
          </div>
          <nav className={styles.footerLinks} aria-label="页脚导航">
            <Link to="/course">21 天课程</Link>
            <Link to="/notes">原文阅读</Link>
            <Link to="/songs">歌曲</Link>
            <Link to="/learn">拓展练习</Link>
          </nav>
        </div>
      </footer>

      {/* ---------------- Mobile dock ---------------- */}
      <div className={`${styles.dock} ${showDock ? styles.dockOn : ''}`} aria-hidden={!showDock}>
        <div className={styles.dockInfo}>
          <strong>{started ? `第 ${activeDay} 天` : '第 1 天'}</strong>
          <span>{(readingCourse.find((l) => l.day === activeDay) ?? readingCourse[0]).title}</span>
        </div>
        <Link to={ctaTo} className={styles.dockBtn} tabIndex={showDock ? 0 : -1}>
          {started ? '继续' : '开始'}
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
