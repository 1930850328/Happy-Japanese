import type { IpadicFeatures, Tokenizer } from 'kuromoji'
import * as wanakana from 'wanakana'

import { grammarPatterns } from '../data/grammarPatterns'
import { videoLessons } from '../data/videoLessons'
import { vocabCards } from '../data/vocabCards'
import type { GrammarMatch, SavedNote, SentenceAnalysis, TokenAnalysis } from '../types'
import { hasJapaneseSpeechSupport } from './speech'

const meaningMap = new Map<string, string>()
const readingMap = new Map<string, string>()
export const UNKNOWN_MEANING = '词义待补充'
const heuristicMeaningMap = new Map<string, string>([
  ['する', '做 / 进行'],
  ['なる', '变成 / 成为'],
  ['ある', '有 / 存在'],
  ['いる', '在 / 存在'],
  ['行く', '去'],
  ['来る', '来'],
  ['帰る', '回来 / 回去'],
  ['見る', '看'],
  ['聞く', '听'],
  ['言う', '说'],
  ['思う', '想 / 觉得'],
  ['知る', '知道'],
  ['分かる', '明白 / 懂'],
  ['受ける', '接受 / 承受'],
  ['降りる', '下来 / 降落'],
  ['出る', '出去 / 出现'],
  ['入る', '进入'],
  ['食べる', '吃'],
  ['飲む', '喝'],
  ['待つ', '等'],
  ['使う', '使用'],
  ['できる', '能 / 做到'],
])
const commonReadingEntries: Array<[string, string]> = [
  ['日本語', 'にほんご'],
  ['勉強', 'べんきょう'],
  ['今日', 'きょう'],
  ['一度', 'いちど'],
  ['お願い', 'おねがい'],
  ['お願いします', 'おねがいします'],
  ['駅', 'えき'],
  ['どこ', 'どこ'],
  ['です', 'です'],
  ['ます', 'ます'],
  ['ません', 'ません'],
  ['は', 'わ'],
  ['へ', 'え'],
  ['を', 'お'],
  ['が', 'が'],
  ['に', 'に'],
  ['で', 'で'],
  ['と', 'と'],
  ['も', 'も'],
  ['の', 'の'],
  ['か', 'か'],
  ['ね', 'ね'],
  ['よ', 'よ'],
]

const punctuationRomajiMap = new Map<string, string>([
  ['、', ','],
  ['。', '.'],
  ['，', ','],
  ['．', '.'],
  ['？', '?'],
  ['！', '!'],
])

function registerReading(surface: string, reading: string) {
  const normalizedSurface = surface.trim()
  const normalizedReading = wanakana.toHiragana(reading.trim())
  if (!normalizedSurface || !normalizedReading) {
    return
  }

  readingMap.set(normalizedSurface, normalizedReading)
}

for (const card of vocabCards) {
  meaningMap.set(card.term, card.meaningZh)
  meaningMap.set(card.reading, card.meaningZh)
  registerReading(card.term, card.reading)
  registerReading(card.reading, card.reading)
}

for (const lesson of videoLessons) {
  for (const point of lesson.knowledgePoints) {
    meaningMap.set(point.expression, point.meaningZh)
    meaningMap.set(point.reading, point.meaningZh)
    registerReading(point.expression, point.reading)
    registerReading(point.reading, point.reading)
  }
}

for (const [surface, reading] of commonReadingEntries) {
  registerReading(surface, reading)
}

let tokenizerPromise: Promise<Tokenizer<IpadicFeatures> | null> | null = null

function getTokenizer() {
  if (typeof window !== 'undefined') {
    return Promise.resolve(null)
  }

  if (tokenizerPromise) {
    return tokenizerPromise
  }

  tokenizerPromise = new Promise((resolve) => {
    void import('kuromoji')
      .then((kuromojiModule) => {
        const kuromojiRuntime = kuromojiModule as typeof kuromojiModule & {
          default?: typeof kuromojiModule
        }
        const kuromojiBuilder = (kuromojiRuntime.default ?? kuromojiRuntime).builder
        kuromojiBuilder({ dicPath: '/dict' }).build((error, tokenizer) => {
          if (error || !tokenizer) {
            resolve(null)
            return
          }

          resolve(tokenizer)
        })
      })
      .catch(() => {
        resolve(null)
      })
  })

  return tokenizerPromise
}

