import { addDays } from './date'
import type { KnowledgePoint, ReviewItem, ReviewItemKind, ReviewResult, VocabCard } from '../types'

export const REVIEW_INTERVALS = [1, 2, 7, 15, 30]

export function createReviewFromKnowledgePoint(
  point: KnowledgePoint,
  sourceId: string,
  lessonId?: string,
): ReviewItem {
  return {
    id: crypto.randomUUID(),
    kind: point.kind === 'phrase' ? 'phrase' : point.kind,
    sourceId,
    lessonId,
    expression: point.expression,
    reading: point.reading,
    meaningZh: point.meaningZh,
    context: point.exampleJa,
    intervalIndex: 0,
    nextReviewAt: addDays(new Date(), REVIEW_INTERVALS[0]),
    createdAt: new Date().toISOString(),
  }
}

export function createReviewFromVocab(card: VocabCard): ReviewItem {
  return {
    id: crypto.randomUUID(),
    kind: 'word',
    sourceId: card.id,
    expression: card.term,
    reading: card.reading,
    meaningZh: card.meaningZh,
    context: card.exampleJa,
    intervalIndex: 0,
    nextReviewAt: addDays(new Date(), REVIEW_INTERVALS[0]),
    createdAt: new Date().toISOString(),
  }
}

export function createReviewFromSentence(
  expression: string,
  reading: string,
  meaningZh: string,
): ReviewItem {
  return {
    id: crypto.randomUUID(),
    kind: 'video',
    sourceId: `sentence:${expression}`,
    expression,
    reading,
    meaningZh,
    context: expression,
    intervalIndex: 0,
    nextReviewAt: addDays(new Date(), REVIEW_INTERVALS[0]),
    createdAt: new Date().toISOString(),
  }
}

export function updateReviewSchedule(item: ReviewItem, result: ReviewResult): ReviewItem {
  const next = { ...item }

  if (result === 'know') {
    next.intervalIndex = Math.min(item.intervalIndex + 1, REVIEW_INTERVALS.length - 1)
  } else if (result === 'fuzzy') {
    next.intervalIndex = Math.max(item.intervalIndex, 0)
  } else {
    next.intervalIndex = 0
  }

  const offset =
    result === 'forget'
      ? REVIEW_INTERVALS[0]
      : REVIEW_INTERVALS[next.intervalIndex]

  next.lastReviewedAt = new Date().toISOString()
  next.nextReviewAt = addDays(new Date(), offset)
  return next
}

export function getReviewKindLabel(kind: ReviewItemKind) {
  if (kind === 'word') return '单词'
  if (kind === 'grammar') return '语法'
  if (kind === 'phrase') return '短句'
  return '知识点'
}
