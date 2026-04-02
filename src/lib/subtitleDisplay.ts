import type { TranscriptSegment } from '../types'
import { isUsableChineseSubtitle } from './chineseTranslation'
import { translateJapaneseSentences } from './translation'

export async function enrichSegmentsWithSentenceTranslations(segments: TranscriptSegment[]) {
  const pendingSegments = segments.filter(
    (segment) => segment.ja.trim() && !isUsableChineseSubtitle(segment.ja, segment.zh),
  )

  if (pendingSegments.length === 0) {
    return segments
  }

  try {
    const translated = await translateJapaneseSentences(pendingSegments.map((segment) => segment.ja))
    return segments.map((segment) => {
      if (isUsableChineseSubtitle(segment.ja, segment.zh)) {
        return segment
      }

      const translatedLine = translated[segment.ja]?.trim()
      if (!isUsableChineseSubtitle(segment.ja, translatedLine)) {
        return segment
      }

      return {
        ...segment,
        zh: translatedLine,
      }
    })
  } catch {
    return segments
  }
}