function normalizePartOfSpeech(token: IpadicFeatures) {
  const value = [token.pos, token.pos_detail_1]
    .filter((item) => item && item !== '*')
    .join(' / ')

  return value || '未分类'
}

function resolveMeaning(surface: string, base: string, reading: string, kana: string) {
  const resolved =
    meaningMap.get(surface) ??
    meaningMap.get(base) ??
    meaningMap.get(reading) ??
    meaningMap.get(kana)

  if (resolved) {
    return resolved
  }

  const heuristic = heuristicMeaningMap.get(base) ?? heuristicMeaningMap.get(surface)
  if (heuristic) {
    return heuristic
  }

  const hanGuess = (base.match(/[\p{Script=Han}]+/gu) || []).join('')
  if (hanGuess) {
    return hanGuess
  }

  return UNKNOWN_MEANING
}

function resolveReading(surface: string, reading?: string) {
  const normalizedReading = reading && reading !== '*' ? wanakana.toHiragana(reading) : ''
  return readingMap.get(surface) || normalizedReading || surface
}

function resolveRomaji(surface: string, kana: string) {
  const punctuation = punctuationRomajiMap.get(surface)
  if (punctuation) {
    return punctuation
  }

  return wanakana.toRomaji(kana || surface)
}

export function hasReliableMeaning(meaningZh: string) {
  return Boolean(meaningZh && meaningZh.trim() && meaningZh !== UNKNOWN_MEANING)
}

function createToken(token: IpadicFeatures): TokenAnalysis {
  const reading = resolveReading(token.surface_form, token.reading)
  const kana = wanakana.toHiragana(reading)
  const base = token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form

  return {
    id: crypto.randomUUID(),
    surface: token.surface_form,
    base,
    reading,
    kana,
    romaji: resolveRomaji(token.surface_form, kana),
    partOfSpeech: normalizePartOfSpeech(token),
    meaningZh: resolveMeaning(token.surface_form, base, reading, kana),
  }
}

function createFallbackToken(surface: string): TokenAnalysis {
  const reading = resolveReading(surface)
  const kana = wanakana.toHiragana(reading)
  const isPunctuation = punctuationRomajiMap.has(surface) || /^[,.!?]$/.test(surface)

  return {
    id: crypto.randomUUID(),
    surface,
    base: surface,
    reading,
    kana,
    romaji: isPunctuation ? punctuationRomajiMap.get(surface) ?? surface : resolveRomaji(surface, kana),
    partOfSpeech: isPunctuation ? '符号' : '未分类',
    meaningZh: resolveMeaning(surface, surface, reading, kana),
  }
}

function getFallbackLexicon() {
  return [...readingMap.keys()]
    .filter((item) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]/u.test(item))
    .sort((a, b) => b.length - a.length)
}

function createFallbackTokens(text: string) {
  const lexicon = getFallbackLexicon()
  const tokens: TokenAnalysis[] = []
  let index = 0

  while (index < text.length) {
    const rest = text.slice(index)
    const whitespace = rest.match(/^\s+/u)?.[0]
    if (whitespace) {
      index += whitespace.length
      continue
    }

    const ascii = rest.match(/^[A-Za-z0-9]+/u)?.[0]
    if (ascii) {
      tokens.push(createFallbackToken(ascii))
      index += ascii.length
      continue
    }

    const matched = lexicon.find((item) => rest.startsWith(item))
    if (matched) {
      tokens.push(createFallbackToken(matched))
      index += matched.length
      continue
    }

    const [char] = Array.from(rest)
    tokens.push(createFallbackToken(char))
    index += char.length
  }

  return tokens
}

