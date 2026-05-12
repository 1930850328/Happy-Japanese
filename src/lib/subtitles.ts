import type { KnowledgePoint, TranscriptSegment } from '../types'
import { isUsableChineseSubtitle } from './chineseTranslation'
import {
  polishTranslatedSubtitle,
  protectEntitiesForTranslation,
  type SubtitleEntityContext,
} from './subtitleEntityContext'
import { analyzeJapaneseText, hasReliableMeaning } from './textAnalysis'
import { translateJapaneseSentences } from './translation'

export interface SubtitleCue {
  startMs: number
  endMs: number
  jaText?: string
  text?: string
  zhSource?: 'hard-subtitle' | 'subtitle-file' | 'translation'
  zhText?: string
}

interface BuildStudyDataOptions {
  entityContext?: SubtitleEntityContext
  includeKnowledge?: boolean
}

function parseTimestamp(value: string) {
  const cleaned = value.trim().replace(',', '.')
  const parts = cleaned.split(':')

  let hours = 0
  let minutes = 0
  let seconds = 0

  if (parts.length >= 3) {
    hours = Number(parts.at(-3))
    minutes = Number(parts.at(-2))
    seconds = Number(parts.at(-1))
  } else if (parts.length === 2) {
    minutes = Number(parts[0])
    seconds = Number(parts[1])
  } else if (parts.length === 1) {
    seconds = Number(parts[0])
  }

  if (![hours, minutes, seconds].every(Number.isFinite)) {
    return 0
  }

  return Math.max(
    0,
    Math.round((hours * 3600 + minutes * 60 + seconds) * 1000),
  )
}

function normalizeCueText(input: string) {
  return input
    .replace(/\{\\[^}]+\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\N/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\r/g, '')
    .trim()
}

function hasKanaText(input: string) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\u30a0-\u30ff]/u.test(input)
}

function hasChineseText(input: string) {
  return /[\u4e00-\u9fff]/u.test(input)
}

function looksLikeChineseOnly(input: string) {
  return (
    hasChineseText(input) &&
    !hasKanaText(input) &&
    /[这那们为会说语习没过还让吗吧呢个]/u.test(input)
  )
}

function hasJapaneseText(input: string) {
  return hasKanaText(input) || (hasChineseText(input) && !looksLikeChineseOnly(input))
}

function extractCueText(lines: string[]) {
  const cleanedLines = lines.map(normalizeCueText).filter(Boolean)
  if (cleanedLines.length === 0) {
    return null
  }

  const jaLines = cleanedLines.filter((line) => hasJapaneseText(line))
  const zhLines = cleanedLines.filter(
    (line) => hasChineseText(line) && !hasKanaText(line) && line !== jaLines[0],
  )
  const jaText = jaLines[0]

  if (!jaText) {
    return null
  }

  return {
    jaText,
    zhText: zhLines.length > 0 ? zhLines.join(' ') : undefined,
  }
}

function parseTimedLines(text: string) {
  const lines = text.replace(/\r/g, '').split('\n')
  const cues: SubtitleCue[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line.includes('-->')) {
      continue
    }

    const [startText, endWithSettings] = line.split('-->')
    const endText = endWithSettings.trim().split(/\s+/)[0]
    const contentLines: string[] = []

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const value = lines[cursor]
      if (!value.trim()) {
        index = cursor
        break
      }

      contentLines.push(value)
      if (cursor === lines.length - 1) {
        index = cursor
      }
    }

    const cueText = extractCueText(contentLines)
    if (!cueText) {
      continue
    }

    cues.push({
      startMs: parseTimestamp(startText),
      endMs: parseTimestamp(endText),
      ...cueText,
    })
  }

  return cues
}

function parseAss(text: string) {
  const lines = text.replace(/\r/g, '').split('\n')
  const cues: SubtitleCue[] = []

  for (const line of lines) {
    if (!line.startsWith('Dialogue:')) {
      continue
    }

    const payload = line.slice('Dialogue:'.length).trim()
    const fields: string[] = []
    let current = ''
    let commaCount = 0

    for (const character of payload) {
      if (character === ',' && commaCount < 9) {
        fields.push(current)
        current = ''
        commaCount += 1
        continue
      }

      current += character
    }

    fields.push(current)
    if (fields.length < 10) {
      continue
    }

    const cueText = extractCueText(fields[9].split(/\n|\\N/g))
    if (!cueText) {
      continue
    }

    cues.push({
      startMs: parseTimestamp(fields[1]),
      endMs: parseTimestamp(fields[2]),
      ...cueText,
    })
  }

  return cues
}

