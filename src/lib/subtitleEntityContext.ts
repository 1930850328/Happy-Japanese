import * as wanakana from 'wanakana'

import type { SubtitleCue } from './subtitles'

export interface SubtitleEntity {
  aliases: string[]
  surface: string
}

export interface SubtitleEntityContext {
  entities: SubtitleEntity[]
  primaryTitle?: string
}

interface BuildSubtitleEntityContextInput {
  cues?: SubtitleCue[]
  fileName?: string
  extraTexts?: string[]
}

interface ProtectedTranslation {
  protectedText: string
  restore: (value: string) => string
}

const ENTITY_PLACEHOLDER_PREFIX = 'ZXENTITY'
const ENTITY_PLACEHOLDER_SUFFIX = 'ZX'
const LATIN_STOP_WORDS = new Set([
  'official',
  'music',
  'video',
  'live',
  'title',
  'logo',
  'movie',
  'anime',
  'new',
  'pv',
  'cm',
  'the',
  'and',
])

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function stripExtension(value: string) {
  return value.replace(/\.[a-z0-9]+$/iu, '')
}

function cleanSourceTitle(value: string) {
  return stripExtension(value)
    .replace(/^\d{4}-\d{2}-\d{2}[_\s-]+\d{2}-\d{2}-\d{2}[_\s-]*/u, '')
    .replace(/BV[a-z0-9]+/giu, '')
    .replace(/av\d+/giu, '')
    .replace(/[_]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function normalizeEntitySurface(value: string) {
  return value
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/[：]/gu, ':')
    .replace(/[！]/gu, '!')
    .replace(/[？]/gu, '?')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s"'\-:：/\\|]+|[\s"'\-:：/\\|]+$/gu, '')
    .trim()
}

function normalizeLatinKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '')
}

function normalizeRomajiKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '')
    .replace(/l/gu, 'r')
}

function skeletonKey(value: string) {
  return normalizeRomajiKey(value).replace(/[aeiou]/gu, '')
}

function phoneticVariants(value: string) {
  const base = normalizeRomajiKey(value)
  return uniqueValues([
    base,
    base.replace(/v/gu, 'b'),
    base.replace(/c/gu, 'k'),
    base.replace(/j/gu, 'z'),
    base.replace(/shi/gu, 'si'),
    base.replace(/si/gu, 'shi'),
    base.replace(/chi/gu, 'ti'),
    base.replace(/ti/gu, 'chi'),
    base.replace(/tsu/gu, 'tu'),
    base.replace(/tu/gu, 'tsu'),
  ])
}

function editDistance(left: string, right: string) {
  if (left === right) {
    return 0
  }

  if (!left) {
    return right.length
  }

  if (!right) {
    return left.length
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  const current = Array(right.length + 1).fill(0)

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
    }

    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index]
    }
  }

  return previous[right.length]
}

function similarity(left: string, right: string) {
  const normalizedLeft = normalizeRomajiKey(left)
  const normalizedRight = normalizeRomajiKey(right)
  if (!normalizedLeft || !normalizedRight) {
    return 0
  }

  const distance = editDistance(normalizedLeft, normalizedRight)
  return 1 - distance / Math.max(normalizedLeft.length, normalizedRight.length)
}

function hasUsefulLatinEntity(value: string) {
  const key = normalizeLatinKey(value)
  return key.length >= 3 && /[a-z]/u.test(key)
}

function isEntityStopWord(value: string) {
  return LATIN_STOP_WORDS.has(normalizeLatinKey(value))
}

function extractBracketContents(value: string) {
  const contents: string[] = []
  const pattern = /[「『【《“"]([^」』】》”"]{2,})[」』】》”"]/gu
  for (const match of value.matchAll(pattern)) {
    contents.push(match[1])
  }

  return contents
}

function extractLatinPhrases(value: string) {
  const phrases: string[] = []
  const pattern =
    /[A-Za-z][A-Za-z0-9]*[!！?？']*(?:[ .:_+\-/×xX&]+[A-Za-z0-9][A-Za-z0-9]*[!！?？']*)*/gu

  for (const match of value.matchAll(pattern)) {
    const phrase = normalizeEntitySurface(match[0])
    if (hasUsefulLatinEntity(phrase)) {
      phrases.push(phrase)
    }
  }

  return phrases
}

