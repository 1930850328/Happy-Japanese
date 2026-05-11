import { grammarPatterns } from '../data/grammarPatterns'
import { vocabCards } from '../data/vocabCards'
import type {
  DifficultyLevel,
  GrammarOccurrence,
  ImportedClip,
  KnowledgePoint,
  StudyIndex,
  TermOccurrence,
  TokenAnalysis,
  TranscriptCueIndex,
  TranscriptSegment,
  VideoLesson,
} from '../types'
import { analyzeJapaneseText, hasReliableMeaning } from './textAnalysis'

interface GrammarRule {
  regex: RegExp
  confidence: number
}

interface GrammarDefinition {
  id: string
  pattern: string
  label: string
  meaningZh: string
  explanationZh: string
  level: 'N5' | 'N4'
  aliases: string[]
  rules: GrammarRule[]
}

export interface GrammarStudyRequest {
  mode: 'beginner' | 'specific'
  query?: string
  maxLessons?: number
}

export interface TermStudyRequest {
  mode: 'beginner' | 'specific'
  query?: string
  maxLessons?: number
}

interface GrammarCandidate {
  clip: ImportedClip
  occurrence: GrammarOccurrence
  segmentIndex: number
  score: number
}

interface TermTarget {
  key: string
  label: string
  reading: string
  meaningZh: string
  level: DifficultyLevel
}

interface TermCandidate {
  clip: ImportedClip
  occurrence: TermOccurrence
  target?: TermTarget
  segmentIndex: number
  score: number
}

const DEFAULT_GRAMMAR_LESSON_LIMIT = 8
const DEFAULT_TERM_LESSON_LIMIT = 8
const MIN_GRAMMAR_SLICE_MS = 6500
const MAX_GRAMMAR_SLICE_MS = 26000
const GRAMMAR_CONTEXT_PAD_MS = 1200
const MIN_TERM_SLICE_MS = 6500
const MAX_TERM_SLICE_MS = 22000
const TERM_CONTEXT_PAD_MS = 1200

const grammarRuleMap = new Map<string, { aliases: string[]; rules: GrammarRule[] }>([
  [
    'desu',
    {
      aliases: ['です', 'でした', 'ではありません', 'じゃありません'],
      rules: [{ regex: /(?:です|でした|ではありません|じゃありません)/u, confidence: 0.86 }],
    },
  ],
  [
    'masu',
    {
      aliases: ['ます', 'ました', '動詞ます形'],
      rules: [
        {
          regex: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー々]+(?:ます|ました)/u,
          confidence: 0.78,
        },
      ],
    },
  ],
  [
    'masen',
    {
      aliases: ['ません', 'ませんでした', '否定ます形'],
      rules: [{ regex: /(?:ません|ませんでした)/u, confidence: 0.88 }],
    },
  ],
  [
    'tai',
    {
      aliases: ['たい', 'たくない', 'たいです', '想做'],
      rules: [
        {
          regex: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー々]+(?:たい|たくない|たかった)/u,
          confidence: 0.78,
        },
      ],
    },
  ],
  [
    'teiru',
    {
      aliases: ['ている', 'ています', 'てる', '正在'],
      rules: [
        {
          regex: /て(?:い(?:る|ます|た|ました|ない)|る)/u,
          confidence: 0.82,
        },
      ],
    },
  ],
  [
    'kara',
    {
      aliases: ['から', '因为'],
      rules: [{ regex: /から/u, confidence: 0.58 }],
    },
  ],
  [
    'node',
    {
      aliases: ['ので', '因为所以'],
      rules: [{ regex: /ので/u, confidence: 0.75 }],
    },
  ],
  [
    'temoii',
    {
      aliases: ['てもいい', 'てもよい', '可以'],
      rules: [{ regex: /ても(?:いい|よい|大丈夫)/u, confidence: 0.9 }],
    },
  ],
  [
    'nakerebanaranai',
    {
      aliases: ['なければならない', 'なきゃならない', 'なくてはいけない', 'ないといけない', '必须'],
      rules: [
        {
          regex: /(?:なければならない|なきゃならない|なくてはいけない|なければいけない|ないといけない)/u,
          confidence: 0.93,
        },
      ],
    },
  ],
  [
    'tsumori',
    {
      aliases: ['つもり', '打算'],
      rules: [{ regex: /つもり/u, confidence: 0.82 }],
    },
  ],
  [
    'dekiru',
    {
      aliases: ['ことができる', 'ことができます', '能够'],
      rules: [{ regex: /ことができ(?:る|ます|た|ました|ない)/u, confidence: 0.9 }],
    },
  ],
  [
    'mashou',
    {
      aliases: ['ましょう', 'ましょうか', '一起吧'],
      rules: [{ regex: /ましょう(?:か)?/u, confidence: 0.88 }],
    },
  ],
  [
    'deshou',
    {
      aliases: ['でしょう', 'だろう', '大概吧'],
      rules: [{ regex: /(?:でしょう|だろう)/u, confidence: 0.78 }],
    },
  ],
  [
    'teshimau',
    {
      aliases: ['てしまう', 'ちゃう', 'ちゃった', '不小心', '做完'],
      rules: [
        {
          regex: /(?:てしま(?:う|った|います|いました)|ちゃ(?:う|った)|じゃ(?:う|った))/u,
          confidence: 0.82,
        },
      ],
    },
  ],
])