export function parseSubtitleText(rawText: string, fileName = 'subtitle.vtt') {
  const lowerName = fileName.toLowerCase()

  if (lowerName.endsWith('.ass')) {
    return parseAss(rawText)
  }

  return parseTimedLines(rawText)
}

export async function parseSubtitleFile(file: File) {
  const rawText = await file.text()
  return parseSubtitleText(rawText, file.name)
}

function isUsefulToken(partOfSpeech: string, surface: string) {
  if (!surface.trim()) {
    return false
  }

  if (surface.length < 2) {
    return false
  }

  if (!hasJapaneseText(surface)) {
    return false
  }

  return !/助詞|助動詞|記号/.test(partOfSpeech)
}

function buildTokenExplanation(surface: string, meaningZh: string) {
  return hasReliableMeaning(meaningZh)
    ? `${surface} 在这句里更接近“${meaningZh}”这个意思。`
    : `${surface} 是片中反复出现的表达，建议先结合原句记住它的用法。`
}

function isUsefulFocusToken(
  partOfSpeech: string,
  surface: string,
  sentence: string,
  meaningZh: string,
) {
  if (!isUsefulToken(partOfSpeech, surface) || !hasReliableMeaning(meaningZh)) {
    return false
  }

  if (partOfSpeech === '未分类') {
    return false
  }

  const normalizedSurface = surface.trim()
  const normalizedSentence = sentence.trim()
  if (!normalizedSurface || !normalizedSentence) {
    return false
  }

  if (normalizedSurface === normalizedSentence) {
    return false
  }

  if (normalizedSurface.length > 8) {
    return false
  }

  return normalizedSurface.length / Math.max(1, normalizedSentence.length) <= 0.45
}

function scoreFocusToken(partOfSpeech: string, surface: string) {
  let score = 0

  if (/動詞/u.test(partOfSpeech)) {
    score += 5
  } else if (/名詞/u.test(partOfSpeech)) {
    score += 4
  } else if (/形容詞|形容動詞/u.test(partOfSpeech)) {
    score += 4
  } else if (/副詞|連体詞/u.test(partOfSpeech)) {
    score += 3
  } else {
    score += 1
  }

  if (/[\p{Script=Han}]/u.test(surface)) {
    score += 1
  }

  if (surface.length >= 2 && surface.length <= 4) {
    score += 1
  }

  return score
}

