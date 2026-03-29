import { LibraryBig, Search, Sparkles, Volume2 } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'

import { vocabCards } from '../data/vocabCards'
import { speakJapanese } from '../lib/speech'
import { useAppStore } from '../store/useAppStore'
import type { VocabCard } from '../types'
import styles from './VocabPage.module.css'

export function VocabPage() {
  const vocabProgress = useAppStore((state) => state.vocabProgress)
  const touchVocab = useAppStore((state) => state.touchVocab)
  const addVocabToReview = useAppStore((state) => state.addVocabToReview)
  const addThemeBatchToReview = useAppStore((state) => state.addThemeBatchToReview)

  const [theme, setTheme] = useState('全部')
  const [search, setSearch] = useState('')
  const [flippedIds, setFlippedIds] = useState<Record<string, boolean>>({})

  const deferredSearch = useDeferredValue(search)
  const themes = useMemo(() => ['全部', ...new Set(vocabCards.map((item) => item.theme))], [])

  const filteredCards = useMemo(() => {
    return vocabCards.filter((card) => {
      const matchesTheme = theme === '全部' || card.theme === theme
      const needle = deferredSearch.trim().toLowerCase()
      const matchesSearch =
        !needle ||
        [card.term, card.reading, card.romaji, card.meaningZh].some((field) =>
          field.toLowerCase().includes(needle),
        )
      return matchesTheme && matchesSearch
    })
  }, [deferredSearch, theme])

  const themeStats = useMemo(() => {
    return themes
      .filter((item) => item !== '全部')
      .map((item) => {
        const themeCards = vocabCards.filter((card) => card.theme === item)
        const mastered = themeCards.filter((card) => vocabProgress[card.id]?.mastered).length
        return { theme: item, total: themeCards.length, mastered }
      })
  }, [themes, vocabProgress])

  const masteredCount = Object.values(vocabProgress).filter((item) => item.mastered).length

  const handleFlip = (card: VocabCard) => {
    setFlippedIds((state) => ({
      ...state,
      [card.id]: !state[card.id],
    }))
    void touchVocab(card)
  }

  return (
    <div className={`${styles.page} fadeIn`}>
      <section className={styles.hero}>
        <div>
          <span className="chip badgePeach">高频速记库</span>
          <h1 className="pageTitle">一张卡片只记一个最值得脱口而出的词</h1>
          <p className="sectionIntro">
            先翻、再听、再加入复习。按主题把高频词变成熟面孔，会比死背轻松很多。
          </p>
        </div>

        <div className={`${styles.summary} glassCard`}>
          <article>
            <small>总词量</small>
            <strong>{vocabCards.length}</strong>
          </article>
          <article>
            <small>已掌握</small>
            <strong>{masteredCount}</strong>
          </article>
          <article>
            <small>当前主题</small>
            <strong>{theme}</strong>
          </article>
        </div>
      </section>

      <section className={`${styles.controls} glassCard`}>
        <label className={styles.searchBox}>
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索日文、假名、罗马音或中文释义"
          />
        </label>
        <div className={styles.themeRow}>
          {themes.map((item) => (
            <button
              key={item}
              className={`${styles.themeChip} ${theme === item ? styles.themeChipActive : ''}`}
              onClick={() => setTheme(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <button
          className="softButton secondaryButton"
          onClick={() =>
            void addThemeBatchToReview(
              filteredCards.filter((card) => !vocabProgress[card.id]?.reviewAdded).slice(0, 6),
            )
          }
        >
          <Sparkles size={18} />
          当前筛选一键加入复习
        </button>
      </section>

      <section className={styles.statsGrid}>
        {themeStats.map((item) => (
          <article key={item.theme} className={`${styles.statCard} glassCard`}>
            <header>
              <span className="chip badgeMint">{item.theme}</span>
              <strong>
                {item.mastered}/{item.total}
              </strong>
            </header>
            <div className={styles.progressBar}>
              <div style={{ width: `${(item.mastered / item.total) * 100 || 0}%` }} />
            </div>
          </article>
        ))}
      </section>

      <section className={styles.grid}>
        {filteredCards.map((card) => {
          const progress = vocabProgress[card.id]
          const flipped = !!flippedIds[card.id]
          return (
            <article
              key={card.id}
              className={`${styles.card} ${flipped ? styles.cardFlipped : ''}`}
              onClick={() => handleFlip(card)}
            >
              <div className={styles.cardFace}>
                <header>
                  <span className="chip">{card.theme}</span>
                  <span className="chip badgePink">{card.level}</span>
                </header>
                <div className={styles.termBlock}>
                  <strong>{card.term}</strong>
                  <span>{card.reading}</span>
                  <small>{card.romaji}</small>
                </div>
                <p>{flipped ? card.meaningZh : '点卡片翻面，看释义和例句'}</p>

                {flipped ? (
                  <div className={styles.backContent}>
                    <p className={styles.example}>{card.exampleJa}</p>
                    <p className={styles.exampleZh}>{card.exampleZh}</p>
                    <p className={styles.tip}>{card.memoryTip}</p>
                  </div>
                ) : null}

                <footer>
                  <button
                    className="softButton"
                    onClick={(event) => {
                      event.stopPropagation()
                      speakJapanese(card.term)
                    }}
                  >
                    <Volume2 size={18} />
                    发音
                  </button>
                  <button
                    className="softButton"
                    onClick={(event) => {
                      event.stopPropagation()
                      void addVocabToReview(card)
                    }}
                  >
                    <LibraryBig size={18} />
                    {progress?.reviewAdded ? '已入复习' : '加入复习'}
                  </button>
                  <button
                    className={`softButton ${progress?.mastered ? 'secondaryButton' : 'primaryButton'}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      void touchVocab(card, true)
                    }}
                  >
                    {progress?.mastered ? '已掌握' : '标记掌握'}
                  </button>
                </footer>
              </div>
            </article>
          )
        })}
      </section>
    </div>
  )
}
