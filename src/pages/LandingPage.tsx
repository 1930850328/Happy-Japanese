import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Compass,
  Moon,
  Music2,
  Pause,
  Play,
  Plus,
  Sparkles,
  Sun,
  Volume2,
} from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import { readingCourse, readingCourseVersion, readingStages } from '../data/readingCourse'
import { speakJapanese } from '../lib/speech'
import { useCourseStore } from '../store/useCourseStore'
import styles from './LandingPage.module.css'

type ShowcaseTab = 'sentence' | 'progress' | 'songs' | 'notes'

interface WordToken {
  id: string
  ja: string
  kana?: string
  meaning?: string
  grammar?: string
  unlockDay?: number
}

const SENTENCE_TOKENS: WordToken[] = [
  { id: 'kesa', ja: '今朝', kana: 'けさ', meaning: '今天早上', grammar: '时间名词', unlockDay: 6 },
  { id: 'p1', ja: '、' },
  { id: 'eki', ja: '駅', kana: 'えき', meaning: '车站', grammar: '地点名词', unlockDay: 5 },
  { id: 'p2', ja: 'で' },
  { id: 'atatakai', ja: '温かい', kana: 'あたたかい', meaning: '温热的', grammar: 'い形容词 · 直接接名词', unlockDay: 7 },
  { id: 'coffee', ja: 'コーヒー', kana: 'ko-hi-', meaning: '咖啡', grammar: '片假名外来语', unlockDay: 2 },
  { id: 'p3', ja: 'を' },
  { id: 'kai', ja: '買いました', kana: 'かいました', meaning: '买了', grammar: '动词过去礼貌形（買う）', unlockDay: 6 },
  { id: 'p4', ja: '。' },
]

const PROGRESS_TOKENS = [
  { ja: 'この', day: 4 },
  { ja: '部屋', kana: 'へや', day: 9 },
  { ja: 'は', day: 4 },
  { ja: '日曜日', kana: 'にちようび', day: 16 },
  { ja: 'まで', day: 16 },
  { ja: '使', kana: 'つか', day: 13 },
  { ja: 'えます。', day: 13 },
  { ja: '本', kana: 'ほん', day: 4 },
  { ja: 'を', day: 5 },
  { ja: '読', kana: 'よ', day: 12 },
  { ja: 'んでもいいです。', day: 12 },
]

const KARAOKE_LINES = [
  {
    words: ['朝の', '駅で', '君を', '待つ'],
    zh: '在清晨的车站等你',
    raw: '朝の駅で君を待つ',
  },
  {
    words: ['少しだけ', '明日が', '見える'],
    zh: '好像能看见一点明天了',
    raw: '少しだけ明日が見える',
  },
]

const NOTES_ROWS = [
  { ja: 'ご自由に（ごじゆうに）', note: '请随意 · 商店/餐厅高频提示' },
  { ja: 'お取り（おとり）', note: '拿取（取る 的礼貌表达）' },
  { ja: '〜ください', note: '请…… · 第 12 天解锁句型' },
]

const STAGE_SHORT_DESC = [
  '把平片假名直接认成常见词。',
  '看清谁做了什么、发生了没有。',
  '读懂原因、转折、请求与条件。',
  '独立读完留言、通知与小故事。',
]

const FAQS = [
  {
    q: '完全零基础，五十音还没背能学吗？',
    a: '可以。第 1 天就从平假名起步，每学几个字立刻放进真实短词里认读，不用先死背整张五十音表。',
  },
  {
    q: '每天要花多久？断更了怎么办？',
    a: '每节课控制在 20～60 分钟内。不搞打卡连胜，进度自动保存在本地浏览器，随时停下、随时接着学。',
  },
  {
    q: '需要注册账号或付费吗？',
    a: '完全免费开源，免注册免登录，打开网页直接开始第 1 天。',
  },
  {
    q: '听歌和原文阅读什么时候能用？',
    a: '随时可用。学完前几天假名后，导入喜欢的日文歌或贴入动漫/日剧台词，边开假名注音边看最容易上瘾。',
  },
]

