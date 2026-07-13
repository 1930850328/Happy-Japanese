import type { LyricLine, SongStudyIndex, StudyIndexQuality } from '../src/types'
import type { SongAnalysis } from '../src/lib/songAnalysis'

export function createSongLyricVersion(lyricLines: LyricLine[]): string

export function isSongStudyIndexFresh(
  index: SongStudyIndex | undefined,
  songId: string,
  lyricLines: LyricLine[],
): boolean

export function buildSongStudyIndexFromAnalysis(input: {
  songId: string
  lyricLines: LyricLine[]
  analysis: SongAnalysis
  quality?: StudyIndexQuality
}): SongStudyIndex
