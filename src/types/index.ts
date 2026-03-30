export type DifficultyLevel = 'N5' | 'N4' | 'Mixed' | 'Custom'

export type LessonSourceType = 'local' | 'bilibili'

export type KnowledgePointKind = 'word' | 'grammar' | 'phrase'

export interface TranscriptSegment {
  startMs: number
  endMs: number
  ja: string
  kana: string
  romaji: string
  zh: string
  focusTermIds: string[]
}

export interface KnowledgePoint {
  id: string
  kind: KnowledgePointKind
  expression: string
  reading: string
  meaningZh: string
  partOfSpeech: string
  explanationZh: string
  exampleJa: string
  exampleZh: string
}

export interface VideoLesson {
  id: string
  sourceType: LessonSourceType
  sourceIdOrBlobKey: string
  sourceUrl: string
  sourceProvider: string
  sourceStartSec?: number
  originClipId?: string
  clipStartMs?: number
  clipEndMs?: number
  title: string
  cover: string
  theme: string
  difficulty: DifficultyLevel
  durationMs: number
  segments: TranscriptSegment[]
  knowledgePoints: KnowledgePoint[]
  tags: string[]
  description: string
  creditLine: string
  sliceLabel?: string
  feedPriority?: number
}

export interface TokenAnalysis {
  id: string
  surface: string
  base: string
  reading: string
  kana: string
  romaji: string
  partOfSpeech: string
  meaningZh: string
}

export interface GrammarPattern {
  id: string
  pattern: string
  label: string
  meaningZh: string
  explanationZh: string
  level: DifficultyLevel
}

export interface GrammarMatch extends GrammarPattern {
  matchedText: string
}

export interface SentenceAnalysis {
  input: string
  tokens: TokenAnalysis[]
  kana: string
  romaji: string
  glossZh: string
  grammarMatches: GrammarMatch[]
  noteIds: string[]
  audioSupport: boolean
}

export type SavedNoteTarget = 'sentence' | 'word'

export interface SavedNote {
  id: string
  targetType: SavedNoteTarget
  input: string
  note: string
  tokenSurface?: string
  createdAt: string
  updatedAt: string
  analysisSnapshot?: SentenceAnalysis
}

export interface DailyGoal {
  id: 'daily-goals'
  videosTarget: number
  wordsTarget: number
  grammarTarget: number
  reviewTarget: number
  updatedAt: string
}

export type StudyEventType = 'video' | 'word' | 'grammar' | 'review'

export interface StudyEvent {
  id: string
  type: StudyEventType
  sourceId: string
  title: string
  count: number
  date: string
  dedupeKey: string
  createdAt: string
}

export type ReviewItemKind = 'word' | 'grammar' | 'phrase' | 'video'

export type ReviewResult = 'know' | 'fuzzy' | 'forget'

export interface ReviewItem {
  id: string
  kind: ReviewItemKind
  sourceId: string
  lessonId?: string
  expression: string
  reading: string
  meaningZh: string
  context: string
  intervalIndex: number
  nextReviewAt: string
  lastReviewedAt?: string
  createdAt: string
}

export interface ReviewLog {
  id: string
  reviewItemId: string
  result: ReviewResult
  reviewedAt: string
}

export interface VocabCard {
  id: string
  term: string
  reading: string
  romaji: string
  meaningZh: string
  theme: string
  level: DifficultyLevel
  exampleJa: string
  exampleZh: string
  memoryTip: string
  source: string
}

export interface VocabProgress {
  id: string
  mastered: boolean
  reviewAdded: boolean
  flippedCount: number
  lastStudiedAt?: string
}

export interface ImportedClip {
  id: string
  title: string
  theme: string
  difficulty: DifficultyLevel
  importMode?: 'raw' | 'sliced' | 'source'
  sourceAnimeTitle?: string
  sourceEpisodeTitle?: string
  sourceSliceId?: string
  sourceClipId?: string
  sourceType: 'local'
  sourceIdOrBlobKey: string
  sourceUrl: string
  sourceProvider: string
  cover: string
  durationMs: number
  clipStartMs?: number
  clipEndMs?: number
  fileType: string
  subtitleFileName?: string
  subtitleSource?: 'manual' | 'auto'
  blob?: Blob
  createdAt: string
  segments: TranscriptSegment[]
  knowledgePoints: KnowledgePoint[]
  tags: string[]
  description: string
  creditLine: string
}

export interface AppSettings {
  id: 'settings'
  remindersEnabled: boolean
  showRomaji: boolean
  accentMode: 'macaron'
  installedAt?: string
}

export interface SourceAttribution {
  id: string
  title: string
  href: string
  provider: string
  license: string
  note: string
}

export interface TodayProgress {
  video: number
  word: number
  grammar: number
  review: number
}

export interface CalendarCell {
  key: string
  date: Date
  inCurrentMonth: boolean
  completed: boolean
  ratio: number
}
