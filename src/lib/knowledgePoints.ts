import type { KnowledgePoint, TranscriptSegment } from '../types'

const MAX_SEGMENT_COVERAGE_RATIO = 0.45

function hasJapaneseText(input: string) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\u3400-\u9fff]/u.test(input)
}

function getMaxExpressionLength(point: KnowledgePoint) {
  if (point.kind === 'word') {
    return 8
  }

  if (point.kind === 'grammar') {
    return 12
  }

  return 12
}

export function isPreciseKnowledgePoint(
  point: KnowledgePoint,
  segments: TranscriptSegment[],
) {
  const expression = point.expression.trim()
  if (!expression || !hasJapaneseText(expression)) {
    return false
  }

  if (point.kind === 'word' && point.partOfSpeech === '未分类') {
    return false
  }

  if (expression.length > getMaxExpressionLength(point)) {
    return false
  }

  return segments.some((segment) => {
    if (!segment.focusTermIds.includes(point.id)) {
      return false
    }

    const sentence = segment.ja.trim()
    if (!sentence || !sentence.includes(expression)) {
      return false
    }

    if (sentence === expression) {
      return false
    }

    return expression.length / Math.max(1, sentence.length) <= MAX_SEGMENT_COVERAGE_RATIO
  })
}

export function filterPreciseKnowledgePoints(
  points: KnowledgePoint[],
  segments: TranscriptSegment[],
) {
  return points.filter((point) => isPreciseKnowledgePoint(point, segments))
}
