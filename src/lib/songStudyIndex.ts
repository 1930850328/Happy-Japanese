import type {
  KnowledgePoint,
  LyricLine,
  SongKnowledge,
  SongStudyIndex,
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
