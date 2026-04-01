import kuromoji, { type IpadicFeatures, type Tokenizer } from 'kuromoji'
import * as wanakana from 'wanakana'

import { grammarPatterns } from '../data/grammarPatterns'
import { videoLessons } from '../data/videoLessons'
import { vocabCards } from '../data/vocabCards'
import type { GrammarMatch, SavedNote, SentenceAnalysis, TokenAnalysis } from '../types'
import { hasJapaneseSpeechSupport } from './speech'

const meaningMap = new Map<string, string>()
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

for (const card of vocabCards) {
  meaningMap.set(card.term, card.meaningZh)
  meaningMap.set(card.reading, card.meaningZh)
}

for (const lesson of videoLessons) {
  for (const point of lesson.knowledgePoints) {
    meaningMap.set(point.expression, point.meaningZh)
    meaningMap.set(point.reading, point.meaningZh)
  }
}

let tokenizerPromise: Promise<Tokenizer<IpadicFeatures> | null> | null = null

function getTokenizer() {
  if (tokenizerPromise) {
    return tokenizerPromise
  }

  tokenizerPromise = new Promise((resolve) => {
    kuromoji.builder({ dicPath: '/dict' }).build((error, tokenizer) => {
      if (error || !tokenizer) {
        resolve(null)
        return
      }

      resolve(tokenizer)
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

export function hasReliableMeaning(meaningZh: string) {
  return Boolean(meaningZh && meaningZh.trim() && meaningZh !== UNKNOWN_MEANING)
}

function createToken(token: IpadicFeatures): TokenAnalysis {
  const reading = token.reading && token.reading !== '*' ? token.reading : token.surface_form
  const kana = wanakana.toHiragana(reading)
  const base = token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form

  return {
    id: crypto.randomUUID(),
    surface: token.surface_form,
    base,
    reading,
    kana,
    romaji: wanakana.toRomaji(kana || token.surface_form),
    partOfSpeech: normalizePartOfSpeech(token),
    meaningZh: resolveMeaning(token.surface_form, base, reading, kana),
  }
}

function createFallbackTokens(text: string) {
  const chunks =
    text.match(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]+|[A-Za-z]+|\d+|[^\s]/gu,
    ) ?? [text]

  return chunks
    .filter((chunk) => chunk.trim())
    .map<TokenAnalysis>((chunk) => {
      const kana = wanakana.toHiragana(chunk)
      return {
        id: crypto.randomUUID(),
        surface: chunk,
        base: chunk,
        reading: chunk,
        kana,
        romaji: wanakana.toRomaji(kana || chunk),
        partOfSpeech: '未分类',
        meaningZh: resolveMeaning(chunk, chunk, chunk, kana),
      }
    })
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
  const joined = tokens
    .map((token) => token.romaji || wanakana.toRomaji(token.kana || token.surface))
    .filter(Boolean)
    .join(' ')

  return joined || wanakana.toRomaji(kana)
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
