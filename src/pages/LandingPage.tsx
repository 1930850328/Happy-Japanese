import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  BookOpenText,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Moon,
  Music2,
  Pause,
  Play,
  Sparkles,
  Sun,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { readingCourse, readingCourseVersion, readingStages } from '../data/readingCourse'
import { useCourseStore } from '../store/useCourseStore'
import styles from './LandingPage.module.css'

type DemoTab = 'reading' | 'songs' | 'notes'

interface DemoToken {
  id: string
  text: string
  kana?: string
  pos?: string
  meaning?: string
  note?: string
  interactive?: boolean
}

const READING_DEMO_TOKENS: DemoToken[] = [
  {
    id: 'kesa',
    text: '今朝',
    kana: 'けさ',
    pos: '名词 · 时间',
    meaning: '今天早上',
    note: '日常极高频词，不用背偏旁，结合“今天早上喝咖啡”这个画面一眼就能记住。',
    interactive: true,
  },
  { id: 'c1', text: '、' },
  {
    id: 'eki',
    text: '駅',
    kana: 'えき',
    pos: '名词 · 地点',
    meaning: '车站',
    note: '去日本旅游、看动漫最常见的汉字之一，读作 えき。',
    interactive: true,
  },
  { id: 'p1', text: 'の' },
  {
    id: 'mae',
    text: '前',
    kana: 'まえ',
    pos: '名词 · 方位',
    meaning: '前面',
    note: '駅の前 = 车站前面，“A の B” 是日语里最先要掌握的连接方式。',
    interactive: true,
  },
  { id: 'p2', text: 'で' },
  {
    id: 'atatakai',
    text: '温かい',
    kana: 'あたたかい',
    pos: 'い形容词',
    meaning: '温热的、暖和的',
    note: '直接放在名词前面修饰“咖啡”，不用加“的”。',
    interactive: true,
  },
  {
    id: 'coffee',
    text: 'コーヒー',
    kana: 'coffee',
    pos: '片假名 · 外来语',
    meaning: '咖啡',
    note: '片假名多半来自英语发音，连着读出来往往一秒猜中。',
    interactive: true,
  },
  { id: 'p3', text: 'を' },
  {
    id: 'kaimashita',
    text: '買いました',
    kana: 'かいました',
    pos: '动词 · 过去礼貌形',
    meaning: '买了',
    note: '词尾 ました 表示“已经做完了”，放在整句话最后定调。',
    interactive: true,
  },
  { id: 'c2', text: '。' },
]

const SONG_DEMO_LINES = [
  {
    words: ['夜空', 'に', '浮かぶ', '小さな', '光'],
    zh: '漂浮在夜空中的微弱光芒',
  },
  {
    words: ['君の', '声が', 'そっと', '響く'],
    zh: '你的声音轻轻回响着',
  },
  {
    words: ['明日', 'へ', '続く', '道を', '歩こう'],
    zh: '走向通往明天的那条路吧',
  },
]

const SONG_DEMO_VOCAB = [
  { word: '夜空（よぞら）', meaning: '夜空' },
  { word: '浮かぶ（うかぶ）', meaning: '漂浮、浮现' },
  { word: '響く（ひびく）', meaning: '回响、传入耳中' },
  { word: '続く（つづく）', meaning: '延续、通往' },
]