/** Playful minimalist cat-ear kana tile mark */
function BrandMark() {
  return (
    <svg className={styles.brandMark} viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path
        d="M6 12L9.5 4.5L15 9.5H21L26.5 4.5L30 12V27C30 29.7614 27.7614 32 25 32H11C8.23858 32 6 29.7614 6 27V12Z"
        fill="#ec8a2c"
      />
      <text
        x="18"
        y="22.5"
        textAnchor="middle"
         dominantBaseline="central"
        fill="#ffffff"
        fontSize="16"
        fontWeight="800"
        style={{ fontFamily: "'Hiragino Sans', 'Noto Sans JP', sans-serif" }}
      >
        あ
      </text>
    </svg>
  )
}

export function LandingPage() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light'
    return window.localStorage.getItem('hj-theme') === 'dark' ? 'dark' : 'light'
  })
  const [tab, setTab] = useState<ShowcaseTab>('sentence')
  const [selectedWordId, setSelectedWordId] = useState('atatakai')
  const [showKana, setShowKana] = useState(true)
  const [simDay, setSimDay] = useState(16)
  const [playingSong, setPlayingSong] = useState(true)
  const [songStep, setSongStep] = useState(2)
  const [showMobileDock, setShowMobileDock] = useState(false)
  const heroBtnRef = useRef<HTMLDivElement | null>(null)

  const courseState = useCourseStore((s) => s.courseState)
  const initializeCourse = useCourseStore((s) => s.initialize)

  useEffect(() => {
    void initializeCourse()
  }, [initializeCourse])

  useEffect(() => {
    window.localStorage.setItem('hj-theme', theme)
  }, [theme])

  useEffect(() => {
    if (tab !== 'songs' || !playingSong) return
    const id = window.setInterval(() => {
      setSongStep((prev) => (prev + 1) % 7)
    }, 620)
    return () => window.clearInterval(id)
  }, [tab, playingSong])

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight
      setShowMobileDock(y > 320 && y < maxScroll - 260)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const saved = courseState.readingCourse
  const progress = saved?.version === readingCourseVersion ? saved : undefined
  const started = Boolean(progress && Object.keys(progress.lessons).length > 0)
  const activeDay = progress?.activeDay ?? 1
  const ctaText = started ? `继续第 ${activeDay} 天` : '开始第 1 天'
  const ctaLink = `/course/${activeDay}`

  const activeWord =
    SENTENCE_TOKENS.find((t) => t.id === selectedWordId && t.meaning) ?? SENTENCE_TOKENS[4]

  const knownCount = PROGRESS_TOKENS.filter((t) => simDay >= t.day).length
  const simPct = Math.round((knownCount / PROGRESS_TOKENS.length) * 100)

  return (
    <div className={styles.page} data-theme={theme}>
      {/* Sticky Header */}
      <header className={styles.header}>
        <div className={`${styles.container} ${styles.headerInner}`}>
          <Link to="/" className={styles.brand}>
            <BrandMark />
            <span className={styles.brandWord}>
              Happy<em>Japanese</em>
            </span>
          </Link>

          <nav className={styles.nav} aria-label="主导航">
            <a href="#demo">互动体验</a>
            <a href="#roadmap">21天路线</a>
            <a href="#faq">常见疑问</a>
            <Link to="/course">课程目录</Link>
          </nav>

          <div className={styles.headerRight}>
            <a
              href="https://github.com/1930850328/Happy-Japanese"
              target="_blank"
              rel="noreferrer"
              className={`${styles.circleBtn} ${styles.githubBtn}`}
              aria-label="GitHub 仓库"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
              </svg>
            </a>
            <button
              type="button"
              className={styles.circleBtn}
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              aria-label={theme === 'light' ? '切换深色模式' : '切换浅色模式'}
            >
              {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
            </button>
            <Link to={ctaLink} className={styles.ctaPill}>
              <span>{ctaText}</span>
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.dotBackdrop} aria-hidden="true" />
        <div className={`${styles.container} ${styles.heroInner}`}>
          <div className={`${styles.releasePill} ${styles.reveal}`}>
            <span className={styles.liveDot} />
            <span>21 天零基础日语阅读 · 免费免登录</span>
          </div>

          <h1 className={`${styles.heroTitle} ${styles.reveal} ${styles.revealDelay1}`}>
            从零读懂日语，
            <br />
            <span className={styles.heroHighlight}>每天只需一节课。</span>
          </h1>

          <p className={`${styles.heroSub} ${styles.reveal} ${styles.revealDelay2}`}>
            不用先背完五十音和厚语法书，第一天就能直接读懂真实短句。
          </p>

          <div
            ref={heroBtnRef}
            className={`${styles.heroBtns} ${styles.reveal} ${styles.revealDelay3}`}
          >
            <Link to={ctaLink} className={styles.heroPrimary}>
              <span>{ctaText}</span>
              <ArrowRight size={17} />
            </Link>
            <Link to="/course" className={styles.heroSecondary}>
              <span>查看 21 天目录</span>
            </Link>
          </div>

          <div className={`${styles.heroTiles} ${styles.reveal} ${styles.revealDelay3}`}>
            <Link to="/course" className={styles.heroTile}>
              <span className={styles.tileGlyph}>あ</span>
              <span>21天阅读课</span>
            </Link>
            <Link to="/songs" className={styles.heroTile}>
              <span className={styles.tileGlyph}>♪</span>
              <span>听歌拆歌词</span>
            </Link>
            <Link to="/notes" className={styles.heroTile}>
              <span className={styles.tileGlyph}>文</span>
              <span>粘贴读原文</span>
            </Link>
            <Link to="/learn" className={styles.heroTile}>
              <span className={styles.tileGlyph}>測</span>
              <span>水平定位</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Interactive Dark Showcase + 2x2 Entry Cards (#demo) */}
      <section id="demo" className={styles.bandPlain} style={{ paddingTop: 16 }}>
        <div className={styles.container}>
          <div className={styles.secHead}>
            <h2 className={styles.secTitle}>点一下，马上体验</h2>
            <p className={styles.secSub}>
              点击下方日语句子听真人级发音、看词义拆解，或拖动滑块感受 21 天的变化。
            </p>
          </div>

          <div className={styles.pillRow}>
            <div className={styles.pillBar} role="tablist" aria-label="体验模式">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'sentence'}
                className={`${styles.pillTab} ${tab === 'sentence' ? styles.pillTabActive : ''}`}
                onClick={() => setTab('sentence')}
              >
                句子点读
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'progress'}
                className={`${styles.pillTab} ${tab === 'progress' ? styles.pillTabActive : ''}`}
                onClick={() => setTab('progress')}
              >
                21天变化
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'songs'}
                className={`${styles.pillTab} ${tab === 'songs' ? styles.pillTabActive : ''}`}
                onClick={() => setTab('songs')}
              >
                逐字听歌
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'notes'}
                className={`${styles.pillTab} ${tab === 'notes' ? styles.pillTabActive : ''}`}
                onClick={() => setTab('notes')}
              >
                原文精读
              </button>
            </div>
          </div>

          {/* Signature Dark macOS Card */}
          <div className={styles.darkStage}>
            <div className={styles.darkTopBar}>
              <div className={styles.macDots} aria-hidden="true">
                <i className={styles.dotR} />
                <i className={styles.dotY} />
                <i className={styles.dotG} />
              </div>
              <span className={styles.darkPath}>
                {tab === 'sentence'
                  ? 'happy-japanese · lesson-preview'
                  : tab === 'progress'
                    ? 'happy-japanese · 21-day-effect'
                    : tab === 'songs'
                      ? 'happy-japanese · karaoke-sync'
                      : 'happy-japanese · instant-reader'}
              </span>
              {tab === 'sentence' ? (
                <button
                  type="button"
                  className={styles.darkBarBtn}
                  onClick={() => speakJapanese('今朝、駅で温かいコーヒーを買いました。')}
                >
                  <Volume2 size={14} />
                  <span>朗读整句</span>
                </button>
              ) : tab === 'songs' ? (
                <button
                  type="button"
                  className={styles.darkBarBtn}
                  onClick={() => setPlayingSong((p) => !p)}
                >
                  {playingSong ? <Pause size={13} /> : <Play size={13} />}
                  <span>{playingSong ? '暂停' : '播放'}</span>
                </button>
              ) : (
                <Link
                  to={tab === 'progress' ? '/course' : '/notes'}
                  className={styles.darkBarBtn}
                >
                  <span>进入实机</span>
                  <ArrowUpRight size={13} />
                </Link>
              )}
            </div>

            <div className={styles.darkBody}>
              {tab === 'sentence' ? (
                <>
                  <div className={styles.jaSentenceRow} lang="ja">
                    {SENTENCE_TOKENS.map((tok) =>
                      tok.meaning ? (
                        <button
                          key={tok.id}
                          type="button"
                          className={`${styles.wordChip} ${
                            activeWord.id === tok.id ? styles.wordChipActive : ''
                          }`}
                          onClick={() => {
                            setSelectedWordId(tok.id)
                            speakJapanese(tok.ja)
                          }}
                        >
                          {showKana && tok.kana && tok.id !== 'coffee' ? (
                            <ruby>
                              {tok.ja}
                              <rt className={styles.jaRt}>{tok.kana}</rt>
                            </ruby>
                          ) : (
                            tok.ja
                          )}
                        </button>
                      ) : (
                        <span key={tok.id} className={styles.wordPlain}>
                          {tok.ja}
                        </span>
                      ),
                    )}
                  </div>

                  <div className={styles.termRows}>
                    <div className={styles.termRow}>
                      <span className={styles.termPrompt}>$</span>
                      <span className={styles.termKey}>
                        {activeWord.ja}（{activeWord.kana}）
                      </span>
                      <span className={styles.termVal}>
                        # {activeWord.meaning} · {activeWord.grammar}（第 {activeWord.unlockDay} 天解锁）
                      </span>
                    </div>
                    <div className={styles.termRow}>
                      <span className={styles.termPrompt}>→</span>
                      <span className={styles.termKey}>整句意思</span>
                      <span className={styles.termVal}>今天早上，在车站买了杯热咖啡。</span>
                    </div>
                  </div>

                  <div className={styles.darkHintBar}>
                    <span>提示：点任意词会自动播放日语发音</span>
                    <button
                      type="button"
                      className={`${styles.miniDarkToggle} ${showKana ? styles.miniDarkToggleOn : ''}`}
                      onClick={() => setShowKana((v) => !v)}
                    >
                      假名注音 {showKana ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </>
              ) : null}

              {tab === 'progress' ? (
                <>
                  <div className={styles.sliderTop}>
                    <span className={styles.sliderDayBadge}>
                      DAY {String(simDay).padStart(2, '0')} / 21
                    </span>
                    <span className={styles.sliderPct}>
                      读懂率 <strong>{simPct}%</strong>
                      {simPct === 100 ? <i className={styles.stampSeal}>読</i> : null}
                    </span>
                  </div>

                  <div className={styles.sliderPassage} lang="ja">
                    {PROGRESS_TOKENS.map((tok, i) => {
                      const lit = simDay >= tok.day
                      return tok.kana ? (
                        <ruby key={i} className={lit ? styles.tokLit : styles.tokDim}>
                          {tok.ja}
                          <rt className={styles.jaRt} style={{ opacity: lit ? 1 : 0 }}>
                            {tok.kana}
                          </rt>
                        </ruby>
                      ) : (
                        <span key={i} className={lit ? styles.tokLit : styles.tokDim}>
                          {tok.ja}
                        </span>
                      )
                    })}
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={21}
                    value={simDay}
                    style={{ '--pct': `${(simDay / 21) * 100}%` } as CSSProperties}
                    onChange={(e) => setSimDay(Number(e.target.value))}
                    className={styles.darkSlider}
                    aria-label="拖动查看不同学习天数的读懂程度"
                  />

                  <p className={styles.sliderTranslation}>
                    {simPct === 100
                      ? '已全部读懂：「这个房间到周日为止都能用。可以在里面看书。」'
                      : `拖动滑块试试：到第 16 天即可 100% 独立读懂这段真实通知。`}
                  </p>
                </>
              ) : null}

              {tab === 'songs' ? (
                <div className={styles.karaokeWrap}>
                  {KARAOKE_LINES.map((line, li) => {
                    const offset = li === 0 ? 0 : 4
                    const active = songStep >= offset && songStep < offset + line.words.length
                    return (
                      <div
                        key={line.raw}
                        className={`${styles.kRow} ${active ? styles.kRowActive : ''}`}
                        onClick={() => speakJapanese(line.raw)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className={styles.kJaLine} lang="ja">
                          {line.words.map((w, wi) => {
                            const idx = offset + wi
                            const cls =
                              songStep === idx
                                ? styles.kNow
                                : songStep > idx
                                  ? styles.kDone
                                  : styles.kDim
                            return (
                              <span key={wi} className={cls}>
                                {w}
                              </span>
                            )
                          })}
                        </div>
                        <div className={styles.kZhLine}>{line.zh}（点击可听发音）</div>
                      </div>
                    )
                  })}
                </div>
              ) : null}

              {tab === 'notes' ? (
                <>
                  <div className={styles.sliderPassage} lang="ja" style={{ marginBottom: 16 }}>
                    <ruby className={styles.tokLit}>
                      ご自由に<rt className={styles.jaRt}>ごじゆうに</rt>
                    </ruby>
                    <ruby className={styles.tokLit}>
                      お取り<rt className={styles.jaRt}>おとり</rt>
                    </ruby>
                    <span className={styles.tokLit}>ください。</span>
                  </div>
                  <div className={styles.termRows}>
                    {NOTES_ROWS.map((row) => (
                      <div key={row.ja} className={styles.termRow}>
                        <span className={styles.termPrompt}>$</span>
                        <span className={styles.termKey}>{row.ja}</span>
                        <span className={styles.termVal}># {row.note}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>

          {/* 2x2 Crisp White Entry Cards */}
          <div className={styles.entryGrid}>
            <Link to="/course" className={styles.entryCard}>
              <span className={styles.entryIcon}><BookOpen size={18} /></span>
              <div>
                <div className={styles.entryTitle}>
                  <span>21 天阅读主课</span>
                  <ArrowUpRight size={15} className={styles.entryArrow} />
                </div>
                <p className={styles.entryDesc}>从平片假名起步，循序渐进读懂短篇与通知。</p>
              </div>
            </Link>

            <Link to="/songs" className={styles.entryCard}>
              <span className={styles.entryIcon}><Music2 size={18} /></span>
              <div>
                <div className={styles.entryTitle}>
                  <span>歌曲逐字跟读</span>
                  <ArrowUpRight size={15} className={styles.entryArrow} />
                </div>
                <p className={styles.entryDesc}>导入喜欢的日文歌，卡拉 OK 级逐字同步拆词。</p>
              </div>
            </Link>

            <Link to="/notes" className={styles.entryCard}>
              <span className={styles.entryIcon}><Sparkles size={18} /></span>
              <div>
                <div className={styles.entryTitle}>
                  <span>原文粘贴精读</span>
                  <ArrowUpRight size={15} className={styles.entryArrow} />
                </div>
                <p className={styles.entryDesc}>看到任何日语贴进来，自动标假名、抓句子主干。</p>
              </div>
            </Link>

            <Link to="/learn" className={styles.entryCard}>
              <span className={styles.entryIcon}><Compass size={18} /></span>
              <div>
                <div className={styles.entryTitle}>
                  <span>水平定位与拓展</span>
                  <ArrowUpRight size={15} className={styles.entryArrow} />
                </div>
                <p className={styles.entryDesc}>几道题测出当前起点，每天只推送下一步练习。</p>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* 21-Day 4-Stage Roadmap */}
      <section id="roadmap" className={styles.bandSoft}>
        <div className={styles.container}>
          <div className={styles.secHead}>
            <h2 className={styles.secTitle}>21 天，四步走通</h2>
            <p className={styles.secSub}>
              每天不超过一小时，不打卡、不灌水，点任意一课可直接试读。
            </p>
          </div>

          <div className={styles.stageGrid}>
            {readingStages.map((stage, idx) => {
              const sampleLessons = readingCourse
                .filter((l) => l.day >= stage.from && l.day <= stage.to)
                .slice(0, 2)
              return (
                <article key={stage.from} className={styles.stageCard}>
                  <div className={styles.stageTop}>
                    <span className={styles.stageMono}>
                      0{idx + 1} · DAY {String(stage.from).padStart(2, '0')}–{String(stage.to).padStart(2, '0')}
                    </span>
                    <span className={styles.stageKanji}>{stage.mark}</span>
                  </div>
                  <h3 className={styles.stageName}>{stage.title}</h3>
                  <p className={styles.stageSummary}>{STAGE_SHORT_DESC[idx]}</p>
                  <div className={styles.stageLinks}>
                    {sampleLessons.map((lesson) => (
                      <Link
                        key={lesson.day}
                        to={`/course/${lesson.day}`}
                        className={styles.stageDayLink}
                      >
                        <span>
                          <b>D{String(lesson.day).padStart(2, '0')}</b>
                          {lesson.title}
                        </span>
                        <ArrowUpRight size={13} />
                      </Link>
                    ))}
                  </div>
                </article>
              )
            })}
          </div>

          <div className={styles.centerMore}>
            <Link to="/course" className={styles.heroSecondary}>
              <span>展开全部 21 天课程</span>
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* Concise FAQ */}
      <section id="faq" className={styles.bandPlain}>
        <div className={styles.container}>
          <div className={styles.secHead}>
            <h2 className={styles.secTitle}>常见疑问</h2>
          </div>

          <div className={styles.faqBox}>
            {FAQS.map((item, i) => (
              <details key={item.q} className={styles.faqCard} open={i === 0}>
                <summary>
                  <span>{item.q}</span>
                  <Plus size={17} className={styles.faqPlus} />
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className={styles.bandPlain} style={{ paddingTop: 0 }}>
        <div className={styles.container}>
          <div className={styles.closingCard}>
            <span className={styles.closingPill}>DAY 01 · あさ（早晨）</span>
            <h2>第一天，5 分钟认出第一个词。</h2>
            <p>无需下载注册，现在点开就能直接读出第一句日语。</p>
            <Link to={ctaLink} className={styles.closingBtn}>
              <span>{ctaText}</span>
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* Minimal Footer */}
      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerInner}`}>
          <span>© 2026 Happy Japanese · 免费开源 · 免登录本地保存</span>
          <div className={styles.footerLinks}>
            <Link to="/course">21天课程</Link>
            <Link to="/songs">歌曲跟读</Link>
            <Link to="/notes">原文精读</Link>
            <Link to="/learn">水平定位</Link>
            <a
              href="https://github.com/1930850328/Happy-Japanese"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>

      {/* Mobile Floating Bottom Pill */}
      <div
        className={`${styles.mobileDock} ${showMobileDock ? styles.mobileDockOn : ''}`}
        aria-hidden={!showMobileDock}
      >
        <div className={styles.mobileDockText}>
          Happy Japanese<span>· 21天读懂日语</span>
        </div>
        <Link to={ctaLink} className={styles.mobileDockBtn} tabIndex={showMobileDock ? 0 : -1}>
          <span>{started ? `第 ${activeDay} 天` : '开始学'}</span>
          <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  )
}