const extraGrammarDefinitions: GrammarDefinition[] = [
  {
    id: 'ta-koto-ga-aru',
    pattern: 'たことがある',
    label: '经验 たことがある',
    meaningZh: '曾经……过',
    explanationZh: '接在动词た形后，表示过去有过某种经验。',
    level: 'N5',
    aliases: ['たことがある', 'たことがあります', 'ことがある', '曾经'],
    rules: [
      {
        regex: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー々]+たこと(?:が|は)?(?:ある|あります|あった|ありました)/u,
        confidence: 0.94,
      },
    ],
  },
]

let grammarDefinitionsCache: GrammarDefinition[] | null = null

function normalizeSearchText(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[〜～]/g, '')
    .replace(/[，]/g, '、')
    .replace(/[．]/g, '。')
}

function normalizeTermKey(input: string) {
  return normalizeSearchText(input).replace(/[・･、。？！?!「」『』（）()]/g, '')
}

function normalizeJapaneseText(input: string) {
  return input.replace(/\s+/g, '').replace(/[，]/g, '、').replace(/[．]/g, '。')
}

function includesNormalizedField(field: string, query: string) {
  const normalizedField = normalizeTermKey(field)
  const normalizedQuery = normalizeTermKey(query)
  return Boolean(
    normalizedField &&
      normalizedQuery &&
      (normalizedField.includes(normalizedQuery) || normalizedQuery.includes(normalizedField)),
  )
}

function hasJapaneseText(input: string) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー々]/u.test(input)
}

function getGrammarDefinitions() {
  if (grammarDefinitionsCache) {
    return grammarDefinitionsCache
  }

  const baseDefinitions = grammarPatterns.map<GrammarDefinition>((pattern) => {
    const configured = grammarRuleMap.get(pattern.id)
    return {
      ...pattern,
      level: pattern.level === 'N4' ? 'N4' : 'N5',
      aliases: configured?.aliases ?? [pattern.pattern, pattern.label],
      rules: configured?.rules ?? [{ regex: new RegExp(pattern.pattern, 'u'), confidence: 0.65 }],
    }
  })

  grammarDefinitionsCache = [...baseDefinitions, ...extraGrammarDefinitions]
  return grammarDefinitionsCache
}

