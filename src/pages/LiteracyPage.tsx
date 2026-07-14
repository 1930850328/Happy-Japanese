import {
  BookOpenText,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Languages,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Volume2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { courseLessonMap } from '../data/courseCatalog'
import { readingPassages } from '../data/readingCurriculum'
import {
  loadGrammar,
  loadKanji,
  loadVocabulary,
  selectStudyBatch,
  type CurriculumEntry,
  type GrammarEntry,
  type KanjiEntry,
  type VocabularyEntry,
} from '../lib/curriculumContent'
import { getLiteracyReadiness, LITERACY_POLICY } from '../lib/literacyEngine'
import { speakJapanese } from '../lib/speech'
import { translateTexts } from '../lib/translation'
import { useCourseStore } from '../store/useCourseStore'
import type { CourseLevel, LiteracyItemKind } from '../types'
import styles from './LiteracyPage.module.css'

type StudyTab = LiteracyItemKind | 'reading'

const tabs: Array<{ id: StudyTab; label: string; note: string }> = [
  { id: 'vocabulary', label: '词汇', note: `每日 ${LITERACY_POLICY.dailyVocabulary} 个` },
  { id: 'kanji', label: '汉字', note: `每日 ${LITERACY_POLICY.dailyKanji} 个` },
  { id: 'grammar', label: '语法', note: `每日 ${LITERACY_POLICY.dailyGrammar} 个` },
  { id: 'reading', label: '分级阅读', note: '无辅助检测' },
]

const kindLabels: Record<LiteracyItemKind, string> = {
  vocabulary: '词汇',
  kanji: '汉字',
  grammar: '语法',
}

const levelRank: Record<Exclude<CourseLevel, 'foundation'>, number> = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 }

function getItemFront(item: CurriculumEntry) {
  if ('term' in item) return item.term
  if ('character' in item) return item.character
  return localizeGrammarPattern(item.title.replace(/\s*\([^)]*\)\s*$/, ''))
}

function localizeGrammarPattern(value: string) {
  const terms: Array<[RegExp, string]> = [
    [/\bNouns?\b/gi, '名词'],
    [/\bVerbs?\b/gi, '动词'],
    [/\bAdjectives?\b/gi, '形容词'],
    [/\bAdverbs?\b/gi, '副词'],
    [/\bParticles?\b/gi, '助词'],
    [/\bPronouns?\b/gi, '代词'],
    [/\bQuestion words?\b/gi, '疑问词'],
    [/\bDictionary form\b/gi, '辞书形'],
    [/\bPlain form\b/gi, '普通形'],
    [/\bCasual form\b/gi, '简体'],
    [/\bTe-form\b/gi, 'て形'],
    [/\bPast tense\b/gi, '过去式'],
    [/\bSentence\b/gi, '句子'],
    [/\bClause\b/gi, '从句'],
    [/\bPerson\b/gi, '人物'],
    [/\bPlace\b/gi, '地点'],
  ]
  return terms.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
}

function getMeaningSource(item: CurriculumEntry) {
  if ('meaningEn' in item) return item.meaningEn
  if ('meaningsEn' in item) return item.meaningsEn.join('; ')
  return item.shortExplanationEn
}

function getDailyLimit(kind: LiteracyItemKind) {
  if (kind === 'vocabulary') return LITERACY_POLICY.dailyVocabulary
  if (kind === 'kanji') return LITERACY_POLICY.dailyKanji
  return LITERACY_POLICY.dailyGrammar
}

function shuffleOptions(values: string[], seed: number) {
  const unique = [...new Set(values)]
  if (unique.length < 2) return unique
  const offset = seed % unique.length
  return [...unique.slice(offset), ...unique.slice(0, offset)]
}