function splitEntityWords(value: string) {
  return (
    normalizeEntitySurface(value).match(/[A-Za-z][A-Za-z0-9]*[!！?？']*|\d{2,4}/gu) ?? []
  ).filter((word) => hasUsefulLatinEntity(word) && !isEntityStopWord(word))
}

function buildEntityCandidatesFromPhrase(phrase: string) {
  const normalizedPhrase = normalizeEntitySurface(phrase)
  const words = splitEntityWords(normalizedPhrase)
  const candidates: string[] = []
  const symbolicCompounds =
    normalizedPhrase.match(/[A-Za-z][A-Za-z0-9!！?？']*(?:[×xX][A-Za-z][A-Za-z0-9!！?？']*)+/gu) ??
    []

  candidates.push(...symbolicCompounds)

  if (words.length >= 2) {
    candidates.push(words.join(' '))
  }

  for (let size = Math.min(4, words.length); size >= 2; size -= 1) {
    for (let index = 0; index <= words.length - size; index += 1) {
      candidates.push(words.slice(index, index + size).join(' '))
    }
  }

  for (const word of words) {
    if (normalizeLatinKey(word).length >= 4 || /[A-Z].*[A-Z]/u.test(word)) {
      candidates.push(word)
    }
  }

  return uniqueValues(candidates)
}

function createEntity(surface: string): SubtitleEntity | null {
  const normalizedSurface = normalizeEntitySurface(surface)
  const key = normalizeLatinKey(normalizedSurface)
  if (!hasUsefulLatinEntity(normalizedSurface) || key.length < 3) {
    return null
  }

  const rawWords = normalizeEntitySurface(normalizedSurface).match(/[A-Za-z][A-Za-z0-9]*/gu) ?? []
  if (rawWords.length > 0 && rawWords.every(isEntityStopWord)) {
    return null
  }

  const words = splitEntityWords(normalizedSurface)
  if (words.length > 0 && words.every(isEntityStopWord)) {
    return null
  }

  return {
    surface: normalizedSurface,
    aliases: uniqueValues([
      key,
      ...phoneticVariants(key),
      skeletonKey(key),
      wanakana.toRomaji(wanakana.toKatakana(normalizedSurface)),
    ]).filter((alias) => alias.length >= 2),
  }
}

function pickPrimaryTitle(texts: string[], entities: SubtitleEntity[]) {
  const bracketTitles = texts
    .flatMap(extractBracketContents)
    .map(normalizeEntitySurface)
    .filter((title) => title.split(/\s+/u).length >= 3 && hasUsefulLatinEntity(title))

  if (bracketTitles.length > 0) {
    return bracketTitles.sort((left, right) => right.length - left.length)[0]
  }

  return entities
    .map((entity) => entity.surface)
    .filter((title) => title.split(/\s+/u).length >= 3)
    .sort((left, right) => right.length - left.length)[0]
}

export function buildSubtitleEntityContext({
  cues = [],
  fileName = '',
  extraTexts = [],
}: BuildSubtitleEntityContextInput): SubtitleEntityContext {
  const sourceTexts = uniqueValues([
    fileName ? cleanSourceTitle(fileName) : '',
    ...extraTexts,
    ...cues.flatMap((cue) => [cue.jaText ?? cue.text ?? '', cue.zhText ?? '']),
  ])
  const candidateSurfaces = uniqueValues(
    sourceTexts.flatMap((text) => [
      ...extractBracketContents(text),
      ...extractLatinPhrases(text),
      ...extractLatinPhrases(text).flatMap(buildEntityCandidatesFromPhrase),
    ]),
  )

  const byKey = new Map<string, SubtitleEntity>()
  for (const candidate of candidateSurfaces) {
    const entity = createEntity(candidate)
    if (!entity) {
      continue
    }

    const key = normalizeLatinKey(entity.surface)
    const existing = byKey.get(key)
    if (!existing || entity.surface.length > existing.surface.length) {
      byKey.set(key, entity)
    }
  }

  const entities = [...byKey.values()].sort((left, right) => {
    const lengthDiff = normalizeLatinKey(right.surface).length - normalizeLatinKey(left.surface).length
    return lengthDiff !== 0 ? lengthDiff : right.surface.length - left.surface.length
  })
  const primaryTitle = pickPrimaryTitle(sourceTexts, entities)

  return {
    entities,
    primaryTitle,
  }
}

function scoreEntityMatch(kanaText: string, entity: SubtitleEntity) {
  const romaji = normalizeRomajiKey(wanakana.toRomaji(kanaText))
  if (romaji.length < 4) {
    return 0
  }

  const directScore = Math.max(...entity.aliases.map((alias) => similarity(romaji, alias)))
  const romajiSkeleton = skeletonKey(romaji)
  const skeletonScore =
    romajiSkeleton.length >= 2
      ? Math.max(...entity.aliases.map((alias) => similarity(romajiSkeleton, skeletonKey(alias))))
      : 0

  return Math.max(directScore, skeletonScore >= 0.64 ? skeletonScore : 0)
}

function findEntityForKana(kanaText: string, context: SubtitleEntityContext) {
  let best: { entity: SubtitleEntity; score: number } | null = null

  for (const entity of context.entities) {
    const score = scoreEntityMatch(kanaText, entity)
    if (!best || score > best.score) {
      best = { entity, score }
    }
  }

  if (!best) {
    return null
  }

  const romajiLength = normalizeRomajiKey(wanakana.toRomaji(kanaText)).length
  const threshold = romajiLength <= 5 ? 0.6 : 0.58
  return best.score >= threshold ? best.entity : null
}

function stripMusicMarkers(value: string) {
  return value
    .replace(/^[\s【\[(（]*(?:音楽|music)[】\])）:：\s。．.、-]*/iu, '')
    .replace(/[\s【\[(（]*(?:音楽|music)[】\])）:：\s。．.、-]*$/iu, '')
    .trim()
}

function countMatchedEntities(value: string, context: SubtitleEntityContext) {
  const lower = value.toLowerCase()
  return context.entities.filter((entity) => lower.includes(entity.surface.toLowerCase())).length
}

function promotePrimaryTitleLine(value: string, context: SubtitleEntityContext) {
  if (!context.primaryTitle || !/映画|劇場版|movie|film/iu.test(value)) {
    return value
  }

  if (countMatchedEntities(value, context) < 2) {
    return value
  }

  return `映画「${context.primaryTitle}」`
}

export function correctSubtitleTextWithEntities(
  text: string,
  context?: SubtitleEntityContext,
) {
  if (!context || context.entities.length === 0) {
    return stripMusicMarkers(text)
  }

  let next = stripMusicMarkers(text)
    .replace(/^えい[がか][。．.、\s]*(?=映画)/u, '')
    .replace(/\s+/gu, ' ')
    .trim()

  next = next.replace(/[\p{Script=Katakana}\p{Script=Hiragana}ー]{3,}/gu, (kanaText) => {
    const entity = findEntityForKana(kanaText, context)
    return entity?.surface ?? kanaText
  })

  next = next
    .replace(/\s+([。、！？])/gu, '$1')
    .replace(/([「『《])\s+/gu, '$1')
    .replace(/\s+([」』》])/gu, '$1')
    .trim()

  return promotePrimaryTitleLine(next, context)
}

export function applySubtitleEntityCorrectionsToCues(
  cues: SubtitleCue[],
  context?: SubtitleEntityContext,
) {
  return cues.map((cue) => {
    const text = cue.jaText ?? cue.text ?? ''
    const corrected = correctSubtitleTextWithEntities(text, context)
    return {
      ...cue,
      jaText: corrected,
      text: cue.text ? corrected : cue.text,
    }
  })
}

export function protectEntitiesForTranslation(
  text: string,
  context?: SubtitleEntityContext,
): ProtectedTranslation {
  if (!context || context.entities.length === 0) {
    return {
      protectedText: text,
      restore: (value) => polishTranslatedSubtitle(text, value, context),
    }
  }

  const replacements: Array<{ placeholder: string; surface: string }> = []
  let protectedText = text
  const surfaces = uniqueValues([
    context.primaryTitle ?? '',
    ...context.entities.map((entity) => entity.surface),
  ]).sort((left, right) => right.length - left.length)

  surfaces.forEach((surface, index) => {
    const pattern = new RegExp(escapeRegExp(surface), 'giu')
    if (!pattern.test(protectedText)) {
      return
    }

    const placeholder = `${ENTITY_PLACEHOLDER_PREFIX}${index}${ENTITY_PLACEHOLDER_SUFFIX}`
    protectedText = protectedText.replace(pattern, placeholder)
    replacements.push({ placeholder, surface })
  })

  return {
    protectedText,
    restore: (value) => {
      let restored = value
      for (const replacement of replacements) {
        const pattern = new RegExp(
          replacement.placeholder.split('').map((char) => `${escapeRegExp(char)}\\s*`).join(''),
          'giu',
        )
        restored = restored.replace(pattern, replacement.surface)
      }

      return polishTranslatedSubtitle(text, restored, context)
    },
  }
}

export function polishTranslatedSubtitle(
  japaneseText: string,
  chineseText: string,
  context?: SubtitleEntityContext,
) {
  const trimmedJapanese = japaneseText.trim()
  const trimmedChinese = chineseText.trim()
  const japaneseKey = normalizeLatinKey(trimmedJapanese)

  if (context?.primaryTitle && /映画|劇場版|movie|film/iu.test(trimmedJapanese)) {
    return `电影《${context.primaryTitle}》`
  }

  const exactEntity = context?.entities.find(
    (entity) => normalizeLatinKey(entity.surface) === japaneseKey,
  )
  if (exactEntity && japaneseKey.length >= 3) {
    return exactEntity.surface
  }

  const seasonMatch = trimmedJapanese.match(/(\d{4})年\s*(春|夏|秋|冬)\s*(?:公開予定|公開|予定)/u)
  if (seasonMatch) {
    return `预计 ${seasonMatch[1]} 年${seasonMatch[2]}公开`
  }

  const monthMatch = trimmedJapanese.match(/(\d{4})年\s*(\d{1,2})月\s*(?:公開予定|公開|予定)/u)
  if (monthMatch) {
    return `预计 ${monthMatch[1]} 年 ${Number(monthMatch[2])} 月公开`
  }

  return trimmedChinese
}
