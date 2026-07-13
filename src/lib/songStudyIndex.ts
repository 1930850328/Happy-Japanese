import type {
  KnowledgePoint,
  LyricLine,
  SongKnowledge,
  SongStudyIndex,
  SongStudyLine,
  StudyIndexQuality,
} from '../types'
import {
  buildSongStudyIndexFromAnalysis,
  createSongLyricVersion,
  isSongStudyIndexFresh,
} from '../../server/song-study-index.mjs'
import { analyzeSongWithAgent, type SongAnalysisProgress } from './songAnalysis'

interface BuildSongStudyIndexInput {
  songId: string
  title?: string
  artist?: string
  lyricLines: LyricLine[]
  quality?: StudyIndexQuality
  onProgress?: (progress: SongAnalysisProgress) => void
}

export async function buildSongStudyIndex({
  songId,
  title,
  artist,
  lyricLines,
  quality = 'draft',
  onProgress,
}: BuildSongStudyIndexInput): Promise<SongStudyIndex> {
  const analysis = await analyzeSongWithAgent(songId, lyricLines, title, artist, onProgress)
  return buildSongStudyIndexFromAnalysis({
    songId,
    lyricLines,
    analysis,
    quality,
  })
}

export { createSongLyricVersion, isSongStudyIndexFresh }

export function getActiveSongStudyPartId(studyLine: SongStudyLine | undefined, currentMs: number) {
  const timedParts = studyLine?.parts.filter((part) => (
    part.wordOccurrenceId &&
    typeof part.startMs === 'number' &&
    typeof part.endMs === 'number' &&
    part.endMs > part.startMs
  )) ?? []

  const timedPart = timedParts.find((part) => currentMs >= part.startMs! && currentMs < part.endMs!)
  if (timedPart) return timedPart.id

  const focusParts = studyLine?.parts.filter((part) => part.wordOccurrenceId || part.grammarOccurrenceIds.length > 0) ?? []
  if (!studyLine || focusParts.length === 0) return ''

  const durationMs = Math.max(1200, studyLine.endMs - studyLine.startMs)
  const ratio = Math.min(0.999, Math.max(0, (currentMs - studyLine.startMs) / durationMs))
  return focusParts[Math.floor(ratio * focusParts.length)]?.id ?? ''
}

export function songKnowledgeToKnowledgePoint(knowledge: SongKnowledge): KnowledgePoint {
  return {
    id: knowledge.id,
    kind: knowledge.kind,
    expression: knowledge.expression,
    reading: knowledge.reading,
    meaningZh: knowledge.meaningZh,
    partOfSpeech: knowledge.kind === 'word' ? knowledge.partOfSpeech : '语法',
    explanationZh: knowledge.explanationZh,
    exampleJa: knowledge.exampleJa,
    exampleZh: knowledge.exampleZh,
  }
}
