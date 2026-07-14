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

export type StudyIndexQuality = 'trusted' | 'draft' | 'blocked'

export type StudyIndexStatus = 'ready' | 'needsReview' | 'failed'

export interface TranscriptCueIndex {
  id: string
  startMs: number
  endMs: number
  ja: string
  zh: string
  kana: string
  romaji: string
  termOccurrenceIds: string[]
  grammarOccurrenceIds: string[]
}

export interface TermOccurrence {
  id: string
  videoId: string
  cueId: string
  startMs: number
  endMs: number
  surface: string
  lemma: string
  reading: string
  kana: string
  romaji: string
  partOfSpeech: string
  meaningZh: string
  confidence: number
}

export interface GrammarOccurrence {
  id: string
  videoId: string
  cueId: string
  grammarId: string
  level: DifficultyLevel
  label: string
  matchedText: string
  meaningZh: string
  explanationZh: string
  startMs: number
  endMs: number
  exampleJa: string
  exampleZh: string
  confidence: number
}

export interface StudyIndex {
  version: 1
  videoId: string
  status: StudyIndexStatus
  quality: StudyIndexQuality
  sourceLabel: string
  generatedAt: string
  transcript: TranscriptCueIndex[]
  termOccurrences: TermOccurrence[]
  grammarOccurrences: GrammarOccurrence[]
  summary: {
    cueCount: number
    termCount: number
    grammarCount: number
    trusted: boolean
  }
}