export function LiteracyPage() {
  const courseState = useCourseStore((state) => state.courseState)
  const saveLiteracyAnswer = useCourseStore((state) => state.saveLiteracyAnswer)
  const saveReadingAttempt = useCourseStore((state) => state.saveReadingAttempt)
  const [tab, setTab] = useState<StudyTab>('vocabulary')
  const [batch, setBatch] = useState<CurriculumEntry[]>([])
  const [meanings, setMeanings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [readingAnswers, setReadingAnswers] = useState<Array<number | null>>([null, null])
  const [showReading, setShowReading] = useState(false)
  const [showTranslation, setShowTranslation] = useState(false)
  const [usedReadingAid, setUsedReadingAid] = useState(false)
  const [usedTranslationAid, setUsedTranslationAid] = useState(false)
  const [readingStartedAt, setReadingStartedAt] = useState(() => Date.now())
  const [readingResult, setReadingResult] = useState<{ accuracy: number; speed: number; counts: boolean } | null>(null)
  const [selectedPassageId, setSelectedPassageId] = useState<string | null>(null)

  const activeLesson = courseState.profile ? courseLessonMap.get(courseState.profile.activeLessonId) : undefined
  const currentLevel: CourseLevel = activeLesson?.level ?? 'foundation'
  const contentLevel = currentLevel === 'foundation' ? 'N5' : currentLevel
  const readiness = useMemo(
    () => getLiteracyReadiness(courseState, currentLevel),
    [courseState, currentLevel],
  )
  const availablePassages = useMemo(
    () => readingPassages.filter((item) => levelRank[item.level] <= levelRank[contentLevel]),
    [contentLevel],
  )
  const eligibleAttempts = courseState.literacy.readingAttempts.filter((item) => levelRank[item.level === 'foundation' ? 'N5' : item.level] <= levelRank[contentLevel])
  const passedPassageIds = new Set(eligibleAttempts.filter((item) => item.accuracy >= .8 && !item.usedReadingAid && !item.usedTranslationAid).map((item) => item.passageId))
  const suggestedPassage = availablePassages.find((item) => !passedPassageIds.has(item.id))
    ?? availablePassages[eligibleAttempts.length % Math.max(availablePassages.length, 1)]
  const passage = availablePassages.find((item) => item.id === selectedPassageId) ?? suggestedPassage

  useEffect(() => {
    setSelectedPassageId(null)
  }, [contentLevel])

  useEffect(() => {
    if (tab === 'reading' && !selectedPassageId && suggestedPassage) {
      setSelectedPassageId(suggestedPassage.id)
    }
  }, [selectedPassageId, suggestedPassage, tab])

  useEffect(() => {
    if (tab === 'reading') return
    let cancelled = false
    setLoading(true)
    setLoadError('')
    setQuestionIndex(0)
    setSelectedOption(null)

    const load = tab === 'vocabulary' ? loadVocabulary : tab === 'kanji' ? loadKanji : loadGrammar
    void load()
      .then(async (entries) => {
        const nextBatch = selectStudyBatch(
          entries as CurriculumEntry[],
          tab,
          currentLevel,
          courseState.literacy.itemProgress,
          getDailyLimit(tab),
        )
        const sources = nextBatch.map(getMeaningSource)
        const translated = await translateTexts(sources, 'en')
        if (cancelled) return
        const translatedById = Object.fromEntries(
          nextBatch
            .map((item) => [item.id, translated[getMeaningSource(item)]?.trim()] as const)
            .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
        )
        if (Object.keys(translatedById).length < Math.min(4, nextBatch.length)) {
          throw new Error('中文释义暂时没有加载完成，请稍后重试。')
        }
        setBatch(nextBatch.filter((item) => translatedById[item.id]))
        setMeanings(translatedById)
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : '学习内容加载失败，请稍后重试。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  // A submitted answer updates the persisted progress. Keep the current session stable;
  // a new tab visit or explicit reload will use the latest scheduling data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLevel, reloadKey, tab])

  const currentItem = batch[questionIndex]
  const reverseQuestion = questionIndex % 2 === 1
  const options = useMemo(() => {
    if (!currentItem) return []
    const candidates = batch.slice(0, 6)
    const values = reverseQuestion ? candidates.map(getItemFront) : candidates.map((item) => meanings[item.id]).filter(Boolean)
    const correct = reverseQuestion ? getItemFront(currentItem) : meanings[currentItem.id]
    return shuffleOptions([correct, ...values.filter((value) => value !== correct).slice(0, 3)], questionIndex + currentItem.id.length)
  }, [batch, currentItem, meanings, questionIndex, reverseQuestion])
  const correctOption = currentItem ? (reverseQuestion ? getItemFront(currentItem) : meanings[currentItem.id]) : ''

  const chooseOption = async (option: string) => {
    if (!currentItem || selectedOption) return
    setSelectedOption(option)
    await saveLiteracyAnswer({
      itemId: currentItem.id,
      kind: tab as LiteracyItemKind,
      level: currentItem.level,
      correct: option === correctOption,
      meaningZh: meanings[currentItem.id],
    })
  }

  const nextQuestion = () => {
    setSelectedOption(null)
    setQuestionIndex((index) => index + 1)
  }

  const resetReading = (advance = false) => {
    if (advance && passage && availablePassages.length > 0) {
      const currentIndex = availablePassages.findIndex((item) => item.id === passage.id)
      setSelectedPassageId(availablePassages[(currentIndex + 1) % availablePassages.length].id)
    }
    setReadingAnswers([null, null])
    setShowReading(false)
    setShowTranslation(false)
    setUsedReadingAid(false)
    setUsedTranslationAid(false)
    setReadingResult(null)
    setReadingStartedAt(Date.now())
  }

  const submitReading = async () => {
    if (!passage || readingAnswers.some((answer) => answer === null)) return
    const correct = passage.questions.filter((question, index) => question.answerIndex === readingAnswers[index]).length
    const accuracy = correct / passage.questions.length
    const minutes = Math.max((Date.now() - readingStartedAt) / 60_000, 0.25)
    const speed = Math.round(passage.text.length / minutes)
    const counts = accuracy >= 0.8 && !usedReadingAid && !usedTranslationAid
    await saveReadingAttempt({
      passageId: passage.id,
      level: passage.level,
      accuracy,
      charactersPerMinute: speed,
      usedReadingAid,
      usedTranslationAid,
    })
    setReadingResult({ accuracy, speed, counts })
  }

  return (
    <div className={`${styles.page} fadeIn`}>
      <section className={styles.hero}>
        <div>
          <span className="chip badgeMint">真实能力训练</span>
          <h1 className="pageTitle">把词汇、汉字、语法，练成阅读能力</h1>
          <p className="sectionIntro">不是“看过”就算学会。只有隔天仍能答对，并能无翻译、无注音读懂文章，才会计入阶段能力。</p>
        </div>
        <div className={`${styles.levelSummary} glassCard`}>
          <small>当前训练级别</small>
          <strong>{currentLevel === 'foundation' ? '入门 · N5 素材' : currentLevel}</strong>
          <span>{readiness.ready ? '五项能力已达标' : '继续补齐未达标能力'}</span>
        </div>
      </section>

      <section className={`${styles.readinessCard} glassCard`} aria-label="阶段能力仪表盘">
        <header>
          <div>
            <span className="chip badgePeach">阶段毕业标准</span>
            <h2>五项同时达标，才算真的学会这一阶段</h2>
          </div>
          <span className={readiness.ready ? styles.ready : styles.notReady}>
            {readiness.ready ? <CheckCircle2 size={17} /> : <BrainCircuit size={17} />}
            {readiness.ready ? '已达标' : '训练中'}
          </span>
        </header>
        <div className={styles.dimensionGrid}>
          {readiness.dimensions.map((item) => {
            const ratio = item.target === 0 ? 1 : Math.min(item.value / item.target, 1)
            return <article key={item.id}>
              <div><span>{item.label}</span><strong>{item.value}/{item.target}{item.id === 'speed' ? ' 字/分' : ''}</strong></div>
              <i><b style={{ width: `${ratio * 100}%` }} /></i>
            </article>
          })}
        </div>
      </section>

      <nav className={styles.tabs} aria-label="能力训练类型">
        {tabs.map((item) => <button
          key={item.id}
          type="button"
          className={tab === item.id ? styles.activeTab : ''}
          onClick={() => { setTab(item.id); resetReading(false) }}
        >
          <strong>{item.label}</strong><small>{item.note}</small>
        </button>)}
      </nav>

      {tab === 'reading' ? (
        <section className={`${styles.studyCard} glassCard`} data-testid="reading-practice">
          {passage ? <>
            <header className={styles.studyHeader}>
              <div><small>{passage.level} 分级阅读</small><h2>{passage.title}</h2></div>
              <button className="softButton" type="button" onClick={() => speakJapanese(passage.text)}><Volume2 size={18} />听原文</button>
            </header>
            <div className={styles.readingText} lang="ja">{passage.text}</div>
            <div className={styles.aidActions}>
              <button type="button" className="softButton" onClick={() => { setShowReading((value) => !value); setUsedReadingAid(true) }}>
                <Languages size={17} />{showReading ? '收起读音' : '查看读音'}
              </button>
              <button type="button" className="softButton" onClick={() => { setShowTranslation((value) => !value); setUsedTranslationAid(true) }}>
                <BookOpenText size={17} />{showTranslation ? '收起翻译' : '查看中文'}
              </button>
              <small>查看任何辅助后，本次仍可练习，但不计入“无辅助阅读”。</small>
            </div>
            {showReading ? <p className={styles.aidPanel}>{passage.reading}</p> : null}
            {showTranslation ? <p className={styles.aidPanel}>{passage.translationZh}</p> : null}
            <div className={styles.readingQuestions}>
              {passage.questions.map((question, questionIndex) => <fieldset key={question.prompt} disabled={Boolean(readingResult)}>
                <legend>{questionIndex + 1}. {question.prompt}</legend>
                {question.options.map((option, optionIndex) => <label key={option}>
                  <input
                    type="radio"
                    name={`reading-${passage.id}-${questionIndex}`}
                    checked={readingAnswers[questionIndex] === optionIndex}
                    onChange={() => setReadingAnswers((answers) => answers.map((answer, index) => index === questionIndex ? optionIndex : answer))}
                  />
                  <span>{option}</span>
                </label>)}
                {readingResult ? <p>{question.explanation}</p> : null}
              </fieldset>)}
            </div>
            {readingResult ? <div className={readingResult.counts ? styles.passResult : styles.practiceResult}>
              <strong>{Math.round(readingResult.accuracy * 100)}% 正确 · {readingResult.speed} 字/分</strong>
              <span>{readingResult.counts ? '本次已计入无辅助阅读能力。' : '本次是辅助练习；达到 80% 且不看读音和翻译才计入能力。'}</span>
              <button className="softButton" type="button" onClick={() => resetReading(true)}><RotateCcw size={17} />继续一篇</button>
            </div> : <button
              className="softButton primaryButton"
              type="button"
              disabled={readingAnswers.some((answer) => answer === null)}
              onClick={() => void submitReading()}
            >提交理解检测<ChevronRight size={18} /></button>}
            <Link className={styles.originalLink} to="/notes"><BookOpenText size={18} /><span><strong>已经有想读的日语原文？</strong><small>进入原文阅读器，粘贴任意文章逐句解析</small></span><ChevronRight size={18} /></Link>
          </> : <p>当前级别的阅读材料正在准备中。</p>}
        </section>
      ) : (
        <section className={`${styles.studyCard} glassCard`} data-testid="literacy-practice">
          {loading ? <div className={styles.loading}><LoaderCircle className={styles.spin} /><strong>正在准备全中文学习内容…</strong></div> : null}
          {loadError ? <div className={styles.loading}><strong>{loadError}</strong><button className="softButton" onClick={() => setReloadKey((key) => key + 1)}>重新加载</button></div> : null}
          {!loading && !loadError && currentItem ? <>
            <header className={styles.studyHeader}>
              <div><small>{kindLabels[tab]} · {questionIndex + 1}/{batch.length}</small><h2>{reverseQuestion ? '看到中文，想起日语' : '看到日语，说出意思'}</h2></div>
              <span className="chip badgeMint">{currentItem.level}</span>
            </header>
            <div className={styles.prompt} lang={reverseQuestion ? 'zh-CN' : 'ja'}>
              {reverseQuestion ? meanings[currentItem.id] : getItemFront(currentItem)}
              {!reverseQuestion && 'term' in currentItem ? <button aria-label="朗读词汇" onClick={() => speakJapanese(currentItem.term)}><Volume2 size={20} /></button> : null}
            </div>
            <div className={styles.optionGrid}>
              {options.map((option) => {
                const chosen = selectedOption === option
                const correct = option === correctOption
                const stateClass = selectedOption ? correct ? styles.correctOption : chosen ? styles.wrongOption : styles.dimOption : ''
                return <button key={option} type="button" className={stateClass} disabled={Boolean(selectedOption)} onClick={() => void chooseOption(option)}>{option}</button>
              })}
            </div>
            {selectedOption ? <div className={styles.feedback}>
              <div><Sparkles size={20} /><strong>{selectedOption === correctOption ? '答对了' : `正确答案：${correctOption}`}</strong></div>
              <ItemDetail item={currentItem} meaningZh={meanings[currentItem.id]} />
              {questionIndex < batch.length - 1 ? <button className="softButton primaryButton" onClick={nextQuestion}>下一题<ChevronRight size={18} /></button> : <div className={styles.finishMessage}><strong>今日这一组已完成</strong><span>今天答对只是第一次编码；系统会在遗忘点再次提问，隔天仍答对才算稳定掌握。</span></div>}
            </div> : null}
          </> : null}
        </section>
      )}

      <footer className={styles.sourceNote}>
        课程词汇、语法与汉字资料来自开放学习资源，并经过产品训练规则重新组织。
        <a href="/curriculum/ATTRIBUTION.md" target="_blank" rel="noreferrer">查看来源与许可</a>
      </footer>
    </div>
  )
}

function ItemDetail({ item, meaningZh }: { item: CurriculumEntry; meaningZh: string }) {
  if ('term' in item) {
    const entry = item as VocabularyEntry
    return <div className={styles.detail}><span>读音</span><strong>{entry.reading || entry.term}</strong><p>{meaningZh}</p></div>
  }
  if ('character' in item) {
    const entry = item as KanjiEntry
    return <div className={styles.detail}><span>读音</span><strong>{[...entry.onReadings, ...entry.kunReadings].slice(0, 6).join(' · ') || '暂无读音'}</strong><p>{meaningZh} · {entry.strokeCount} 画</p></div>
  }
  const entry = item as GrammarEntry
  return <div className={styles.detail}><span>接续</span><strong>{localizeGrammarPattern(entry.formation)}</strong><p>{meaningZh}</p>{entry.examples[0] ? <blockquote><b>{entry.examples[0].ja}</b></blockquote> : null}</div>
}