function isUsefulIndexToken(token: TokenAnalysis) {
  const surface = token.surface.trim()
  if (surface.length < 2 || !hasJapaneseText(surface)) {
    return false
  }

  if (token.partOfSpeech === '未分类') {
    return false
  }

  return !/助詞|助動詞|記号|フィラー/u.test(token.partOfSpeech)
}

function buildTermConfidence(token: TokenAnalysis) {
  let confidence = hasReliableMeaning(token.meaningZh) ? 0.82 : 0.58
  if (/名詞|動詞|形容詞|副詞/u.test(token.partOfSpeech)) {
    confidence += 0.08
  }
  return Math.min(0.96, confidence)
}

function findGrammarMatches(text: string) {
  const normalizedText = normalizeJapaneseText(text)
  return getGrammarDefinitions().flatMap((definition) => {
    const hits = definition.rules
      .map((rule) => {
        const match = normalizedText.match(rule.regex)
        return match?.[0]
          ? {
              definition,
              matchedText: match[0],
              confidence: rule.confidence,
            }
          : null
      })
      .filter((hit): hit is NonNullable<typeof hit> => Boolean(hit))

    return hits.slice(0, 1)
  })
}

function resolveIndexMeta(subtitleSource: ImportedClip['subtitleSource'] | undefined) {
  if (subtitleSource === 'manual') {
    return {
      status: 'ready' as const,
      quality: 'trusted' as const,
      sourceLabel: '外部日文字幕',
    }
  }

  return {
    status: 'needsReview' as const,
    quality: 'draft' as const,
    sourceLabel: '自动字幕草稿',
  }
}

export async function buildStudyIndex({
  videoId,
  segments,
  subtitleSource,
  includeOccurrences = true,
}: {
  videoId: string
  segments: TranscriptSegment[]
  subtitleSource?: ImportedClip['subtitleSource']
  includeOccurrences?: boolean
}): Promise<StudyIndex> {
  const meta = resolveIndexMeta(subtitleSource)
  const transcript: TranscriptCueIndex[] = []
  const termOccurrences: TermOccurrence[] = []
  const grammarOccurrences: GrammarOccurrence[] = []

  for (const [segmentIndex, segment] of segments.entries()) {
    const ja = segment.ja.trim()
    if (!ja || !hasJapaneseText(ja)) {
      continue
    }

    const cueId = `${videoId}:cue-${segmentIndex + 1}`
    const analysis = includeOccurrences ? await analyzeJapaneseText(ja) : null
    const cueTermIds: string[] = []
    const cueGrammarIds: string[] = []
    const seenTerms = new Set<string>()

    if (includeOccurrences && analysis) {
      for (const [tokenIndex, token] of analysis.tokens.entries()) {
        if (!isUsefulIndexToken(token)) {
          continue
        }

        const lemma = token.base || token.surface
        const termKey = `${lemma}:${token.partOfSpeech}`
        if (seenTerms.has(termKey)) {
          continue
        }

        seenTerms.add(termKey)
        const occurrence: TermOccurrence = {
          id: `${cueId}:term-${tokenIndex + 1}`,
          videoId,
          cueId,
          startMs: segment.startMs,
          endMs: segment.endMs,
          surface: token.surface,
          lemma,
          reading: token.reading,
          kana: token.kana,
          romaji: token.romaji,
          partOfSpeech: token.partOfSpeech,
          meaningZh: token.meaningZh,
          confidence: buildTermConfidence(token),
        }
        cueTermIds.push(occurrence.id)
        termOccurrences.push(occurrence)
      }

      for (const [matchIndex, match] of findGrammarMatches(ja).entries()) {
        const occurrence: GrammarOccurrence = {
          id: `${cueId}:grammar-${match.definition.id}-${matchIndex + 1}`,
          videoId,
          cueId,
          grammarId: match.definition.id,
          level: match.definition.level,
          label: match.definition.label,
          matchedText: match.matchedText,
          meaningZh: match.definition.meaningZh,
          explanationZh: match.definition.explanationZh,
          startMs: segment.startMs,
          endMs: segment.endMs,
          exampleJa: ja,
          exampleZh: segment.zh,
          confidence: match.confidence,
        }
        cueGrammarIds.push(occurrence.id)
        grammarOccurrences.push(occurrence)
      }
    }

    transcript.push({
      id: cueId,
      startMs: segment.startMs,
      endMs: segment.endMs,
      ja,
      zh: segment.zh,
      kana: segment.kana || analysis?.kana || ja,
      romaji: segment.romaji || analysis?.romaji || '',
      termOccurrenceIds: cueTermIds,
      grammarOccurrenceIds: cueGrammarIds,
    })
  }

  const status: StudyIndex['status'] = transcript.length === 0 ? 'failed' : meta.status
  const quality: StudyIndex['quality'] = transcript.length === 0 ? 'blocked' : meta.quality

  return {
    version: 1 as const,
    videoId,
    status,
    quality,
    sourceLabel: meta.sourceLabel,
    generatedAt: new Date().toISOString(),
    transcript,
    termOccurrences,
    grammarOccurrences,
    summary: {
      cueCount: transcript.length,
      termCount: termOccurrences.length,
      grammarCount: grammarOccurrences.length,
      trusted: quality === 'trusted',
    },
  }
}