export interface VideoLesson {
  id: string
  sourceType: LessonSourceType
  sourceIdOrBlobKey: string
  sourceFileName?: string
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

export type SongSourceType = 'local' | 'demo' | 'catalog'

export type LyricProvider = 'syncpower' | 'musixmatch' | 'lyricfind' | 'lrclib' | 'netease' | 'manual' | 'demo'

export type SongPlaybackProvider = 'appleMusic' | 'localFile' | 'previewOnly' | 'speech'

export type SongPlaybackStatus = 'locked' | 'ready' | 'loading' | 'error'

export type SongLyricQuality =
  | 'licensed_synced'
  | 'licensed_plain'
  | 'community_synced'
  | 'machine_translated'
  | 'manual_imported'
  | 'needs_review'

export type StudyStage = 'beginner' | 'intermediate' | 'advanced'

export type SongKnowledgeKind = 'word' | 'grammar'

export type SongKnowledgeSourceKind =
  | 'curated-vocab'
  | 'grammar-registry'
  | 'tokenizer'
  | 'lyric-context'
  | 'heuristic'
  | 'codex-agent'

export interface SongKnowledgeSource {
  kind: SongKnowledgeSourceKind
  label: string
  license?: string
  url?: string
}

interface SongKnowledgeBase {
  id: string
  kind: SongKnowledgeKind
  expression: string
  reading: string
  meaningZh: string
  explanationZh: string
  exampleJa: string
  exampleZh: string
  stage: StudyStage
  confidence: number
  sources: SongKnowledgeSource[]
}

export interface SongWordKnowledge extends SongKnowledgeBase {
  kind: 'word'
  lemma: string
  kana: string
  romaji: string
  partOfSpeech: string
}

export interface SongGrammarKnowledge extends SongKnowledgeBase {
  kind: 'grammar'
  grammarId: string
  pattern: string
}

export type SongKnowledge = SongWordKnowledge | SongGrammarKnowledge

export interface SongStudyOccurrence {
  id: string
  kind: SongKnowledgeKind
  lineId: string
  knowledgeId: string
  text: string
  startOffset: number
  endOffset: number
  startMs?: number
  endMs?: number
  stage: StudyStage
  confidence: number
}

export interface SongStudyLinePart {
  id: string
  text: string
  startOffset: number
  endOffset: number
  wordOccurrenceId?: string
  grammarOccurrenceIds: string[]
  startMs?: number
  endMs?: number
}

export interface SongStudyLine {
  lineId: string
  startMs: number
  endMs: number
  ja: string
  zh: string
  parts: SongStudyLinePart[]
  occurrenceIds: string[]
}

export interface SongStudyIndex {
  version: 1
  songId: string
  lyricVersion: string
  status: 'ready' | 'empty' | 'failed'
  quality: StudyIndexQuality
  generatedAt: string
  lines: SongStudyLine[]
  occurrences: SongStudyOccurrence[]
  knowledge: Record<string, SongKnowledge>
  stagePlans: Record<StudyStage, {
    focusOccurrenceIds: string[]
  }>
  summary: {
    lineCount: number
    wordCount: number
    grammarCount: number
    beginnerCount: number
    intermediateCount: number
    advancedCount: number
  }
}

export type LyricSection = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro'

export type LyricTimingQuality = 'word' | 'line-estimated' | 'line'
export type LyricWordTimingSource = 'netease-yrc' | 'amll-ttml' | 'kugou-krc'

export interface LyricWordTiming {
  id: string
  text: string
  startMs: number
  endMs: number
}

export interface LyricLine {
  id: string
  startMs: number
  endMs: number
  ja: string
  kana: string
  romaji: string
  zh: string
  section?: LyricSection
  focusTermIds: string[]
  wordTimings?: LyricWordTiming[]
  timingQuality?: LyricTimingQuality
  wordTimingSource?: LyricWordTimingSource
}

export interface SongLesson {
  id: string
  sourceType: SongSourceType
  sourceUrl: string
  sourcePageUrl?: string
  previewUrl?: string
  previewSearchTerm?: string
  lyricSearchTerm?: string
  appleMusicId?: string
  appleMusicSearchTerm?: string
  artworkUrl?: string
  playbackProvider?: SongPlaybackProvider
  playbackStatus?: SongPlaybackStatus
  lyricProvider?: LyricProvider
  lyricQuality?: SongLyricQuality
  releaseYear?: number
  popularityLabel?: string
  title: string
  artist: string
  cover: string
  theme: string
  difficulty: DifficultyLevel
  durationMs: number
  lyricLines: LyricLine[]
  studyIndex?: SongStudyIndex
  knowledgePoints: KnowledgePoint[]
  tags: string[]
  description: string
  creditLine: string
  quality: StudyIndexQuality
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
  sourceFileName?: string
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
  studyIndex?: StudyIndex
  createdAt: string
  segments: TranscriptSegment[]
  knowledgePoints: KnowledgePoint[]
  tags: string[]
  description: string
  creditLine: string
}

export type SliceTaskStatus = 'idle' | 'running' | 'completed' | 'error'

export interface SliceTaskState {
  status: SliceTaskStatus
  percent: number
  detail: string
  startedAt?: string
  updatedAt?: string
}

export interface SlicePreviewDraft {
  file: File
  title: string
  theme: string
  episodeTitle: string
  cover: string
  durationMs: number
  subtitleFileName?: string
  subtitleSource?: ImportedClip['subtitleSource']
  sourceProvider: string
  segments: ImportedClip['segments']
  knowledgePoints: ImportedClip['knowledgePoints']
  lessons: VideoLesson[]
  selectedLessonIds: string[]
}

export interface AppSettings {
  id: 'settings'
  remindersEnabled: boolean
  showRomaji: boolean
  showPlaybackKnowledge: boolean
  showJapaneseSubtitle: boolean
  showChineseSubtitle: boolean
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

export type CourseLevel = 'foundation' | 'N5' | 'N4' | 'N3' | 'N2' | 'N1'

export type CourseNodeKind =
  | 'kana'
  | 'vocabulary'
  | 'grammar'
  | 'reading'
  | 'strategy'

export interface CourseNode {
  id: string
  kind: CourseNodeKind
  level: CourseLevel
  title: string
  reading?: string
  meaningZh: string
  explanationZh: string
  prerequisiteNodeIds: string[]
}

export interface CourseExample {
  ja: string
  reading: string
  zh: string
  note?: string
}

export type CourseQuestionKind = 'meaning' | 'reading' | 'usage' | 'comprehension'

export interface CourseQuestion {
  id: string
  nodeId: string
  kind: CourseQuestionKind
  prompt: string
  context?: string
  options: string[]
  answerIndex: number
  explanationZh: string
}

export interface CourseLesson {
  id: string
  level: CourseLevel
  order: number
  title: string
  canDo: string
  description: string
  durationMinutes: number
  prerequisiteLessonIds: string[]
  nodeIds: string[]
  explanation: string[]
  examples: CourseExample[]
  questions: CourseQuestion[]
  songSearchTerms: string[]
  moduleTitle: string
  mission: string
  transferTask: string
}

export interface CourseStage {
  id: CourseLevel
  label: string
  title: string
  description: string
  canDo: string
  evidence: string
  lessonIds: string[]
}

export type CoursePlacement = 'new' | 'foundation' | 'elementary' | 'intermediate' | 'advanced'

export interface CourseProfile {
  target: 'N1'
  placement: CoursePlacement
  activeLessonId: string
  startedAt: string
}

export type CourseLessonStatus = 'available' | 'in_progress' | 'completed' | 'placed'

export interface CourseLessonProgress {
  lessonId: string
  status: CourseLessonStatus
  attempts: number
  bestScore: number
  lastStudiedAt?: string
  completedAt?: string
}

export type CourseMasteryState = 'learning' | 'reviewing' | 'stable' | 'at_risk'

export interface CourseMastery {
  nodeId: string
  state: CourseMasteryState
  confidence: number
  stabilityHours: number
  correctCount: number
  incorrectCount: number
  nextReviewAt: string
  lastReviewedAt: string
}

export type CourseEvidenceSource = 'lesson' | 'review' | 'placement'

export interface CourseEvidence {
  id: string
  nodeId: string
  questionId: string
  lessonId?: string
  source: CourseEvidenceSource
  correct: boolean
  elapsedMs: number
  createdAt: string
}

export type LiteracyItemKind = 'vocabulary' | 'kanji' | 'grammar'

export interface LiteracyItemProgress {
  itemId: string
  kind: LiteracyItemKind
  level: Exclude<CourseLevel, 'foundation'>
  confidence: number
  stabilityHours: number
  correctCount: number
  incorrectCount: number
  lastReviewedAt: string
  nextReviewAt: string
  meaningZh?: string
}

export interface ReadingAttempt {
  id: string
  passageId: string
  level: CourseLevel
  accuracy: number
  charactersPerMinute: number
  usedReadingAid: boolean
  usedTranslationAid: boolean
  completedAt: string
}

export interface LiteracyState {
  itemProgress: LiteracyItemProgress[]
  readingAttempts: ReadingAttempt[]
}

export interface CourseState {
  version: 1
  profile?: CourseProfile
  lessonProgress: CourseLessonProgress[]
  mastery: CourseMastery[]
  evidence: CourseEvidence[]
  literacy: LiteracyState
  updatedAt: string
}

export interface CalendarCell {
  key: string
  date: Date
  inCurrentMonth: boolean
  completed: boolean
  ratio: number
}