function matchGrammar(text: string) {
  return grammarPatterns
    .filter((pattern) => text.includes(pattern.pattern))
    .map<GrammarMatch>((pattern) => ({
      ...pattern,
      matchedText: pattern.pattern,
    }))
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function isUsefulGlossToken(token: TokenAnalysis) {
  return (
    !token.partOfSpeech.includes('助词') &&
    !token.partOfSpeech.includes('助动词') &&
    !token.partOfSpeech.includes('符号')
  )
}

function pickSurfaceKeywords(tokens: TokenAnalysis[]) {
  return uniqueValues(
    tokens
      .filter(isUsefulGlossToken)
      .map((token) => token.surface.trim())
      .filter((surface) => surface.length >= 2),
  ).slice(0, 4)
}

function buildGloss(tokens: TokenAnalysis[], matches: GrammarMatch[]) {
  const keywordMeanings = uniqueValues(
    tokens
      .filter(isUsefulGlossToken)
      .map((token) => token.meaningZh)
      .filter(hasReliableMeaning),
  ).slice(0, 4)
  const keywordSurfaces = pickSurfaceKeywords(tokens)
  const grammarHints = uniqueValues(
    matches.map((item) => `${item.pattern} 表示“${item.meaningZh}”`),
  ).slice(0, 2)

  if (keywordMeanings.length >= 2 && grammarHints.length > 0) {
    return `大意围绕“${keywordMeanings.join('、')}”展开，句里 ${grammarHints[0]}。`
  }

  if (keywordMeanings.length >= 2) {
    return `大意围绕“${keywordMeanings.join('、')}”展开。`
  }

  if (keywordSurfaces.length > 0 && grammarHints.length > 0) {
    return `这句在说「${keywordSurfaces.join(' / ')}」，句里 ${grammarHints[0]}。`
  }

  if (keywordSurfaces.length > 0) {
    return `这句主要围绕「${keywordSurfaces.join(' / ')}」展开。`
  }

  if (grammarHints.length > 0) {
    return `这句里 ${grammarHints[0]}。`
  }

  return '这句需要结合上下文来理解。'
}

function buildSentenceKana(text: string, tokens: TokenAnalysis[]) {
  const joined = tokens.map((token) => token.kana || token.surface).join('')
  return joined || wanakana.toHiragana(text)
}

function buildSentenceRomaji(tokens: TokenAnalysis[], kana: string) {
  const joined = tokens.reduce((acc, token) => {
    const value = token.romaji || resolveRomaji(token.surface, token.kana)
    if (!value) {
      return acc
    }

    if (/^[,.!?]$/.test(value)) {
      return `${acc.trimEnd()}${value} `
    }

    return `${acc}${acc.trim() ? ' ' : ''}${value}`
  }, '')

  return joined.trim() || wanakana.toRomaji(kana)
}

async function tokenize(text: string) {
  try {
    const tokenizer = await getTokenizer()
    if (!tokenizer) {
      return createFallbackTokens(text)
    }

    return tokenizer
      .tokenize(text)
      .filter((token) => token.surface_form.trim())
      .map(createToken)
  } catch {
    return createFallbackTokens(text)
  }
}

export async function analyzeJapaneseText(
  input: string,
  savedNotes: SavedNote[] = [],
): Promise<SentenceAnalysis> {
  const text = input.trim()
  if (!text) {
    return {
      input: '',
      tokens: [],
      kana: '',
      romaji: '',
      glossZh: '',
      grammarMatches: [],
      noteIds: [],
      audioSupport: hasJapaneseSpeechSupport(),
    }
  }

  const tokens = await tokenize(text)
  const grammarMatches = matchGrammar(text)
  const noteIds = savedNotes.filter((note) => note.input === text).map((note) => note.id)
  const kana = buildSentenceKana(text, tokens)
  const romaji = buildSentenceRomaji(tokens, kana)

  return {
    input: text,
    tokens,
    kana,
    romaji,
    glossZh: buildGloss(tokens, grammarMatches),
    grammarMatches,
    noteIds,
    audioSupport: hasJapaneseSpeechSupport(),
  }
}