function resolveGrammarTargets(request: GrammarStudyRequest) {
  const definitions = getGrammarDefinitions()
  if (request.mode === 'beginner') {
    return definitions.filter((definition) => definition.level === 'N5' || definition.level === 'N4')
  }

  const query = normalizeSearchText(request.query ?? '')
  if (!query) {
    return []
  }

  return definitions.filter((definition) => {
    const fields = [
      definition.id,
      definition.pattern,
      definition.label,
      definition.meaningZh,
      ...definition.aliases,
    ].map(normalizeSearchText)

    return fields.some((field) => field.includes(query) || query.includes(field))
  })
}

function resolveTermTargets(request: TermStudyRequest) {
  if (request.mode === 'beginner') {
    return vocabCards
      .filter((card) => card.level === 'N5' || card.level === 'N4')
      .map<TermTarget>((card) => ({
        key: normalizeTermKey(card.term),
        label: card.term,
        reading: card.reading,
        meaningZh: card.meaningZh,
        level: card.level,
      }))
  }

  const query = normalizeTermKey(request.query ?? '')
  if (!query) {
    return []
  }

  return [
    {
      key: query,
      label: request.query?.trim() || query,
      reading: '',
      meaningZh: '',
      level: 'Custom',
    },
  ] satisfies TermTarget[]
}

function getOccurrenceSegmentIndex(
  clip: ImportedClip,
  occurrence: Pick<GrammarOccurrence | TermOccurrence, 'cueId' | 'startMs' | 'endMs'>,
) {
  const cueIndex = clip.studyIndex?.transcript.findIndex((cue) => cue.id === occurrence.cueId)
  if (typeof cueIndex === 'number' && cueIndex >= 0 && clip.segments[cueIndex]) {
    return cueIndex
  }

  return clip.segments.findIndex(
    (segment) => segment.startMs <= occurrence.startMs && segment.endMs >= occurrence.endMs,
  )
}

function findSegmentIndex(clip: ImportedClip, occurrence: GrammarOccurrence) {
  return getOccurrenceSegmentIndex(clip, occurrence)
}

function findTermSegmentIndex(clip: ImportedClip, occurrence: TermOccurrence) {
  return getOccurrenceSegmentIndex(clip, occurrence)
}

function scoreCandidate(clip: ImportedClip, occurrence: GrammarOccurrence) {
  const trustedScore = clip.studyIndex?.quality === 'trusted' ? 12 : 0
  const reviewPenalty = clip.studyIndex?.quality === 'draft' ? -3 : 0
  const sentenceLength = occurrence.exampleJa.length
  const lengthScore = sentenceLength >= 6 && sentenceLength <= 42 ? 5 : 0
  const translationScore = occurrence.exampleZh.trim() ? 4 : 0
  return trustedScore + reviewPenalty + occurrence.confidence * 10 + lengthScore + translationScore
}

