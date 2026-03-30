import type { KnowledgePoint, TranscriptSegment } from '../types'
import { analyzeJapaneseText } from './textAnalysis'

interface SubtitleCue {
  startMs: number
  endMs: number
  text: string
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
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .trim()
}

function hasJapaneseText(input: string) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(input)
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

    const textValue = normalizeCueText(contentLines.join('\n'))
    if (!textValue || !hasJapaneseText(textValue)) {
      continue
    }

    cues.push({
      startMs: parseTimestamp(startText),
      endMs: parseTimestamp(endText),
      text: textValue,
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

    const startMs = parseTimestamp(fields[1])
    const endMs = parseTimestamp(fields[2])
    const textValue = normalizeCueText(fields[9])
    if (!textValue || !hasJapaneseText(textValue)) {
      continue
    }

    cues.push({ startMs, endMs, text: textValue })
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

export async function buildStudyDataFromCues(cues: SubtitleCue[]) {
  const knowledgeMap = new Map<string, KnowledgePoint>()
  const segments: TranscriptSegment[] = []

  for (const cue of cues) {
    const analysis = await analyzeJapaneseText(cue.text)
    const focusTermIds: string[] = []

    for (const match of analysis.grammarMatches.slice(0, 1)) {
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
          exampleJa: cue.text,
          exampleZh: analysis.glossZh,
        })
      }
      focusTermIds.push(pointId)
    }

    for (const token of analysis.tokens
      .filter((item) => isUsefulToken(item.partOfSpeech, item.surface))
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
          explanationZh:
            '这是字幕里反复出现或很适合暂停跟读的表达，建议先跟读，再回到原片里听第二遍。',
          exampleJa: cue.text,
          exampleZh: analysis.glossZh,
        })
      }
      focusTermIds.push(pointId)
    }

    segments.push({
      startMs: cue.startMs,
      endMs: cue.endMs,
      ja: cue.text,
      kana: analysis.kana,
      romaji: analysis.romaji,
      zh: analysis.glossZh,
      focusTermIds,
    })
  }

  return {
    segments,
    knowledgePoints: [...knowledgeMap.values()],
  }
}
