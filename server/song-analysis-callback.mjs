import { createSongAnalysisJobId, normalizeSongAnalysisInput } from './song-analysis-contract.mjs'
import {
  buildSongStudyIndexFromAnalysis,
  createSongLyricVersion,
  isSongStudyIndexFresh,
} from './song-study-index.mjs'

export const SONG_ANALYSIS_CALLBACK_TYPE = 'song-analysis.completed'

function assertAnalysisResult(analysis, input) {
  if (!analysis || typeof analysis !== 'object' || analysis.version !== 1) {
    throw new Error('歌曲分析回调结果格式不正确')
  }
  if (analysis.songId !== input.songId || !Array.isArray(analysis.lines)) {
    throw new Error('歌曲分析回调与任务不匹配')
  }
  return analysis
}

export async function persistSongAnalysisResult({
  jobId,
  input: rawInput,
  analysis: rawAnalysis,
  readSongIndex,
  writeSongIndex,
}) {
  const input = normalizeSongAnalysisInput(rawInput)
  const analysis = assertAnalysisResult(rawAnalysis, input)
  if (!input.profileId) throw new Error('歌曲分析回调缺少 profileId')
  if (jobId !== createSongAnalysisJobId(input)) throw new Error('歌曲分析回调任务 ID 不匹配')

  const index = await readSongIndex(input.profileId)
  const songIndex = index.songs.findIndex((song) => song.id === input.songId)
  if (songIndex < 0) return { persisted: false, reason: 'song-not-found' }

  const song = index.songs[songIndex]
  const lyricVersion = createSongLyricVersion(song.lyricLines)
  if (lyricVersion !== createSongLyricVersion(input.lyricLines)) {
    return { persisted: false, reason: 'stale-lyrics' }
  }

  if (
    isSongStudyIndexFresh(song.studyIndex, song.id, song.lyricLines) &&
    song.analysis?.status === 'ready' &&
    song.analysis?.jobId === jobId
  ) {
    return { persisted: true, duplicate: true, studyIndex: song.studyIndex }
  }

  const studyIndex = isSongStudyIndexFresh(song.studyIndex, song.id, song.lyricLines)
    ? song.studyIndex
    : buildSongStudyIndexFromAnalysis({
        songId: song.id,
        lyricLines: song.lyricLines,
        analysis,
        quality: 'draft',
      })
  const now = new Date().toISOString()
  const songs = index.songs.slice()
  songs[songIndex] = {
    ...song,
    studyIndex,
    analysis: {
      jobId,
      lyricVersion,
      status: 'ready',
      updatedAt: now,
    },
    updatedAt: now,
  }
  await writeSongIndex(input.profileId, { ...index, songs })
  return { persisted: true, studyIndex }
}

function callbackConfig() {
  const url = process.env.SONG_ANALYSIS_CALLBACK_URL?.trim()
  const secret = process.env.SONG_ANALYSIS_CALLBACK_SECRET?.trim()
  if (!url) throw new Error('Missing SONG_ANALYSIS_CALLBACK_URL')
  if (!secret) throw new Error('Missing SONG_ANALYSIS_CALLBACK_SECRET')
  return { url, secret }
}

export async function sendSongAnalysisResult({ jobId, input, analysis, fetchImpl = fetch }) {
  if (!input.profileId) return { persisted: false, reason: 'local-song' }
  const { url, secret } = callbackConfig()
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: SONG_ANALYSIS_CALLBACK_TYPE,
      jobId,
      input,
      analysis,
    }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(body?.error || `歌曲分析结果保存失败 (${response.status})`)
  }
  return body
}
