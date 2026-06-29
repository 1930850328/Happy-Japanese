import { grammarPatterns } from '../data/grammarPatterns'
import { vocabCards } from '../data/vocabCards'
import type {
  GrammarMatch,
  LyricLine,
  SongGrammarKnowledge,
  SongKnowledge,
  SongKnowledgeSource,
  SongWordKnowledge,
  StudyStage,
  TokenAnalysis,
  VocabCard,
} from '../types'
import { UNKNOWN_MEANING, hasReliableMeaning } from './textAnalysis'

const particleMeanings = new Map([
  ['は', '主题'],
  ['が', '主语'],
  ['を', '宾语'],
  ['に', '时间 / 方向'],
  ['へ', '方向'],
  ['で', '地点 / 方式'],
  ['と', '和 / 引用'],
  ['の', '的'],
  ['も', '也'],
  ['から', '从 / 因为'],
  ['まで', '到'],
  ['より', '比'],
  ['ね', '语气确认'],
  ['よ', '提醒语气'],
  ['か', '疑问'],
])

const stageRank: Record<StudyStage, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
}

const curatedVocabSource: SongKnowledgeSource = {
  kind: 'curated-vocab',
  label: '应用内精选词库',
}

const grammarRegistrySource: SongKnowledgeSource = {
  kind: 'grammar-registry',
  label: '应用内语法表',
}

const tokenizerSource: SongKnowledgeSource = {
  kind: 'tokenizer',
  label: '日语形态分析器',
}

const lyricContextSource: SongKnowledgeSource = {
  kind: 'lyric-context',
  label: '当前歌词上下文',
}

const heuristicSource: SongKnowledgeSource = {
  kind: 'heuristic',
  label: '学习启发式规则',
}

function normalizeKnowledgeKey(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[・･、。？！?!「」『』（）()[\]]/g, '')
}

function hasJapaneseText(input: string) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー々]/u.test(input)
}

function getVocabKeys(card: VocabCard) {
  return [card.term, card.reading, card.romaji].map(normalizeKnowledgeKey).filter(Boolean)
}

const vocabByKey = new Map<string, VocabCard>()

for (const card of vocabCards) {
  for (const key of getVocabKeys(card)) {
    if (!vocabByKey.has(key)) {
      vocabByKey.set(key, card)
    }
  }
}

function findCuratedVocab(token: TokenAnalysis) {
  const keys = [token.surface, token.base, token.reading, token.kana, token.romaji]
    .map(normalizeKnowledgeKey)
    .filter(Boolean)

  for (const key of keys) {
    const card = vocabByKey.get(key)
    if (card) return card
  }

  return null
}

function getParticleMeaning(token: TokenAnalysis) {
  return particleMeanings.get(token.surface) ?? particleMeanings.get(token.base)
}

function isGrammarFunctionToken(token: TokenAnalysis) {
  return /助詞|助動詞/u.test(token.partOfSpeech) || Boolean(getParticleMeaning(token))
}

function isPunctuationToken(token: TokenAnalysis) {
  return /符号|記号/u.test(token.partOfSpeech) || /^[\s,.!?。、！？…]+$/u.test(token.surface)
}

function getWordStage(token: TokenAnalysis, card: VocabCard | null): StudyStage {
  if (isGrammarFunctionToken(token)) {
    return 'beginner'
  }

  if (card?.level === 'N5') {
    return 'beginner'
  }

  if (card?.level === 'N4' || hasReliableMeaning(token.meaningZh)) {
    return 'intermediate'
  }

  return 'advanced'
}

function getGrammarStage(match: GrammarMatch): StudyStage {
  if (match.level === 'N5') {
    return 'beginner'
  }

  if (match.level === 'N4') {
    return 'intermediate'
  }

  return 'advanced'
}

function getWordMeaning(token: TokenAnalysis, card: VocabCard | null) {
  return getParticleMeaning(token) ?? card?.meaningZh ?? (hasReliableMeaning(token.meaningZh) ? token.meaningZh : UNKNOWN_MEANING)
}

function getWordExplanation(token: TokenAnalysis, card: VocabCard | null, meaningZh: string) {
  if (card?.memoryTip) {
    return card.memoryTip
  }

  if (isGrammarFunctionToken(token)) {
    return `歌词里常见的功能词，先记住它在句中承担“${meaningZh}”的作用。`
  }

  if (meaningZh === UNKNOWN_MEANING) {
    return '这个词暂时只有读音和词性，适合在高级阶段结合歌词上下文补充释义。'
  }

  return `在这句歌词里可以先理解为“${meaningZh}”。`
}

function getWordSources(token: TokenAnalysis, card: VocabCard | null) {
  const sources = [tokenizerSource, lyricContextSource]
  if (card) {
    sources.unshift(curatedVocabSource)
  }
  if (getParticleMeaning(token) && !card) {
    sources.push(heuristicSource)
  }
  return sources
}

function mergeSources(left: SongKnowledgeSource[], right: SongKnowledgeSource[]) {
  const sourceMap = new Map<string, SongKnowledgeSource>()
  for (const source of [...left, ...right]) {
    sourceMap.set(`${source.kind}:${source.label}`, source)
  }
  return [...sourceMap.values()]
}

export function createWordKnowledge(token: TokenAnalysis, line: LyricLine): SongWordKnowledge | null {
  const surface = token.surface.trim()
  if (!surface || isPunctuationToken(token) || !hasJapaneseText(surface)) {
    return null
  }

  const card = findCuratedVocab(token)
  const meaningZh = getWordMeaning(token, card)
  const stage = getWordStage(token, card)
  const lemma = token.base || surface
  const knowledgeKey = normalizeKnowledgeKey(`${lemma}:${token.partOfSpeech || 'word'}`)

  return {
    id: `word:${knowledgeKey || normalizeKnowledgeKey(surface)}`,
    kind: 'word',
    expression: surface,
    lemma,
    reading: card?.reading ?? token.reading,
    kana: token.kana,
    romaji: token.romaji,
    partOfSpeech: token.partOfSpeech,
    meaningZh,
    explanationZh: getWordExplanation(token, card, meaningZh),
    exampleJa: card?.exampleJa || line.ja,
    exampleZh: card?.exampleZh || line.zh,
    stage,
    confidence: card ? 0.94 : meaningZh === UNKNOWN_MEANING ? 0.46 : 0.78,
    sources: getWordSources(token, card),
  }
}

export function createGrammarKnowledge(match: GrammarMatch, line: LyricLine): SongGrammarKnowledge {
  const configured = grammarPatterns.find((pattern) => pattern.id === match.id)
  const stage = getGrammarStage(match)

  return {
    id: `grammar:${match.id}`,
    kind: 'grammar',
    grammarId: match.id,
    pattern: match.pattern,
    expression: match.matchedText,
    reading: match.pattern,
    meaningZh: match.meaningZh,
    explanationZh: configured?.explanationZh ?? match.explanationZh,
    exampleJa: line.ja,
    exampleZh: line.zh,
    stage,
    confidence: configured ? 0.88 : 0.7,
    sources: [grammarRegistrySource, lyricContextSource],
  }
}

export function mergeSongKnowledge(left: SongKnowledge | undefined, right: SongKnowledge) {
  if (!left) return right

  const stage = stageRank[right.stage] < stageRank[left.stage] ? right.stage : left.stage
  return {
    ...left,
    stage,
    confidence: Math.max(left.confidence, right.confidence),
    exampleJa: left.exampleJa || right.exampleJa,
    exampleZh: left.exampleZh || right.exampleZh,
    sources: mergeSources(left.sources, right.sources),
  } satisfies SongKnowledge
}