function pickFocusTokens(analysis: Awaited<ReturnType<typeof analyzeJapaneseText>>, sentence: string) {
  const seen = new Set<string>()

  return analysis.tokens
    .filter((token) =>
      isUsefulFocusToken(token.partOfSpeech, token.surface, sentence, token.meaningZh),
    )
    .filter((token) => {
      const key = token.base || token.surface
      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
    .sort((left, right) => {
      const scoreDiff =
        scoreFocusToken(right.partOfSpeech, right.surface) -
        scoreFocusToken(left.partOfSpeech, left.surface)
      if (scoreDiff !== 0) {
        return scoreDiff
      }

      return left.surface.length - right.surface.length
    })
    .slice(0, 2)
}

function resolveSegmentChinese(
  jaText: string,
  cueZhText: string | undefined,
  translatedLine: string | undefined,
  fallbackZh: string,
  cueZhSource?: SubtitleCue['zhSource'],
) {
  if (cueZhSource === 'hard-subtitle' && cueZhText?.trim()) {
    return cueZhText.trim()
  }

  if (isUsableChineseSubtitle(jaText, cueZhText)) {
    return cueZhText!.trim()
  }

  if (isUsableChineseSubtitle(jaText, translatedLine)) {
    return translatedLine!.trim()
  }

  return fallbackZh.trim()
}

async function resolveChineseLines(cues: SubtitleCue[], entityContext?: SubtitleEntityContext) {
  const missingJapaneseLines = cues
    .filter((cue) => {
      const japaneseLine = cue.jaText ?? cue.text ?? ''
      return japaneseLine.trim() && !isUsableChineseSubtitle(japaneseLine, cue.zhText)
    })
    .map((cue) => cue.jaText ?? cue.text ?? '')

  if (missingJapaneseLines.length === 0) {
    return new Map<string, string>()
  }

  try {
    const protectedLines = missingJapaneseLines.map((line) => ({
      original: line,
      ...protectEntitiesForTranslation(line, entityContext),
    }))
    const translated = await translateJapaneseSentences(
      protectedLines.map((line) => line.protectedText),
    )
    return new Map(
      protectedLines
        .map((line) => {
          const translatedLine = translated[line.protectedText]?.trim()
          return translatedLine
            ? [line.original, line.restore(translatedLine)] as const
            : null
        })
        .filter((entry): entry is readonly [string, string] => entry !== null),
    )
  } catch {
    return new Map<string, string>()
  }
}

function buildFallbackChineseLine(jaText: string) {
  const previewText = jaText.trim().slice(0, 36)
  return previewText ? `这句字幕是「${previewText}」，可以在预览里校对中文。` : '这句字幕可以在预览里校对中文。'
}

export async function buildStudyDataFromCues(
  cues: SubtitleCue[],
  options: BuildStudyDataOptions = {},
) {
  const includeKnowledge = options.includeKnowledge ?? true
  const translatedMap = await resolveChineseLines(cues, options.entityContext)
  const knowledgeMap = new Map<string, KnowledgePoint>()
  const segments: TranscriptSegment[] = []

  for (const cue of cues) {
    const jaText = cue.jaText ?? cue.text ?? ''
    if (!jaText.trim()) {
      continue
    }

    const analysis = includeKnowledge ? await analyzeJapaneseText(jaText) : null
    const translatedLine = translatedMap.get(jaText)?.trim()
    const resolvedZh = resolveSegmentChinese(
      jaText,
      cue.zhText,
      translatedLine,
      analysis?.glossZh ?? buildFallbackChineseLine(jaText),
      cue.zhSource,
    )
    const polishedZh = polishTranslatedSubtitle(jaText, resolvedZh, options.entityContext)
    const focusTermIds: string[] = []

    if (includeKnowledge && analysis) {
      const grammarMatches = [...analysis.grammarMatches]
        .sort((left, right) => right.matchedText.length - left.matchedText.length)
        .filter(
          (match, index, all) =>
            !all
              .slice(0, index)
              .some((existing) => existing.matchedText.includes(match.matchedText)),
        )

      for (const match of grammarMatches.slice(0, 2)) {
        const pointId = `grammar:${match.id}`
        if (!knowledgeMap.has(pointId)) {
          knowledgeMap.set(pointId, {
            id: pointId,
            kind: 'grammar',
            expression: match.pattern,
            reading: match.pattern,
            meaningZh: match.meaningZh,
            partOfSpeech: '语法',
            explanationZh: match.explanationZh,
            exampleJa: jaText,
            exampleZh: resolvedZh,
          })
        }
        focusTermIds.push(pointId)
      }

      for (const token of pickFocusTokens(analysis, jaText)) {
        const pointId = `word:${token.base}`
        if (!knowledgeMap.has(pointId)) {
          knowledgeMap.set(pointId, {
            id: pointId,
            kind: 'word',
            expression: token.surface,
            reading: token.kana || token.reading,
            meaningZh: token.meaningZh,
            partOfSpeech: token.partOfSpeech,
            explanationZh: buildTokenExplanation(token.surface, token.meaningZh),
            exampleJa: jaText,
            exampleZh: resolvedZh,
          })
        }
        focusTermIds.push(pointId)
      }
    }

    segments.push({
      startMs: cue.startMs,
      endMs: cue.endMs,
      ja: jaText,
      kana: analysis?.kana ?? jaText,
      romaji: analysis?.romaji ?? '',
      zh: polishedZh,
      focusTermIds,
    })
  }

  return {
    segments,
    knowledgePoints: [...knowledgeMap.values()],
  }
}
