import Kuroshiro from 'kuroshiro'
import KuromojiAnalyzer from 'kuroshiro-analyzer-kuromoji'
import kuromoji, { type IpadicFeatures, type Tokenizer } from 'kuromoji'
import * as wanakana from 'wanakana'

import { grammarPatterns } from '../data/grammarPatterns'
import { videoLessons } from '../data/videoLessons'
import { vocabCards } from '../data/vocabCards'
import type { GrammarMatch, SavedNote, SentenceAnalysis, TokenAnalysis } from '../types'
import { hasJapaneseSpeechSupport } from './speech'

const meaningMap = new Map<string, string>()

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

let tokenizerPromise: Promise<Tokenizer<IpadicFeatures>> | null = null
let kuroshiroPromise: Promise<Kuroshiro | null> | null = null

function getTokenizer() {
  if (tokenizerPromise) {
    return tokenizerPromise
  }

  tokenizerPromise = new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: '/dict' }).build((error, tokenizer) => {
      if (error) {
        reject(error)
        return
      }
      resolve(tokenizer)
    })
  })

  return tokenizerPromise
}

async function getKuroshiro() {
  if (kuroshiroPromise) {
    return kuroshiroPromise
  }

  kuroshiroPromise = (async () => {
    try {
      const instance = new Kuroshiro()
      await instance.init(new KuromojiAnalyzer({ dictPath: '/dict' }))
      return instance
    } catch {
      return null
    }
  })()

  return kuroshiroPromise
}

function normalizePartOfSpeech(token: IpadicFeatures) {
  return [token.pos, token.pos_detail_1]
    .filter((item) => item && item !== '*')
    .join(' / ')
}

function resolveMeaning(surface: string, base: string, reading: string) {
  return (
    meaningMap.get(surface) ??
    meaningMap.get(base) ??
    meaningMap.get(reading) ??
    '暂未收录，可结合语境先记住'
  )
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
    romaji: wanakana.toRomaji(kana),
    partOfSpeech: normalizePartOfSpeech(token),
    meaningZh: resolveMeaning(token.surface_form, base, kana),
  }
}

function matchGrammar(text: string) {
  return grammarPatterns
    .filter((pattern) => text.includes(pattern.pattern))
    .map<GrammarMatch>((pattern) => ({
      ...pattern,
      matchedText: pattern.pattern,
    }))
}

function buildGloss(tokens: TokenAnalysis[], matches: GrammarMatch[]) {
  const coreWords = tokens
    .filter((token) => !token.partOfSpeech.includes('助詞') && !token.partOfSpeech.includes('記号'))
    .slice(0, 4)
    .map((token) => `${token.surface}(${token.meaningZh})`)

  const wordLine =
    coreWords.length > 0
      ? `大意可先抓这几个词：${coreWords.join(' / ')}。`
      : '这句话可以先从主干词和句尾语气入手理解。'

  const grammarLine =
    matches.length > 0
      ? `命中的语法重点：${matches.map((item) => item.label).join('、')}。`
      : '当前没有命中预置语法，但你仍然可以先记住关键词和句型节奏。'

  return `${wordLine}${grammarLine}`
}

function buildFallbackKana(tokens: TokenAnalysis[]) {
  return tokens.map((token) => token.kana || token.surface).join('')
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

  const tokenizer = await getTokenizer()
  const kuroshiro = await getKuroshiro()
  const tokens = tokenizer
    .tokenize(text)
    .filter((token) => token.surface_form.trim())
    .map(createToken)

  const grammarMatches = matchGrammar(text)
  const noteIds = savedNotes
    .filter((note) => note.input === text)
    .map((note) => note.id)

  const fallbackKana = buildFallbackKana(tokens)
  const kana =
    (await kuroshiro?.convert(text, { to: 'hiragana' }).catch(() => fallbackKana)) ??
    fallbackKana
  const romaji =
    (await kuroshiro
      ?.convert(text, { to: 'romaji', romajiSystem: 'passport' })
      .catch(() => wanakana.toRomaji(kana))) ?? wanakana.toRomaji(kana)

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