const NOTES_SAMPLES = [
  {
    id: 'cafe',
    label: '东京咖啡馆小纸条',
    tokens: [
      { text: '本日', kana: 'ほんじつ' },
      { text: 'は' },
      { text: '雨', kana: 'あめ' },
      { text: 'のため、' },
      { text: '店内', kana: 'てんない' },
      { text: 'でゆっくりお' },
      { text: '過', kana: 'す' },
      { text: 'ごしください。' },
    ],
    zh: '今天因为下雨，请在店内慢慢坐、轻松待一会儿。',
    points: [
      { word: '本日（ほんじつ）', tag: '礼貌书面语', desc: '相当于“今日（今天）”，店铺公告和通知里最常用。' },
      { word: '〜のため', tag: '原因表达', desc: '表示“因为……”，比日常口语的 から 更正式。' },
      { word: 'お過ごしください', tag: '敬语请求', desc: '“请度过（一段时光）”，旅日进店高频暖心提示。' },
    ],
  },
  {
    id: 'drama',
    label: '日剧日常台词',
    tokens: [
      { text: '焦', kana: 'あせ' },
      { text: 'らなくても' },
      { text: '大丈夫', kana: 'だいじょうぶ' },
      { text: '。' },
      { text: '一歩', kana: 'いっぽ' },
      { text: 'ずつ' },
      { text: '進', kana: 'すす' },
      { text: 'めばいいよ。' },
    ],
    zh: '不用着急也没关系，一步一步往前走就好。',
    points: [
      { word: '焦らなくても', tag: '动词变化', desc: '原形 焦る（着急），表示“即使不着急也……”。' },
      { word: '一歩ずつ', tag: '常用副词', desc: '“一步一步地”，〜ずつ 表示每次定量推进。' },
      { word: '進めばいいよ', tag: '口语建议', desc: '“只要往前走就好啦”，语气轻松自然。' },
    ],
  },
]

const FAQ_ITEMS = [
  {
    q: '完全零基础，连五十音都没背过能直接学吗？',
    a: '可以。第 1 天就是从最常用的平片假名起步，而且不会让你干背整张表——每学几个字形，立刻放进真实短词和短句里认读，当天就能有“我看懂了一句日语”的感觉。',
  },
  {
    q: '每天需要花多长时间？中间断了一天怎么办？',
    a: '每天 15～30 分钟就够了，不需要连续打卡。进度会自动保存在本地浏览器里，哪怕隔了一周再打开，也能从上次停下的那一页直接续上。',
  },
  {
    q: '需要注册账号或者付费吗？',
    a: '不用注册，也完全免费开源。打开网页就能直接进入第 1 天课程，或者去歌曲页、原文阅读页直接体验。',
  },
  {
    q: '除了 21 天课程，歌曲和原文功能适合什么阶段用？',
    a: '随时都能穿插着玩。学完前 3 天认识基础假名后，就可以把喜欢的日文歌或动漫台词丢进去，开着假名注音边听边看，比单纯刷题有趣得多。',
  },
]