function scoreTermCandidate(clip: ImportedClip, occurrence: TermOccurrence, target?: TermTarget) {
  const trustedScore = clip.studyIndex?.quality === 'trusted' ? 12 : 0
  const reviewPenalty = clip.studyIndex?.quality === 'draft' ? -3 : 0
  const meaningScore = hasReliableMeaning(occurrence.meaningZh) || target?.meaningZh ? 4 : 0
  const levelScore = target?.level === 'N5' ? 3 : target?.level === 'N4' ? 2 : 0
  return trustedScore + reviewPenalty + occurrence.confidence * 10 + meaningScore + levelScore
}

function hasWindowOverlap(left: GrammarCandidate, right: GrammarCandidate) {
  return (
    left.clip.id === right.clip.id &&
    left.occurrence.startMs < right.occurrence.endMs &&
    right.occurrence.startMs < left.occurrence.endMs
  )
}

function hasTermWindowOverlap(left: TermCandidate, right: TermCandidate) {
  return (
    left.clip.id === right.clip.id &&
    left.occurrence.startMs < right.occurrence.endMs &&
    right.occurrence.startMs < left.occurrence.endMs
  )
}

function normalizeSegmentsForWindow(
  segments: TranscriptSegment[],
  offsetMs: number,
  pointId: string,
  occurrence: GrammarOccurrence,
) {
  return segments.map((segment) => {
    const overlapsOccurrence = segment.startMs < occurrence.endMs && occurrence.startMs < segment.endMs
    const focusTermIds = segment.focusTermIds ?? []
    return {
      ...segment,
      startMs: Math.max(0, segment.startMs - offsetMs),
      endMs: Math.max(0, segment.endMs - offsetMs),
      focusTermIds: overlapsOccurrence
        ? [...new Set([...focusTermIds, pointId])]
        : focusTermIds,
    }
  })
}

function normalizeTermSegmentsForWindow(
  segments: TranscriptSegment[],
  offsetMs: number,
  pointId: string,
  occurrence: TermOccurrence,
) {
  return segments.map((segment) => {
    const overlapsOccurrence = segment.startMs < occurrence.endMs && occurrence.startMs < segment.endMs
    const focusTermIds = segment.focusTermIds ?? []
    return {
      ...segment,
      startMs: Math.max(0, segment.startMs - offsetMs),
      endMs: Math.max(0, segment.endMs - offsetMs),
      focusTermIds: overlapsOccurrence
        ? [...new Set([...focusTermIds, pointId])]
        : focusTermIds,
    }
  })
}

function buildKnowledgePoint(occurrence: GrammarOccurrence): KnowledgePoint {
  return {
    id: `grammar-occurrence:${occurrence.id}`,
    kind: 'grammar',
    expression: occurrence.matchedText,
    reading: occurrence.matchedText,
    meaningZh: occurrence.meaningZh,
    partOfSpeech: `语法 / ${occurrence.level}`,
    explanationZh: `${occurrence.label}：${occurrence.explanationZh}`,
    exampleJa: occurrence.exampleJa,
    exampleZh: occurrence.exampleZh,
  }
}

function buildTermKnowledgePoint(occurrence: TermOccurrence, target?: TermTarget): KnowledgePoint {
  const expression = target?.label || occurrence.surface
  const meaningZh = target?.meaningZh || occurrence.meaningZh

  return {
    id: `term-occurrence:${occurrence.id}`,
    kind: 'word',
    expression,
    reading: target?.reading || occurrence.kana || occurrence.reading,
    meaningZh,
    partOfSpeech: occurrence.partOfSpeech,
    explanationZh: hasReliableMeaning(meaningZh)
      ? `${expression} 在这句里更接近“${meaningZh}”这个意思。`
      : `${expression} 是片中出现的表达，建议结合原句记住它的用法。`,
    exampleJa: '',
    exampleZh: '',
  }
}

