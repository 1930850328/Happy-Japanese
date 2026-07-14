import type { CourseLevel, LiteracyItemKind, LiteracyItemProgress } from '../types'

export interface VocabularyEntry {
  id: string
  level: Exclude<CourseLevel, 'foundation'>
  term: string
  reading: string
  meaningEn: string
}

export interface KanjiEntry {
  id: string
  level: Exclude<CourseLevel, 'foundation'>
  character: string
  meaningsEn: string[]
  onReadings: string[]
  kunReadings: string[]
  strokeCount: number
  frequency: number | null
  grade: number | null
}

export interface GrammarEntry {
  id: string
  level: Exclude<CourseLevel, 'foundation'>
  title: string
  formation: string
  shortExplanationEn: string
  longExplanationEn: string
  examples: Array<{ ja: string; romaji: string; meaningEn: string }>
}

export type CurriculumEntry = VocabularyEntry | KanjiEntry | GrammarEntry

export interface CurriculumStudyScope {
  currentLevel: CourseLevel
  stageProgressRatio: number
  learnedTexts: string[]
  learnedPatterns: string[]
}

const cache = new Map<string, Promise<unknown>>()
const levelRank = new Map<CourseLevel, number>([
  ['foundation', 0],
  ['N5', 1],
  ['N4', 2],
  ['N3', 3],
  ['N2', 4],
  ['N1', 5],
])

async function loadJson<T>(name: string) {
  if (!cache.has(name)) {
    cache.set(name, fetch(`/curriculum/${name}.json`).then(async (response) => {
      if (!response.ok) throw new Error('课程资料加载失败，请检查网络后重试。')
      return response.json()
    }))
  }
  return cache.get(name) as Promise<T>
}

export function loadVocabulary() {
  return loadJson<VocabularyEntry[]>('vocabulary')
}

export function loadKanji() {
  return loadJson<KanjiEntry[]>('kanji')
}

export function loadGrammar() {
  return loadJson<GrammarEntry[]>('grammar')
}

function hash(value: string) {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

export function selectStudyBatch<T extends CurriculumEntry>(
  entries: T[],
  kind: LiteracyItemKind,
  currentLevel: CourseLevel,
  progress: LiteracyItemProgress[],
  limit: number,
  now = new Date(),
  scope?: CurriculumStudyScope,
) {
  const effectiveLevel = currentLevel === 'foundation' ? 'N5' : currentLevel
  const allowedRank = levelRank.get(effectiveLevel) ?? 1
  const progressMap = new Map(progress.filter((item) => item.kind === kind).map((item) => [item.itemId, item]))
  const entriesAtCurrentLevel = entries.filter((entry) => entry.level === effectiveLevel)
  const unlockedCurrentCount = scope
    ? Math.ceil(entriesAtCurrentLevel.length * Math.max(0, Math.min(scope.stageProgressRatio, 1)))
    : entriesAtCurrentLevel.length
  const unlockedCurrentIds = new Set(entriesAtCurrentLevel.slice(0, unlockedCurrentCount).map((entry) => entry.id))
  const eligible = entries.filter((entry) => {
    const rank = levelRank.get(entry.level) ?? 99
    if (rank > allowedRank) return false
    if (!scope || rank < allowedRank) return true
    if (scope.currentLevel === 'foundation' && kind !== 'vocabulary') {
      return progressMap.has(entry.id)
    }
    return unlockedCurrentIds.has(entry.id) || progressMap.has(entry.id) || entryMatchesLearnedScope(entry, scope)
  })
  const due = eligible
    .filter((entry) => {
      const item = progressMap.get(entry.id)
      return item && new Date(item.nextReviewAt).getTime() <= now.getTime()
    })
    .sort((left, right) => {
      const leftProgress = progressMap.get(left.id)
      const rightProgress = progressMap.get(right.id)
      return new Date(leftProgress?.nextReviewAt ?? 0).getTime() - new Date(rightProgress?.nextReviewAt ?? 0).getTime()
    })
  const daySeed = now.toISOString().slice(0, 10)
  const unseen = eligible
    .filter((entry) => !progressMap.has(entry.id))
    .sort((left, right) => {
      const relevance = Number(entryMatchesLearnedScope(right, scope)) - Number(entryMatchesLearnedScope(left, scope))
      return relevance || hash(`${daySeed}:${left.id}`) - hash(`${daySeed}:${right.id}`)
    })
  const learning = eligible
    .filter((entry) => {
      const item = progressMap.get(entry.id)
      return item && new Date(item.nextReviewAt).getTime() > now.getTime()
    })
    .sort((left, right) => (progressMap.get(left.id)?.confidence ?? 0) - (progressMap.get(right.id)?.confidence ?? 0))

  return [...due, ...unseen, ...learning]
    .filter((entry, index, items) => items.findIndex((item) => item.id === entry.id) === index)
    .slice(0, limit)
}

function normalizedJapaneseParts(values: string[]) {
  return values.flatMap((value) => value
    .replace(/[A-Za-z（）()\s]/g, '')
    .split(/[・／/、。〜～]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2))
}

function entryMatchesLearnedScope(entry: CurriculumEntry, scope?: CurriculumStudyScope) {
  if (!scope) return false
  const learnedText = scope.learnedTexts.join('\n')
  if ('term' in entry) {
    return learnedText.includes(entry.term) || (entry.reading.length >= 2 && learnedText.includes(entry.reading))
  }
  if ('character' in entry) return learnedText.includes(entry.character)
  const title = entry.title.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s/g, '')
  return normalizedJapaneseParts(scope.learnedPatterns).some((pattern) => title.includes(pattern) || pattern.includes(title))
}