export function LandingPage() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light'
    return window.localStorage.getItem('hj-landing-theme') === 'dark' ? 'dark' : 'light'
  })
  const [activeTab, setActiveTab] = useState<DemoTab>('reading')
  const [showFurigana, setShowFurigana] = useState(true)
  const [showZh, setShowZh] = useState(true)
  const [selectedTokenId, setSelectedTokenId] = useState('kesa')
  const [songPlaying, setSongPlaying] = useState(true)
  const [songTick, setSongTick] = useState(1)
  const [noteSampleId, setNoteSampleId] = useState(NOTES_SAMPLES[0].id)
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const courseState = useCourseStore((state) => state.courseState)
  const initializeCourse = useCourseStore((state) => state.initialize)

  useEffect(() => {
    void initializeCourse()
  }, [initializeCourse])

  useEffect(() => {
    window.localStorage.setItem('hj-landing-theme', theme)
  }, [theme])

  useEffect(() => {
    if (activeTab !== 'songs' || !songPlaying) return
    const timer = window.setInterval(() => {
      setSongTick((prev) => (prev + 1) % 14)
    }, 650)
    return () => window.clearInterval(timer)
  }, [activeTab, songPlaying])

  const saved = courseState.readingCourse
  const progress = saved?.version === readingCourseVersion ? saved : undefined
  const started = Boolean(progress && Object.keys(progress.lessons).length > 0)
  const activeDay = progress?.activeDay ?? 1
  const ctaLabel = started ? `继续第 ${activeDay} 天` : '开始第 1 天'
  const ctaTarget = `/course/${activeDay}`

  const selectedToken =
    READING_DEMO_TOKENS.find((t) => t.id === selectedTokenId && t.interactive) ?? READING_DEMO_TOKENS[0]
  const activeNoteSample = NOTES_SAMPLES.find((s) => s.id === noteSampleId) ?? NOTES_SAMPLES[0]

  return (
    <div className={styles.landing} data-theme={theme}>
      {/* Sticky Header */}
      <header className={styles.header}>
        <div className={`${styles.container} ${styles.headerInner}`}>
          <Link to="/" className={styles.brand}>
            <span className={styles.brandSeal} aria-hidden="true">あ</span>
            <span>Happy Japanese</span>
          </Link>

          <nav className={styles.navLinks} aria-label="页面导航">
            <a href="#demo" className={styles.navLink}>交互演示</a>
            <a href="#features" className={styles.navLink}>怎么学</a>
            <a href="#roadmap" className={styles.navLink}>21天路线</a>
            <a href="#faq" className={styles.navLink}>常见问题</a>
          </nav>

          <div className={styles.headerActions}>
            <a
              href="https://github.com/1930850328/Happy-Japanese"
              target="_blank"
              rel="noreferrer"
              className={styles.iconBtn}
              aria-label="在 GitHub 查看源码"
              title="GitHub"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
              </svg>
            </a>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
              aria-label={theme === 'light' ? '切换深色模式' : '切换浅色模式'}
              title={theme === 'light' ? '深色模式' : '浅色模式'}
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <Link to={ctaTarget} className={styles.primaryPill}>
              <span>{ctaLabel}</span>
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroGridBg} aria-hidden="true" />
        <div className={`${styles.container} ${styles.heroInner}`}>
          <div className={styles.heroBadge}>
            <span className={styles.badgeDot} />
            <span>21 天日语阅读入门 · 免费开源</span>
          </div>

          <h1 className={styles.heroTitle}>
            不用啃完语法书，
            <br />
            <span className={styles.heroAccent}>21 天直接读懂日语。</span>
          </h1>

          <p className={styles.heroSubtitle}>
            从平片假名起步，到听懂喜欢的日文歌、自己读完日语短篇。
            没有冗长说教，打开浏览器，每天 20 分钟就能看见实打实的进步。
          </p>

          <div className={styles.heroActions}>
            <Link to={ctaTarget} className={`${styles.primaryPill} ${styles.primaryPillLg}`}>
              <span>{ctaLabel}</span>
              <ArrowRight size={17} />
            </Link>
            <Link to="/course" className={styles.outlinePill}>
              <span>先看课程目录</span>
            </Link>
          </div>

          <div className={styles.heroMeta}>
            <span><CheckCircle2 size={15} /> 零基础直接上手</span>
            <span><CheckCircle2 size={15} /> 免注册，进度本地保存</span>
            <span><CheckCircle2 size={15} /> 课程 · 歌曲 · 原文一站学</span>
          </div>
        </div>
      </section>

      {/* Interactive Demo Workbench */}
      <section id="demo" className={styles.bandSoft}>
        <div className={styles.container}>
          <div className={styles.sectionHeader}>
            <span className={styles.eyebrow}>Interactive Preview</span>
            <h2 className={styles.sectionTitle}>打开就是学习现场</h2>
            <p className={styles.sectionDesc}>
              不用看长篇功能介绍，下面三个真实场景都可以直接点点看。
            </p>
          </div>

          <div className={styles.tabWrap}>
            <div className={styles.tabStrip} role="tablist" aria-label="功能演示切换">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'reading'}
                className={`${styles.tabBtn} ${activeTab === 'reading' ? styles.tabBtnActive : ''}`}
                onClick={() => setActiveTab('reading')}
              >
                <BookOpen size={15} />
                <span>21 天阅读课</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'songs'}
                className={`${styles.tabBtn} ${activeTab === 'songs' ? styles.tabBtnActive : ''}`}
                onClick={() => setActiveTab('songs')}
              >
                <Music2 size={15} />
                <span>听歌学日语</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'notes'}
                className={`${styles.tabBtn} ${activeTab === 'notes' ? styles.tabBtnActive : ''}`}
                onClick={() => setActiveTab('notes')}
              >
                <BookOpenText size={15} />
                <span>原文精读</span>
              </button>
            </div>
          </div>

          <div className={styles.demoWindow}>
            <div className={styles.windowBar}>
              <div className={styles.windowDots} aria-hidden="true">
                <span className={styles.dotRed} />
                <span className={styles.dotYellow} />
                <span className={styles.dotGreen} />
              </div>
              <span className={styles.windowUrl}>
                {activeTab === 'reading'
                  ? 'happy-japanese / course / day-06'
                  : activeTab === 'songs'
                    ? 'happy-japanese / songs'
                    : 'happy-japanese / notes'}
              </span>
              <Link
                to={activeTab === 'reading' ? '/course/1' : activeTab === 'songs' ? '/songs' : '/notes'}
                className={styles.windowAction}
              >
                <span>打开真实页面</span>
                <ArrowUpRight size={14} />
              </Link>
            </div>

            <div className={styles.demoBody}>
              {activeTab === 'reading' ? (
                <div className={styles.readingGrid}>
                  <div>
                    <div className={styles.demoControls}>
                      <span className={styles.dayTag}>例句拆解 · 点击高亮词查看释义</span>
                      <div className={styles.toggleRow}>
                        <button
                          type="button"
                          className={`${styles.miniToggle} ${showFurigana ? styles.miniToggleActive : ''}`}
                          onClick={() => setShowFurigana((v) => !v)}
                        >
                          假名注音 {showFurigana ? '开' : '关'}
                        </button>
                        <button
                          type="button"
                          className={`${styles.miniToggle} ${showZh ? styles.miniToggleActive : ''}`}
                          onClick={() => setShowZh((v) => !v)}
                        >
                          中文翻译 {showZh ? '开' : '关'}
                        </button>
                      </div>
                    </div>

                    <div className={styles.sentenceBox}>
                      <div className={styles.sentenceTokens}>
                        {READING_DEMO_TOKENS.map((token) =>
                          token.interactive ? (
                            <button
                              key={token.id}
                              type="button"
                              className={`${styles.tokenBtn} ${selectedToken.id === token.id ? styles.tokenBtnActive : ''}`}
                              onClick={() => setSelectedTokenId(token.id)}
                            >
                              {showFurigana && token.kana ? (
                                <ruby>
                                  {token.text}
                                  <rt className={styles.rubyRt}>{token.kana}</rt>
                                </ruby>
                              ) : (
                                token.text
                              )}
                            </button>
                          ) : (
                            <span key={token.id} className={styles.tokenPlain}>{token.text}</span>
                          ),
                        )}
                      </div>
                      {showZh ? (
                        <p className={styles.sentenceZh}>今天早上，在车站前面买了杯热咖啡。</p>
                      ) : null}
                    </div>
                    <p className={styles.tapHint}>点一点句子里的「今朝」「駅」「温かい」「買いました」试试看。</p>
                  </div>

                  <aside className={styles.inspectorCard} aria-live="polite">
                    <div className={styles.inspectorTop}>
                      <span className={styles.inspectorWord}>{selectedToken.text}</span>
                      <span className={styles.inspectorPos}>{selectedToken.pos}</span>
                    </div>
                    <span className={styles.inspectorKana}>{selectedToken.kana}</span>
                    <p className={styles.inspectorMeaning}>{selectedToken.meaning}</p>
                    <p className={styles.inspectorNote}>{selectedToken.note}</p>
                  </aside>
                </div>
              ) : null}

              {activeTab === 'songs' ? (
                <div className={styles.songStage}>
                  <div>
                    <div className={styles.songTop}>
                      <div className={styles.songMeta}>
                        <div className={styles.songCover}>♪</div>
                        <div>
                          <div className={styles.songTitle}>夜空のメロディ（逐字歌词演示）</div>
                          <div className={styles.songArtist}>导入你的日文歌，边听边同步拆词</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={styles.playToggle}
                        onClick={() => setSongPlaying((p) => !p)}
                      >
                        {songPlaying ? <Pause size={15} /> : <Play size={15} />}
                        <span>{songPlaying ? '暂停' : '播放'}</span>
                      </button>
                    </div>

                    <div className={styles.lyricLines}>
                      {SONG_DEMO_LINES.map((line, lineIdx) => {
                        const lineOffset = lineIdx === 0 ? 0 : lineIdx === 1 ? 5 : 9
                        const isLineActive =
                          songTick >= lineOffset && songTick < lineOffset + line.words.length
                        return (
                          <div
                            key={line.zh}
                            className={`${styles.lyricLine} ${isLineActive ? styles.lyricLineActive : ''}`}
                          >
                            <div className={styles.lyricJa}>
                              {line.words.map((word, wordIdx) => {
                                const globalIdx = lineOffset + wordIdx
                                const isCurrent = songTick === globalIdx
                                const isLit = songTick > globalIdx
                                return (
                                  <span
                                    key={`${lineIdx}-${wordIdx}`}
                                    className={`${styles.lyricWord} ${
                                      isCurrent
                                        ? styles.lyricWordCurrent
                                        : isLit
                                          ? styles.lyricWordLit
                                          : ''
                                    }`}
                                  >
                                    {word}
                                  </span>
                                )
                              })}
                            </div>
                            <div className={styles.lyricZh}>{line.zh}</div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div className={styles.songCard}>
                    <span className={styles.songCardTitle}>本段高频词</span>
                    <div className={styles.songVocabList}>
                      {SONG_DEMO_VOCAB.map((item) => (
                        <div key={item.word} className={styles.songVocabItem}>
                          <strong>{item.word}</strong>
                          <span>{item.meaning}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTab === 'notes' ? (
                <div>
                  <div className={styles.sampleSwitch}>
                    {NOTES_SAMPLES.map((sample) => (
                      <button
                        key={sample.id}
                        type="button"
                        className={`${styles.miniToggle} ${
                          activeNoteSample.id === sample.id ? styles.miniToggleActive : ''
                        }`}
                        onClick={() => setNoteSampleId(sample.id)}
                      >
                        {sample.label}
                      </button>
                    ))}
                  </div>

                  <div className={styles.notesDemo}>
                    <div className={styles.notesPassage}>
                      <div>
                        {activeNoteSample.tokens.map((t, i) =>
                          t.kana ? (
                            <ruby key={i}>
                              {t.text}
                              <rt className={styles.rubyRt}>{t.kana}</rt>
                            </ruby>
                          ) : (
                            <span key={i}>{t.text}</span>
                          ),
                        )}
                      </div>
                      <p className={styles.sentenceZh}>{activeNoteSample.zh}</p>
                    </div>

                    <div className={styles.notesBreakdown}>
                      {activeNoteSample.points.map((pt) => (
                        <div key={pt.word} className={styles.notePoint}>
                          <div className={styles.notePointTop}>
                            <strong>{pt.word}</strong>
                            <span>{pt.tag}</span>
                          </div>
                          <p>{pt.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* Core Value Bento Grid */}
      <section id="features" className={styles.bandPlain}>
        <div className={styles.container}>
          <div className={styles.sectionHeader}>
            <span className={styles.eyebrow}>Why It Works</span>
            <h2 className={styles.sectionTitle}>学日语最怕坚持不下去，我们把门槛拆平了</h2>
            <p className={styles.sectionDesc}>
              不堆砌术语，不逼你背整本语法书，每一处设计都只为了让你更快体会到“看懂了”的快乐。
            </p>
          </div>

          <div className={styles.bentoGrid}>
            <article className={styles.bentoCard}>
              <div className={styles.bentoIcon}><Sparkles size={20} /></div>
              <h3>第一天就在真实句子里认字</h3>
              <p>告别枯燥的五十音死记硬背。学完几个基础假名，立刻读真实词组和生活短句，边看边记更牢固。</p>
              <div className={styles.bentoMiniPreview}>
                <span>Day 01 · 立刻上手</span>
                <code>あめ → 雨 · あさ → 朝</code>
              </div>
            </article>

            <article className={styles.bentoCard}>
              <div className={styles.bentoIcon}><Music2 size={20} /></div>
              <h3>拿你喜欢的日文歌练手感</h3>
              <p>导入平时单曲循环的 J-POP 或动漫 OP，逐字同步高亮跟唱，顺手把歌词里的生词收进词库。</p>
              <div className={styles.bentoMiniPreview}>
                <span>卡拉 OK 逐字同步</span>
                <code>♪ 君の声が響く</code>
              </div>
            </article>

            <article className={styles.bentoCard}>
              <div className={styles.bentoIcon}><BookOpenText size={20} /></div>
              <h3>看到什么日语，贴进来就能读</h3>
              <p>推文、漫画对白、商品包装、日剧台词——粘进原文阅读器，自动标出假名读音与重点词解。</p>
              <div className={styles.bentoMiniPreview}>
                <span>粘贴即析</span>
                <code>漢字 → かんじ</code>
              </div>
            </article>

            <article className={styles.bentoCard}>
              <div className={styles.bentoIcon}><Clock3 size={20} /></div>
              <h3>碎片时间随时续上，没有打卡焦虑</h3>
              <p>通勤 10 分钟、睡前 15 分钟都能学一小节。进度自动留在本地，随时停下，下次打开无缝接着来。</p>
              <div className={styles.bentoMiniPreview}>
                <span>自动记忆进度</span>
                <code>免注册 · 零打扰</code>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* 21-Day Roadmap */}
      <section id="roadmap" className={styles.bandSoft}>
        <div className={styles.container}>
          <div className={styles.sectionHeader}>
            <span className={styles.eyebrow}>21-Day Roadmap</span>
            <h2 className={styles.sectionTitle}>21 天，从「完全陌生」到「自己读完一篇」</h2>
            <p className={styles.sectionDesc}>
              四个清晰阶段，每天只往前推一小步。点任意一天，现在就能直接试看。
            </p>
          </div>

          <div className={styles.roadmapGrid}>
            {readingStages.map((stage, idx) => {
              const stageLessons = readingCourse
                .filter((l) => l.day >= stage.from && l.day <= stage.to)
                .slice(0, 3)

              return (
                <article key={stage.from} className={styles.stageCard}>
                  <div className={styles.stageTop}>
                    <div>
                      <span className={styles.stageRange}>
                        STAGE 0{idx + 1} · DAY {String(stage.from).padStart(2, '0')}–{String(stage.to).padStart(2, '0')}
                      </span>
                      <h3>
                        {stage.title}
                        <small>{stage.subtitle}</small>
                      </h3>
                    </div>
                    <span className={styles.stageSeal} aria-hidden="true">{stage.mark}</span>
                  </div>

                  <p className={styles.stageDesc}>{stage.description}</p>

                  <div className={styles.dayPills}>
                    {stageLessons.map((lesson) => (
                      <Link key={lesson.day} to={`/course/${lesson.day}`} className={styles.dayPill}>
                        <span>D{String(lesson.day).padStart(2, '0')}</span>
                        {lesson.title}
                      </Link>
                    ))}
                  </div>
                </article>
              )
            })}
          </div>

          <div className={styles.roadmapFooter}>
            <Link to="/course" className={styles.outlinePill}>
              <span>查看完整 21 天课程表</span>
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className={styles.bandPlain}>
        <div className={styles.container}>
          <div className={styles.sectionHeader}>
            <span className={styles.eyebrow}>FAQ</span>
            <h2 className={styles.sectionTitle}>开始前，你可能想问</h2>
          </div>

          <div className={styles.faqList}>
            {FAQ_ITEMS.map((item, idx) => {
              const isOpen = openFaq === idx
              return (
                <div key={item.q} className={styles.faqItem}>
                  <button
                    type="button"
                    className={styles.faqQuestion}
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      size={18}
                      className={`${styles.faqChevron} ${isOpen ? styles.faqChevronOpen : ''}`}
                    />
                  </button>
                  {isOpen ? <p className={styles.faqAnswer}>{item.a}</p> : null}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className={styles.bandPlain} style={{ paddingTop: 0 }}>
        <div className={styles.container}>
          <div className={styles.ctaCard}>
            <h2>第一天，只需要认识眼前这几个假名。</h2>
            <p>不需要下载 App，也不用先做复杂计划。现在点进去，5 分钟后你就能读出第一句日语。</p>
            <Link to={ctaTarget} className={styles.ctaBtn}>
              <span>{ctaLabel}</span>
              <ArrowRight size={17} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <div className={`${styles.container} ${styles.footerInner}`}>
          <span>© {new Date().getFullYear()} Happy Japanese · 一字一句，读懂日语</span>
          <div className={styles.footerLinks}>
            <Link to="/course">21天课程</Link>
            <Link to="/notes">原文阅读</Link>
            <Link to="/songs">歌曲学习</Link>
            <Link to="/learn">拓展练习</Link>
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
    </div>
  )
}
