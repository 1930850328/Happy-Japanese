import {
  createSongAnalysisJobId,
  normalizeSongAnalysisInput,
} from './song-analysis-contract.mjs'
import {
  createSongLyricVersion,
  isSongStudyIndexFresh,
} from './song-study-index.mjs'

const reusableStatuses = new Set(['pending', 'queued', 'failed'])
const writableStatuses = new Set(['pending', 'queued', 'failed'])

export function createStoredSongAnalysisInput(profileId, song) {
  return normalizeSongAnalysisInput({
    profileId,
    songId: song.id,
    title: song.title,
    artist: song.artist,
    lyricLines: song.lyricLines,
  })
}

export function prepareSongLearningGeneration({
  profileId,
  song,
  existingSong,
  now = new Date().toISOString(),
}) {
  if (song.lyricLines.length === 0) {
    return { song, input: null, jobId: undefined }
  }

  if (isSongStudyIndexFresh(song.studyIndex, song.id, song.lyricLines)) {
    return {
      song: {
        ...song,
        analysis: {
          jobId: existingSong?.analysis?.jobId,
          lyricVersion: song.studyIndex.lyricVersion,
          status: 'ready',
          updatedAt: existingSong?.analysis?.updatedAt || song.studyIndex.generatedAt || now,
        },
      },
      input: null,
      jobId: existingSong?.analysis?.jobId,
    }
  }

  const input = createStoredSongAnalysisInput(profileId, song)
  const jobId = createSongAnalysisJobId(input)
  const lyricVersion = createSongLyricVersion(song.lyricLines)
  const existingAnalysis = existingSong?.analysis
  const reusableAnalysis = existingAnalysis?.jobId === jobId
    && existingAnalysis.lyricVersion === lyricVersion
    && reusableStatuses.has(existingAnalysis.status)
    ? existingAnalysis
    : undefined

  return {
    song: {
      ...song,
      analysis: reusableAnalysis ?? {
        jobId,
        lyricVersion,
        status: 'pending',
        updatedAt: now,
      },
    },
    input,
    jobId,
  }
}

export async function updateSongLearningGenerationStatus({
  profileId,
  songId,
  jobId,
  lyricVersion,
  status,
  error,
  now = new Date().toISOString(),
  readSongIndex,
  writeSongIndex,
}) {
  if (!writableStatuses.has(status)) {
    throw new Error(`Unsupported song learning generation status: ${status}`)
  }

  const index = await readSongIndex(profileId)
  const songIndex = index.songs.findIndex((song) => song.id === songId)
  if (songIndex < 0) return { updated: false, reason: 'song-not-found' }

  const song = index.songs[songIndex]
  const currentLyricVersion = createSongLyricVersion(song.lyricLines)
  const currentJobId = createSongAnalysisJobId(createStoredSongAnalysisInput(profileId, song))
  if (
    currentJobId !== jobId
    || currentLyricVersion !== lyricVersion
    || (song.analysis && (
      song.analysis.jobId !== jobId
      || song.analysis.lyricVersion !== lyricVersion
    ))
  ) {
    return { updated: false, reason: 'stale-task' }
  }
  if (song.analysis?.status === 'ready') {
    return { updated: false, reason: 'already-ready' }
  }

  const analysis = {
    ...song.analysis,
    jobId,
    lyricVersion,
    status,
    updatedAt: now,
  }
  if (error) analysis.error = String(error).slice(0, 500)
  else delete analysis.error

  const songs = index.songs.slice()
  songs[songIndex] = { ...song, analysis }
  await writeSongIndex(profileId, { ...index, songs })
  return { updated: true, song: songs[songIndex] }
}