function buildCandidateLesson(candidate: GrammarCandidate, index: number): VideoLesson {
  const { clip, occurrence } = candidate
  const validSegments = clip.segments.filter((segment) => segment.endMs > segment.startMs)
  const indexedSegmentIndex = validSegments.findIndex(
    (segment) => segment.startMs <= occurrence.startMs && segment.endMs >= occurrence.endMs,
  )
  let startIndex =
    indexedSegmentIndex >= 0
      ? indexedSegmentIndex
      : Math.min(candidate.segmentIndex, Math.max(0, validSegments.length - 1))
  let endIndex = startIndex

  while (
    endIndex + 1 < validSegments.length &&
    validSegments[endIndex].endMs - validSegments[startIndex].startMs < MIN_GRAMMAR_SLICE_MS
  ) {
    endIndex += 1
  }

  while (
    startIndex > 0 &&
    validSegments[endIndex].endMs - validSegments[startIndex].startMs < MIN_GRAMMAR_SLICE_MS
  ) {
    startIndex -= 1
  }

  const rawStartMs = validSegments[startIndex]?.startMs ?? occurrence.startMs
  const rawEndMs = validSegments[endIndex]?.endMs ?? occurrence.endMs
  const startMs = Math.max(0, rawStartMs - GRAMMAR_CONTEXT_PAD_MS)
  const endMs = Math.min(
    clip.durationMs,
    Math.max(rawEndMs + GRAMMAR_CONTEXT_PAD_MS, startMs + MIN_GRAMMAR_SLICE_MS),
  )
  const cappedEndMs = Math.min(endMs, startMs + MAX_GRAMMAR_SLICE_MS)
  const windowSegments = validSegments.filter(
    (segment) => segment.startMs < cappedEndMs && segment.endMs > startMs,
  )
  const point = buildKnowledgePoint(occurrence)
  const sourceTitle = clip.sourceAnimeTitle ?? clip.title
  const qualityTag = clip.studyIndex?.quality === 'trusted' ? '可信字幕' : '字幕待校对'

  return {
    id: `grammar-plan:${clip.id}:${occurrence.grammarId}:${occurrence.cueId}`,
    originClipId: clip.id,
    sourceType: clip.sourceType,
    sourceIdOrBlobKey: clip.sourceIdOrBlobKey,
    sourceFileName: clip.sourceFileName,
    sourceUrl: clip.sourceUrl,
    sourceProvider: `${clip.sourceProvider} / 语法索引`,
    title: `${sourceTitle} - ${occurrence.label}`,
    cover: clip.cover,
    theme: clip.theme,
    difficulty: occurrence.level,
    durationMs: cappedEndMs - startMs,
    clipStartMs: startMs,
    clipEndMs: cappedEndMs,
    segments: normalizeSegmentsForWindow(windowSegments, startMs, point.id, occurrence),
    knowledgePoints: [point],
    tags: [...new Set(['语法检索', occurrence.level, occurrence.label, qualityTag])],
    description: `从整片字幕索引命中「${occurrence.matchedText}」，用于学习 ${occurrence.label}。`,
    creditLine:
      clip.studyIndex?.quality === 'trusted'
        ? '这条切片来自已绑定字幕的整片索引，播放器会直接按时间段播放原视频。'
        : '这条切片来自自动字幕草稿，学习前建议核对日文原句。',
    sliceLabel: `${Math.round((cappedEndMs - startMs) / 1000)} 秒语法切片`,
    feedPriority: 150 - index,
  }
}

