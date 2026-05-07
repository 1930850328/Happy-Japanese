import { createRequire } from 'node:module'
import { dirname } from 'node:path'

import { translate } from 'google-translate-api-x'
import { toHiragana, toRomaji } from 'wanakana'

import { grammarPatterns } from './resources/grammar.mjs'

const require = createRequire(import.meta.url)
const kuromoji = require('kuromoji')
const dictPath = dirname(require.resolve('kuromoji/dict/base.dat.gz'))

let tokenizerPromise

function getTokenizer() {
  tokenizerPromise ??= new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: dictPath }).build((error, tokenizer) => {
      if (error) {
        reject(error)
        return
      }
      resolve(tokenizer)
    })
  })

  return tokenizerPromise
}

function hasJapaneseText(input) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\u3400-\u9fff]/u.test(input)
}

function isUsefulToken(token) {
  const surface = token.surface_form?.trim() ?? ''
  const base = token.basic_form && token.basic_form !== '*' ? token.basic_form.trim() : surface
  const pos = token.pos ?? ''

  if (!surface || !base || base.length < 2 || base.length > 8 || !hasJapaneseText(base)) {
    return false
  }
  if (/助詞|助動詞|記号|接頭詞/.test(pos)) {
    return false
  }
  if (token.pos_detail_1 === '非自立' || token.pos_detail_2 === '非自立') {
    return false
  }

  return /名詞|動詞|形容詞|副詞/.test(pos)
}

function tokenScore(token) {
  const pos = token.pos ?? ''
  let score = 1
  if (/動詞/.test(pos)) {
    score += 5
  } else if (/名詞|形容詞/.test(pos)) {
    score += 4
  } else if (/副詞/.test(pos)) {
    score += 3
  }
  if (/[\u3400-\u9fff]/u.test(token.surface_form ?? '')) {
    score += 1
  }
  return score
}

const translationCache = new Map()

const exactTranslationGlossary = new Map([
  ['映画', '电影'],
  ['公開', '公开'],
  ['予定', '预定'],
  ['公開予定', '计划公开'],
  ['名前', '名字'],
  ['保存', '保存'],
  ['開く', '打开'],
  ['基本', '基本'],
  ['変更', '更改'],
  ['選択', '选择'],
  ['思う', '认为'],
  ['今日', '今天'],
  ['皆さん', '大家'],
  ['ご存じ', '知道'],
  ['増える', '增加'],
  ['憎悪', '憎恨'],
  ['協力', '合作'],
  ['支援', '支援'],
  ['団体', '团体'],
  ['話し合い', '讨论'],
  ['警察', '警察'],
  ['報告', '报告'],
  ['事例', '案例'],
  ['挙げる', '提出'],
])

function normalizeKnownTranslationTerms(input) {
  return input
    .replace(/班(?:多里|德里|多利|多莉)(?:·|・|\s*)阿(?:贝|貝|维|維|韦|韋)?(?:穆什卡|穆希卡|维穆吉卡|維穆吉卡)/g, 'BanG Dream! Ave Mujica')
    .replace(/班(?:多里|德里|多利|多莉)/g, 'BanG Dream!')
    .replace(/阿(?:贝|貝|维|維|韦|韋)?(?:穆什卡|穆希卡|维穆吉卡|維穆吉卡)/g, 'Ave Mujica')
    .replace(/普里马(?:奥|澳|欧|歐)(?:滚筒|罗拉|羅拉|萝拉|蘿拉)/g, 'prima aurora')
    .replace(/映画/g, '电影')
    .replace(/公開予定/g, '计划公开')
    .replace(/公開/g, '公开')
    .replace(/予定/g, '预定')
}

async function translateToChinese(input) {
  const key = input.trim()
  if (!key) {
    return ''
  }
  if (exactTranslationGlossary.has(key)) {
    return exactTranslationGlossary.get(key)
  }
  if (translationCache.has(key)) {
    return translationCache.get(key)
  }

  const result = await translate(key, { to: 'zh-CN' })
  const text = typeof result.text === 'string' ? normalizeKnownTranslationTerms(result.text.trim()) : ''
  if (!text) {
    throw new Error(`Translation returned empty text for: ${key}`)
  }

  translationCache.set(key, text)
  return text
}

function matchGrammar(text) {
  return grammarPatterns.filter((pattern) => text.includes(pattern.pattern)).slice(0, 2)
}

function sentenceKana(tokens, fallback) {
  const value = tokens
    .map((token) => {
      if (token.reading && token.reading !== '*') {
        return toHiragana(token.reading)
      }
      return token.surface_form ?? ''
    })
    .join('')
    .trim()

  return value || toHiragana(fallback)
}

function tokenBase(token) {
  return token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form
}

function tokenReading(tokenizer, token) {
  const base = tokenBase(token)
  if (base && base !== token.surface_form && hasJapaneseText(base)) {
    return sentenceKana(tokenizer.tokenize(base), base)
  }

  return token.reading && token.reading !== '*'
    ? toHiragana(token.reading)
    : toHiragana(token.surface_form)
}

async function buildWordPoint(tokenizer, token, sentenceJa, sentenceZh) {
  const surface = token.surface_form
  const base = tokenBase(token)
  const reading = tokenReading(tokenizer, token)
  const meaningZh = await translateToChinese(base)

  return {
    id: `word:${base}`,
    kind: 'word',
    expression: base,
    reading,
    meaningZh,
    partOfSpeech: token.pos ?? '未分类',
    explanationZh:
      surface === base
        ? `${base} 在这句里更接近“${meaningZh}”。`
        : `${surface} 是 ${base} 的句中形式，这里更接近“${meaningZh}”。`,
    exampleJa: sentenceJa,
    exampleZh: sentenceZh,
  }
}

export async function buildStudyData(cues) {
  const tokenizer = await getTokenizer()
  const knowledgeMap = new Map()
  const segments = []

  for (const cue of cues) {
    const jaText = cue.jaText.trim()
    if (!jaText) {
      continue
    }

    const zhText = cue.zhText?.trim() || await translateToChinese(jaText)
    const tokens = tokenizer.tokenize(jaText)
    const kana = sentenceKana(tokens, jaText)
    const focusTermIds = []

    for (const grammar of matchGrammar(jaText)) {
      const id = `grammar:${grammar.id}`
      if (!knowledgeMap.has(id)) {
        knowledgeMap.set(id, {
          id,
          kind: 'grammar',
          expression: grammar.label,
          reading: grammar.label,
          meaningZh: grammar.meaningZh,
          partOfSpeech: '语法',
          explanationZh: grammar.explanationZh,
          exampleJa: jaText,
          exampleZh: zhText,
        })
      }
      focusTermIds.push(id)
    }

    const wordCandidates = tokens
      .filter(isUsefulToken)
      .sort((left, right) => tokenScore(right) - tokenScore(left))
      .slice(0, 2)

    for (const token of wordCandidates) {
      const base = tokenBase(token)
      const id = `word:${base}`
      if (!knowledgeMap.has(id)) {
        try {
          knowledgeMap.set(id, await buildWordPoint(tokenizer, token, jaText, zhText))
        } catch {
          continue
        }
      }
      if (knowledgeMap.has(id)) {
        focusTermIds.push(id)
      }
    }

    segments.push({
      startMs: cue.startMs,
      endMs: cue.endMs,
      ja: jaText,
      kana,
      romaji: toRomaji(kana),
      zh: zhText,
      focusTermIds: [...new Set(focusTermIds)],
    })
  }

  return {
    segments,
    knowledgePoints: [...knowledgeMap.values()],
  }
}
