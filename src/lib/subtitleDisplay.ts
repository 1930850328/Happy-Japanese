import type { TranscriptSegment } from '../types'
import { translateJapaneseSentences } from './translation'

export function hasSentenceLikeChinese(text?: string) {
  const normalized = text?.trim() ?? ''
  if (
    !normalized ||
    normalized.includes('暂未收录') ||
    normalized.startsWith('这句') ||
    normalized.includes('句里') ||
    normalized.includes('表示“')
  ) {
    return false
  }

  const chineseCharCount = (normalized.match(/[\u4e00-\u9fff]/g) || []).length
  const slashCount = (normalized.match(/[\\/]/g) || []).length
  return chineseCharCount >= 6 && slashCount === 0
}

export async function enrichSegmentsWithSentenceTranslations(segments: TranscriptSegment[]) {
  const pendingSegments = segments.filter(
    (segment) => segment.ja.trim() && !hasSentenceLikeChinese(segment.zh),
  )

  if (pendingSegments.length === 0) {
    return segments
  }

  try {
    const translated = await translateJapaneseSentences(pendingSegments.map((segment) => segment.ja))
    return segments.map((segment) => {
      if (hasSentenceLikeChinese(segment.zh)) {
        return segment
      }

      const translatedLine = translated[segment.ja]?.trim()
      if (!translatedLine) {
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
