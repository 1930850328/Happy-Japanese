import {
  BookOpenText,
  BrainCircuit,
  NotebookPen,
  Save,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react'
import { useEffect, useMemo, useState, useTransition } from 'react'

import { analyzeJapaneseText } from '../lib/textAnalysis'
import { speakJapanese } from '../lib/speech'
import { useAppStore } from '../store/useAppStore'
import type { SentenceAnalysis, TokenAnalysis } from '../types'
import styles from './NotesPage.module.css'

const starterText = '今日は日本語を勉強しています。もう一度お願いします。'

export function NotesPage() {
  const notes = useAppStore((state) => state.notes)
  const saveNoteEntry = useAppStore((state) => state.saveNoteEntry)
  const deleteNoteEntry = useAppStore((state) => state.deleteNoteEntry)
  const addSentenceToReview = useAppStore((state) => state.addSentenceToReview)
  const recordStudyEvent = useAppStore((state) => state.recordStudyEvent)

  const [input, setInput] = useState(starterText)
  const [analysis, setAnalysis] = useState<SentenceAnalysis | null>(null)
  const [draftNote, setDraftNote] = useState('')
  const [selectedToken, setSelectedToken] = useState<TokenAnalysis | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [analyzing, setAnalyzing] = useState(false)

  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [notes],
  )

  const runAnalysis = async () => {
    if (!input.trim()) {
      setError('先输入一句日语或一个单词，再开始解析。')
      return
    }

    setError('')
    setAnalyzing(true)

    try {
      const next = await analyzeJapaneseText(input, notes)
      startTransition(() => {
        setAnalysis(next)
        setSelectedToken(null)
      })

      if (next.grammarMatches.length > 0) {
        await recordStudyEvent({
          type: 'grammar',
          sourceId: `analysis:${next.input}`,
          title: next.input,
          dedupeKey: `grammar-analysis:${next.input}`,
        })
      }
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : '解析失败，请稍后再试。')
    } finally {
      setAnalyzing(false)
    }
  }

  useEffect(() => {
    void runAnalysis()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeLabel = selectedToken
    ? `当前准备记录单词「${selectedToken.surface}」`
    : '当前准备记录整句备注'

  const handleEdit = (id: string) => {
    const target = notes.find((item) => item.id === id)
    if (!target) {
      return
    }
    setEditingId(id)
    setInput(target.input)
    setDraftNote(target.note)
    setSelectedToken(
      target.analysisSnapshot?.tokens.find((token) => token.surface === target.tokenSurface) ?? null,
    )
    setAnalysis(target.analysisSnapshot ?? null)
  }

  const handleSave = async () => {
    const trimmed = draftNote.trim()
    if (!trimmed) {
      setError('备注内容还没有填写。')
      return
    }

    await saveNoteEntry({
      id: editingId ?? undefined,
      input: analysis?.input ?? input.trim(),
      note: trimmed,
      targetType: selectedToken ? 'word' : 'sentence',
      tokenSurface: selectedToken?.surface,
      analysisSnapshot: analysis ?? undefined,
    })

    if (selectedToken) {
      await recordStudyEvent({
        type: 'word',
        sourceId: selectedToken.surface,
        title: selectedToken.surface,
        dedupeKey: `word-note:${selectedToken.surface}`,
      })
    }

    setDraftNote('')
    setEditingId(null)
  }

  return (
    <div className={`${styles.page} fadeIn`}>
      <section className={styles.hero}>
        <div>
          <span className="chip badgePink">备注翻译工具</span>
          <h1 className="pageTitle">把“看懂一点”变成“记住一句”</h1>
          <p className="sectionIntro">
            粘贴任意日语句子或单词，立刻得到学习向解析、假名、罗马音和可编辑备注。
          </p>
        </div>
        <div className={`${styles.heroCard} glassCard`}>
          <div>
            <small>当前模式</small>
            <strong>{activeLabel}</strong>
          </div>
          <button className="softButton secondaryButton" onClick={() => setSelectedToken(null)}>
            <NotebookPen size={18} />
            记录整句
          </button>
        </div>
      </section>

      <section className={styles.workspace}>
        <div className={`${styles.inputPanel} glassCard`}>
          <div className={styles.panelHeader}>
            <div>
              <span className="chip badgePeach">输入</span>
              <h2>贴一句，马上拆给你看</h2>
            </div>
            <button
              className="softButton primaryButton"
              onClick={() => void runAnalysis()}
              disabled={analyzing || isPending}
            >
              <Sparkles size={18} />
              {analyzing || isPending ? '解析中…' : '立即解析'}
            </button>
          </div>
          <textarea
            className={styles.textarea}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="例如：すみません、もう一度お願いします。"
          />
          <div className={styles.inlineActions}>
            <button
              className="softButton"
              onClick={() => {
                if (analysis?.input) {
                  speakJapanese(analysis.input)
                }
              }}
            >
              <Volume2 size={18} />
              整句发音
            </button>
            <button
              className="softButton"
              onClick={() => {
                if (analysis?.input) {
                  void addSentenceToReview(analysis.input, analysis.kana, analysis.glossZh)
                }
              }}
            >
              <BrainCircuit size={18} />
              加入复习
            </button>
          </div>
          {error ? <p className={styles.error}>{error}</p> : null}
        </div>

        <div className={styles.resultColumn}>
          <div className={`${styles.resultPanel} glassCard`}>
            <div className={styles.panelHeader}>
              <div>
                <span className="chip badgeMint">解析结果</span>
                <h2>从读音到语法，一眼抓主干</h2>
              </div>
            </div>

            {analysis ? (
              <>
                <div className={styles.summaryGrid}>
                  <article>
                    <small>假名</small>
                    <strong>{analysis.kana || '加载中'}</strong>
                  </article>
                  <article>
                    <small>罗马音</small>
                    <strong>{analysis.romaji || '加载中'}</strong>
                  </article>
                </div>

                <div className={styles.gloss}>
                  <h3>学习向中文提示</h3>
                  <p>{analysis.glossZh}</p>
                </div>

                <div className={styles.grammarList}>
                  {(analysis.grammarMatches.length > 0 ? analysis.grammarMatches : []).map((item) => (
                    <article key={item.id}>
                      <span className="chip badgePink">{item.label}</span>
                      <p>{item.explanationZh}</p>
                    </article>
                  ))}
                  {analysis.grammarMatches.length === 0 ? (
                    <article>
                      <span className="chip">暂未命中预设语法</span>
                      <p>先记关键词和句尾语气就很好，后续也能手动补备注。</p>
                    </article>
                  ) : null}
                </div>

                <div className={styles.tokenGrid}>
                  {analysis.tokens.map((token) => (
                    <button
                      key={token.id}
                      className={`${styles.tokenCard} ${
                        selectedToken?.id === token.id ? styles.tokenCardActive : ''
                      }`}
                      onClick={() => setSelectedToken(token)}
                    >
                      <div className={styles.tokenTop}>
                        <strong>{token.surface}</strong>
                        <span>{token.partOfSpeech}</span>
                      </div>
                      <span className={styles.tokenReading}>
                        {token.kana} · {token.romaji}
                      </span>
                      <p>{token.meaningZh}</p>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="sectionIntro">解析结果会显示在这里。</p>
            )}
          </div>

          <div className={`${styles.notePanel} glassCard`}>
            <div className={styles.panelHeader}>
              <div>
                <span className="chip badgePeach">本地备注</span>
                <h2>留下你自己的记忆抓手</h2>
              </div>
            </div>
            <textarea
              className={styles.noteTextarea}
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value)}
              placeholder="例如：这个句尾像是在礼貌地请求别人再说一遍。"
            />
            <div className={styles.inlineActions}>
              <button className="softButton primaryButton" onClick={() => void handleSave()}>
                <Save size={18} />
                {editingId ? '更新备注' : '保存备注'}
              </button>
              {editingId ? (
                <button
                  className="softButton"
                  onClick={() => {
                    setEditingId(null)
                    setDraftNote('')
                  }}
                >
                  取消编辑
                </button>
              ) : null}
            </div>

            <div className={styles.savedList}>
              {sortedNotes.map((note) => (
                <article key={note.id} className={styles.savedItem}>
                  <header>
                    <div>
                      <span className="chip">
                        {note.targetType === 'word' ? `单词 · ${note.tokenSurface}` : '整句备注'}
                      </span>
                      <strong>{note.input}</strong>
                    </div>
                    <div className={styles.savedActions}>
                      <button onClick={() => handleEdit(note.id)}>编辑</button>
                      <button onClick={() => void deleteNoteEntry(note.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </header>
                  <p>{note.note}</p>
                </article>
              ))}
              {sortedNotes.length === 0 ? (
                <div className={styles.emptyState}>
                  <BookOpenText size={26} />
                  <p>还没有保存备注。先挑一句最想记住的话开始吧。</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