function buildTermCandidateLesson(candidate: TermCandidate, index: number): VideoLesson {
  const { clip, occurrence, target } = candidate
  const validSegments = clip.segments.filter((segment) => segment.endMs > segment.startMs)
  const indexedSegmentIndex = validSegments.findIndex(
    (segment) => segment.startMs <= occurrence.startMs && segment.endMs >= occurrence.endMs,
  )
  let startIndex =
    indexedSegmentIndex >= 0
      ? indexedSegmentIndex
      : Math.min(candidate.segmentIndex, Math.max(0, validSegments.length - 1))
  let endIndex = startIndex

  while (
    endIndex + 1 < validSegments.length &&
    validSegments[endIndex].endMs - validSegments[startIndex].startMs < MIN_TERM_SLICE_MS
  ) {
    endIndex += 1
  }

  while (
    startIndex > 0 &&
    validSegments[endIndex].endMs - validSegments[startIndex].startMs < MIN_TERM_SLICE_MS
  ) {
    startIndex -= 1
  }

  const rawStartMs = validSegments[startIndex]?.startMs ?? occurrence.startMs
  const rawEndMs = validSegments[endIndex]?.endMs ?? occurrence.endMs
  const startMs = Math.max(0, rawStartMs - TERM_CONTEXT_PAD_MS)
  const endMs = Math.min(
    clip.durationMs,
    Math.max(rawEndMs + TERM_CONTEXT_PAD_MS, startMs + MIN_TERM_SLICE_MS),
  )
  const cappedEndMs = Math.min(endMs, startMs + MAX_TERM_SLICE_MS)
  const windowSegments = validSegments.filter(
    (segment) => segment.startMs < cappedEndMs && segment.endMs > startMs,
  )
  const hitSegment = validSegments[startIndex]
  const point = {
    ...buildTermKnowledgePoint(occurrence, target),
    exampleJa: hitSegment?.ja ?? '',
    exampleZh: hitSegment?.zh ?? '',
  }
  const sourceTitle = clip.sourceAnimeTitle ?? clip.title
  const qualityTag = clip.studyIndex?.quality === 'trusted' ? '可信字幕' : '字幕待校对'
  const displayTerm = target?.label || occurrence.surface

  return {
    id: `term-plan:${clip.id}:${normalizeTermKey(displayTerm)}:${occurrence.cueId}`,
    originClipId: clip.id,
    sourceType: clip.sourceType,
    sourceIdOrBlobKey: clip.sourceIdOrBlobKey,
    sourceFileName: clip.sourceFileName,
    sourceUrl: clip.sourceUrl,
    sourceProvider: `${clip.sourceProvider} / 单词索引`,
    title: `${sourceTitle} - ${displayTerm}`,
    cover: clip.cover,
    theme: clip.theme,
    difficulty: target?.level ?? 'Custom',
    durationMs: cappedEndMs - startMs,
    clipStartMs: startMs,
    clipEndMs: cappedEndMs,
    segments: normalizeTermSegmentsForWindow(windowSegments, startMs, point.id, occurrence),
    knowledgePoints: [point],
    tags: [...new Set(['单词检索', target?.level ?? 'Custom', displayTerm, qualityTag])],
    description: `从整片字幕索引命中「${occurrence.surface}」，用于学习 ${displayTerm}。`,
    creditLine:
      clip.studyIndex?.quality === 'trusted'
        ? '这条切片来自已绑定字幕的整片索引，播放器会直接按时间段播放原视频。'
        : '这条切片来自自动字幕草稿，学习前建议核对日文原句。',
    sliceLabel: `${Math.round((cappedEndMs - startMs) / 1000)} 秒单词切片`,
    feedPriority: 148 - index,
  }
}

