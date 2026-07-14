import type {
  CourseLevel,
  CourseState,
  LiteracyItemKind,
  LiteracyItemProgress,
  LiteracyState,
  ReadingAttempt,
} from '../types'

export const LITERACY_POLICY = {
  dailyVocabulary: 12,
  dailyKanji: 5,
  dailyGrammar: 4,
  stableConfidence: 0.82,
  maxReadingAttempts: 500,
} as const

export const LITERACY_TARGETS: Record<CourseLevel, {
  vocabulary: number
  kanji: number
  grammar: number
  readingPasses: number
  charactersPerMinute: number
}> = {
  foundation: { vocabulary: 50, kanji: 0, grammar: 0, readingPasses: 2, charactersPerMinute: 35 },
  N5: { vocabulary: 600, kanji: 80, grammar: 100, readingPasses: 3, charactersPerMinute: 70 },
  N4: { vocabulary: 1_200, kanji: 250, grammar: 200, readingPasses: 6, charactersPerMinute: 110 },
  N3: { vocabulary: 3_000, kanji: 600, grammar: 320, readingPasses: 9, charactersPerMinute: 160 },
  N2: { vocabulary: 5_200, kanji: 1_000, grammar: 500, readingPasses: 12, charactersPerMinute: 220 },
  N1: { vocabulary: 7_500, kanji: 1_800, grammar: 700, readingPasses: 15, charactersPerMinute: 280 },
}

const levelRank: Record<CourseLevel, number> = { foundation: 1, N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 }

export function createEmptyLiteracyState(): LiteracyState {
  return { itemProgress: [], readingAttempts: [] }
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 3_600_000).toISOString()
}

export function recordLiteracyAnswer(
  literacy: LiteracyState,
  answer: {
    itemId: string
    kind: LiteracyItemKind
    level: Exclude<CourseLevel, 'foundation'>
    correct: boolean
    meaningZh?: string
  },
  now = new Date(),
) {
  const progress = new Map(literacy.itemProgress.map((item) => [item.itemId, item]))
  const current = progress.get(answer.itemId)
  const previousConfidence = current?.confidence ?? 0.12
  const previousStability = current?.stabilityHours ?? 4
  const elapsedHours = current
    ? Math.max(0, (now.getTime() - new Date(current.lastReviewedAt).getTime()) / 3_600_000)
    : 0
  const delayedRecall = Boolean(current) && elapsedHours >= previousStability * 0.7
  const confidence = answer.correct
    ? Math.min(delayedRecall ? 0.99 : 0.58, previousConfidence + (1 - previousConfidence) * (delayedRecall ? 0.34 : 0.2))
    : Math.max(0.03, previousConfidence * 0.38)
  const stabilityHours = answer.correct
    ? delayedRecall
      ? Math.min(24 * 180, previousStability * (1.45 + confidence))
      : Math.min(24, Math.max(6, previousStability))
    : Math.max(2, previousStability * 0.3)

  const next: LiteracyItemProgress = {
    itemId: answer.itemId,
    kind: answer.kind,
    level: answer.level,
    confidence,
    stabilityHours,
    correctCount: (current?.correctCount ?? 0) + (answer.correct ? 1 : 0),
    incorrectCount: (current?.incorrectCount ?? 0) + (answer.correct ? 0 : 1),
    lastReviewedAt: now.toISOString(),
    nextReviewAt: addHours(now, stabilityHours),
    meaningZh: answer.meaningZh ?? current?.meaningZh,
  }
  progress.set(answer.itemId, next)
  return { ...literacy, itemProgress: [...progress.values()] }
}

export function recordReadingAttempt(
  literacy: LiteracyState,
  attempt: Omit<ReadingAttempt, 'id' | 'completedAt'>,
  now = new Date(),
) {
  const next: ReadingAttempt = {
    ...attempt,
    id: crypto.randomUUID(),
    completedAt: now.toISOString(),
  }
  return {
    ...literacy,
    readingAttempts: [next, ...literacy.readingAttempts].slice(0, LITERACY_POLICY.maxReadingAttempts),
  }
}

export function isStableLiteracyItem(item: LiteracyItemProgress) {
  return item.confidence >= LITERACY_POLICY.stableConfidence && item.correctCount >= 2
}

export function getLiteracyReadiness(state: CourseState, level: CourseLevel) {
  const target = LITERACY_TARGETS[level]
  const stable = state.literacy.itemProgress.filter(isStableLiteracyItem)
  const vocabulary = stable.filter((item) => item.kind === 'vocabulary').length
  const kanji = stable.filter((item) => item.kind === 'kanji').length
  const grammar = stable.filter((item) => item.kind === 'grammar').length
  const uniquePassages = new Map<string, ReadingAttempt>()
  state.literacy.readingAttempts
    .filter((item) => (
      item.accuracy >= 0.8 &&
      !item.usedReadingAid &&
      !item.usedTranslationAid &&
      levelRank[item.level] <= levelRank[level]
    ))
    .forEach((item) => {
      if (!uniquePassages.has(item.passageId)) uniquePassages.set(item.passageId, item)
    })
  const unassisted = [...uniquePassages.values()]
  const readingPasses = unassisted.length
  const recentReading = unassisted.slice(0, 5)
  const charactersPerMinute = recentReading.length === 0
    ? 0
    : Math.round(recentReading.reduce((sum, item) => sum + item.charactersPerMinute, 0) / recentReading.length)
  const dimensions = [
    { id: 'vocabulary', label: '词汇', value: vocabulary, target: target.vocabulary },
    { id: 'kanji', label: '汉字', value: kanji, target: target.kanji },
    { id: 'grammar', label: '语法', value: grammar, target: target.grammar },
    { id: 'reading', label: '无辅助阅读', value: readingPasses, target: target.readingPasses },
    { id: 'speed', label: '阅读速度', value: charactersPerMinute, target: target.charactersPerMinute },
  ]
  return {
    vocabulary,
    kanji,
    grammar,
    readingPasses,
    charactersPerMinute,
    dimensions,
    ready: dimensions.every((item) => item.value >= item.target),
  }
}
