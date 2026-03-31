import type { KnowledgePoint, TranscriptSegment } from '../types'
import { analyzeJapaneseText, hasReliableMeaning } from './textAnalysis'

interface SubtitleCue {
  startMs: number
  endMs: number
  jaText?: string
  text?: string
  zhText?: string
}

function parseTimestamp(value: string) {
  const cleaned = value.trim().replace(',', '.')
  const parts = cleaned.split(':')
  if (parts.length < 3) {
    return 0
  }

  const [hours, minutes, seconds] = parts
  const secondValue = Number(seconds)
  return Math.max(
    0,
    Math.round((Number(hours) * 3600 + Number(minutes) * 60 + secondValue) * 1000),
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

function hasJapaneseText(input: string) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(input)
}

function hasChineseText(input: string) {
  return /[\u4e00-\u9fff]/u.test(input)
}

function extractCueText(lines: string[]) {
  const cleanedLines = lines.map(normalizeCueText).filter(Boolean)
  if (cleanedLines.length === 0) {
    return null
  }

  const jaLines = cleanedLines.filter((line) => hasJapaneseText(line))
  const zhLines = cleanedLines.filter((line) => hasChineseText(line) && !hasJapaneseText(line))
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

export async function parseSubtitleFile(file: File) {
  const rawText = await file.text()
  const lowerName = file.name.toLowerCase()

  if (lowerName.endsWith('.ass')) {
    return parseAss(rawText)
  }

  return parseTimedLines(rawText)
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
    : `${surface} 是片中反复出现的表达，建议先结合语境记住它的语气和位置。`
}

export async function buildStudyDataFromCues(cues: SubtitleCue[]) {
  const knowledgeMap = new Map<string, KnowledgePoint>()
  const segments: TranscriptSegment[] = []

  for (const cue of cues) {
    const jaText = cue.jaText ?? cue.text ?? ''
    if (!jaText.trim()) {
      continue
    }

    const analysis = await analyzeJapaneseText(jaText)
    const focusTermIds: string[] = []

    for (const match of analysis.grammarMatches.slice(0, 2)) {
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
          exampleZh: cue.zhText ?? analysis.glossZh,
        })
      }
      focusTermIds.push(pointId)
    }

    for (const token of analysis.tokens
      .filter((item) => isUsefulToken(item.partOfSpeech, item.surface))
      .filter((item) => hasReliableMeaning(item.meaningZh))
      .slice(0, 2)) {
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
          exampleZh: cue.zhText ?? analysis.glossZh,
        })
      }
      focusTermIds.push(pointId)
    }

    segments.push({
      startMs: cue.startMs,
      endMs: cue.endMs,
      ja: jaText,
      kana: analysis.kana,
      romaji: analysis.romaji,
      zh: cue.zhText ?? analysis.glossZh,
      focusTermIds,
    })
  }

  return {
    segments,
    knowledgePoints: [...knowledgeMap.values()],
  }
}