export function buildGrammarStudyLessons(
  clips: ImportedClip[],
  request: GrammarStudyRequest,
) {
  const targetIds = new Set(resolveGrammarTargets(request).map((definition) => definition.id))
  if (targetIds.size === 0) {
    return []
  }

  const candidates: GrammarCandidate[] = []
  for (const clip of clips) {
    if (clip.importMode === 'sliced' || !clip.studyIndex || clip.studyIndex.status === 'failed') {
      continue
    }

    for (const occurrence of clip.studyIndex.grammarOccurrences) {
      if (!targetIds.has(occurrence.grammarId)) {
        continue
      }

      const segmentIndex = findSegmentIndex(clip, occurrence)
      if (segmentIndex < 0) {
        continue
      }

      candidates.push({
        clip,
        occurrence,
        segmentIndex,
        score: scoreCandidate(clip, occurrence),
      })
    }
  }

  const maxLessons = request.maxLessons ?? DEFAULT_GRAMMAR_LESSON_LIMIT
  const selected: GrammarCandidate[] = []
  const grammarUsage = new Map<string, number>()
  const maxPerGrammar = request.mode === 'specific' ? maxLessons : 2

  for (const candidate of candidates.sort((left, right) => right.score - left.score)) {
    const currentUsage = grammarUsage.get(candidate.occurrence.grammarId) ?? 0
    if (currentUsage >= maxPerGrammar) {
      continue
    }

    if (selected.some((existing) => hasWindowOverlap(existing, candidate))) {
      continue
    }

    selected.push(candidate)
    grammarUsage.set(candidate.occurrence.grammarId, currentUsage + 1)
    if (selected.length >= maxLessons) {
      break
    }
  }

  return selected
    .sort((left, right) => left.occurrence.startMs - right.occurrence.startMs)
    .map((candidate, index) => buildCandidateLesson(candidate, index))
}

function occurrenceMatchesTermTarget(occurrence: TermOccurrence, target: TermTarget) {
  return [
    occurrence.surface,
    occurrence.lemma,
    occurrence.reading,
    occurrence.kana,
    occurrence.romaji,
    occurrence.meaningZh,
  ].some((field) => includesNormalizedField(field, target.key))
}

function findMatchedTermTarget(occurrence: TermOccurrence, targets: TermTarget[]) {
  return targets.find((target) => occurrenceMatchesTermTarget(occurrence, target))
}

export function buildTermStudyLessons(
  clips: ImportedClip[],
  request: TermStudyRequest,
) {
  const targets = resolveTermTargets(request)
  if (targets.length === 0) {
    return []
  }

  const candidates: TermCandidate[] = []
  for (const clip of clips) {
    if (clip.importMode === 'sliced' || !clip.studyIndex || clip.studyIndex.status === 'failed') {
      continue
    }

    for (const occurrence of clip.studyIndex.termOccurrences) {
      const target = findMatchedTermTarget(occurrence, targets)
      if (!target) {
        continue
      }

      const segmentIndex = findTermSegmentIndex(clip, occurrence)
      if (segmentIndex < 0) {
        continue
      }

      candidates.push({
        clip,
        occurrence,
        target,
        segmentIndex,
        score: scoreTermCandidate(clip, occurrence, target),
      })
    }
  }

  const maxLessons = request.maxLessons ?? DEFAULT_TERM_LESSON_LIMIT
  const selected: TermCandidate[] = []
  const termUsage = new Map<string, number>()
  const maxPerTerm = request.mode === 'specific' ? maxLessons : 2

  for (const candidate of candidates.sort((left, right) => right.score - left.score)) {
    const usageKey = candidate.target?.key || normalizeTermKey(candidate.occurrence.lemma)
    const currentUsage = termUsage.get(usageKey) ?? 0
    if (currentUsage >= maxPerTerm) {
      continue
    }

    if (selected.some((existing) => hasTermWindowOverlap(existing, candidate))) {
      continue
    }

    selected.push(candidate)
    termUsage.set(usageKey, currentUsage + 1)
    if (selected.length >= maxLessons) {
      break
    }
  }

  return selected
    .sort((left, right) => left.occurrence.startMs - right.occurrence.startMs)
    .map((candidate, index) => buildTermCandidateLesson(candidate, index))
}
