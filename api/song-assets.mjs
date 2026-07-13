import {
  assertSongObjectKeyForProfile,
  deleteTosObjects,
  readSongIndex,
  sanitizeProfileId,
  sanitizeSongId,
  writeSongIndex,
} from './_tos-storage.mjs'
import {
  createSongAnalysisJobId,
  normalizeSongAnalysisInput,
} from '../server/song-analysis-contract.mjs'
import {
  createSongAnalysisQueue,
  enqueueSongAnalysis,
} from '../server/song-analysis-queue.mjs'
import {
  createSongLyricVersion,
  isSongStudyIndexFresh,
} from '../server/song-study-index.mjs'

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function readBody(req) {
  if (typeof req.body === 'string' && req.body) {
    return JSON.parse(req.body)
  }

  return req.body ?? {}
}

function readProfileId(req) {
  if (req.method === 'GET') {
    return sanitizeProfileId(req.query?.profileId)
  }

  const body = readBody(req)
  return sanitizeProfileId(body.profileId)
}

function readString(value, maxLength, fallback = '') {
  return String(value ?? fallback).trim().slice(0, maxLength)
}

function readLyricWordTimings(value) {
  if (!Array.isArray(value)) {
    return undefined
  }

  const timings = value
    .map((word, index) => {
      const startMs = Math.max(0, Math.round(Number(word?.startMs ?? 0)))
      const endMs = Math.max(0, Math.round(Number(word?.endMs ?? 0)))
      return {
        id: readString(word?.id, 100, `word-${index + 1}`),
        text: readString(word?.text, 200),
        startMs,
        endMs,
      }
    })
    .filter((word) => word.text && word.endMs > word.startMs)

  return timings.length > 0 ? timings : undefined
}

function readLyricTimingQuality(value) {
  const quality = readString(value, 40)
  return ['word', 'line-estimated', 'line'].includes(quality) ? quality : undefined
}

function readLyricLines(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((line, index) => ({
      id: readString(line?.id, 80, `lyric-${index + 1}`),
      startMs: Math.max(0, Math.round(Number(line?.startMs ?? 0))),
      endMs: Math.max(0, Math.round(Number(line?.endMs ?? 0))),
      ja: readString(line?.ja, 1000),
      kana: readString(line?.kana, 1000),
      romaji: readString(line?.romaji, 1000),
      zh: readString(line?.zh, 1000),
      section: line?.section,
      focusTermIds: Array.isArray(line?.focusTermIds)
        ? line.focusTermIds.map((item) => readString(item, 80)).filter(Boolean)
        : [],
      wordTimings: readLyricWordTimings(line?.wordTimings),
      timingQuality: readLyricTimingQuality(line?.timingQuality),
    }))
    .filter((line) => line.ja)
}

function readLyricProvider(value) {
  const provider = readString(value, 40)
  return ['syncpower', 'musixmatch', 'lyricfind', 'lrclib', 'netease', 'manual', 'demo'].includes(provider)
    ? provider
    : undefined
}

function readLyricQuality(value) {
  const quality = readString(value, 40)
  return [
    'licensed_synced',
    'licensed_plain',
    'community_synced',
    'machine_translated',
    'manual_imported',
    'needs_review',
  ].includes(quality)
    ? quality
    : undefined
}

function readStudyIndexQuality(value) {
  const quality = readString(value, 40)
  return ['trusted', 'draft', 'blocked'].includes(quality) ? quality : 'draft'
}

function readStudyIndexStatus(value) {
  const status = readString(value, 40)
  return ['ready', 'empty', 'failed'].includes(status) ? status : 'ready'
}

function sanitizeJsonValue(value, depth = 0) {
  if (depth > 8) {
    return undefined
  }

  if (value === null || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value === 'string') {
    return readString(value, 2000)
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 3000)
      .map((item) => sanitizeJsonValue(item, depth + 1))
      .filter((item) => item !== undefined)
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 5000)
        .map(([key, item]) => [readString(key, 120), sanitizeJsonValue(item, depth + 1)])
        .filter(([key, item]) => key && item !== undefined),
    )
  }

  return undefined
}

function readSongStudyIndex(value, songId) {
  if (!value || typeof value !== 'object' || Number(value.version) !== 1) {
    return undefined
  }

  const clean = sanitizeJsonValue(value)
  if (!clean || typeof clean !== 'object' || Array.isArray(clean)) {
    return undefined
  }

  return {
    ...clean,
    version: 1,
    songId,
    lyricVersion: readString(clean.lyricVersion, 120),
    status: readStudyIndexStatus(clean.status),
    quality: readStudyIndexQuality(clean.quality),
    generatedAt: readString(clean.generatedAt, 40, new Date().toISOString()),
    lines: Array.isArray(clean.lines) ? clean.lines : [],
    occurrences: Array.isArray(clean.occurrences) ? clean.occurrences : [],
    knowledge: clean.knowledge && typeof clean.knowledge === 'object' && !Array.isArray(clean.knowledge)
      ? clean.knowledge
      : {},
    stagePlans: clean.stagePlans && typeof clean.stagePlans === 'object' && !Array.isArray(clean.stagePlans)
      ? clean.stagePlans
      : {
          beginner: { focusOccurrenceIds: [] },
          intermediate: { focusOccurrenceIds: [] },
          advanced: { focusOccurrenceIds: [] },
        },
    summary: clean.summary && typeof clean.summary === 'object' && !Array.isArray(clean.summary)
      ? clean.summary
      : {
          lineCount: 0,
          wordCount: 0,
          grammarCount: 0,
          beginnerCount: 0,
          intermediateCount: 0,
          advancedCount: 0,
        },
  }
}

function readStorageProvider(value, fallback) {
  const provider = readString(value, 40, fallback)
  return ['tos', 'vercel-blob'].includes(provider) ? provider : fallback
}

function readRemoteUrl(value) {
  const url = readString(value, 2000)
  if (!url) {
    return undefined
  }

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') {
      throw new Error('Remote song asset URLs must use https.')
    }
  } catch {
    throw new Error('Invalid remote song asset URL.')
  }

  return url
}

function getRequestOrigin(req) {
  const protocol = readString(req.headers?.['x-forwarded-proto'], 20, 'https') || 'https'
  const host = readString(req.headers?.['x-forwarded-host'] || req.headers?.host, 240)
  return host ? `${protocol}://${host}` : ''
}

function createSongStreamUrl(origin, profileId, song) {
  const params = new URLSearchParams({
    profileId,
    objectKey: song.audioObjectKey,
    contentType: song.audioFileType,
  })
  const pathname = `/api/song-stream?${params.toString()}`
  return origin ? `${origin}${pathname}` : pathname
}

function normalizeSongRecord(profileId, input) {
  const id = sanitizeSongId(input?.id)
  if (!id) {
    throw new Error('Missing song id.')
  }

  const audioUrl = readRemoteUrl(input.audioUrl)
  const lyricUrl = readRemoteUrl(input.lyricUrl)
  const audioObjectKey = input.audioObjectKey
    ? assertSongObjectKeyForProfile(profileId, input.audioObjectKey)
    : undefined
  const lyricObjectKey = input.lyricObjectKey
    ? assertSongObjectKeyForProfile(profileId, input.lyricObjectKey)
    : undefined
  if (!audioObjectKey && !audioUrl) {
    throw new Error('Missing song audio asset.')
  }

  const now = new Date().toISOString()
  const lyricLines = readLyricLines(input.lyricLines)
  const storageProvider = readStorageProvider(input.storageProvider, audioUrl ? 'vercel-blob' : 'tos')
  const audioFileName = readString(input.audioFileName, 240, 'audio')
  const fileTitle = audioFileName.replace(/\.[^.]+$/, '').trim()

  return {
    id,
    title: readString(input.title, 120, fileTitle || '未命名歌曲') || fileTitle || '未命名歌曲',
    artist: readString(input.artist, 120, '本地音频') || '本地音频',
    cover: readString(input.cover, 180_000),
    durationMs: Math.max(0, Math.round(Number(input.durationMs ?? 0))),
    storageProvider,
    audioObjectKey,
    audioUrl,
    audioFileName,
    audioFileType: readString(input.audioFileType, 120, 'audio/mpeg') || 'audio/mpeg',
    audioSize: Math.max(0, Math.round(Number(input.audioSize ?? 0))),
    lyricObjectKey,
    lyricUrl,
    lyricFileName: input.lyricFileName ? readString(input.lyricFileName, 240) : undefined,
    lyricFileType: input.lyricFileType ? readString(input.lyricFileType, 120) : undefined,
    lyricSize: input.lyricSize ? Math.max(0, Math.round(Number(input.lyricSize))) : undefined,
    lyricLines,
    lyricProvider: readLyricProvider(input.lyricProvider),
    lyricQuality: readLyricQuality(input.lyricQuality),
    studyIndex: readSongStudyIndex(input.studyIndex, id),
    importedAt: readString(input.importedAt, 40, now) || now,
    updatedAt: readString(input.updatedAt, 40, now) || now,
  }
}

async function attachPlaybackUrl(profileId, origin, song) {
  if (song.audioUrl) {
    return {
      ...song,
      sourceUrl: song.audioUrl,
    }
  }

  return {
    ...song,
    sourceUrl: createSongStreamUrl(origin, profileId, song),
  }
}

async function listSongs(profileId, req, res) {
  const index = await readSongIndex(profileId)
  const origin = getRequestOrigin(req)
  const songs = await Promise.all(
    index.songs
      .slice()
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .map((song) => attachPlaybackUrl(profileId, origin, song)),
  )

  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    profileId,
    songs,
    updatedAt: index.updatedAt,
  })
}

async function upsertSong(profileId, req, res) {
  const body = readBody(req)
  let song = normalizeSongRecord(profileId, body.song)
  const origin = getRequestOrigin(req)
  const index = await readSongIndex(profileId)
  const existingIndex = index.songs.findIndex((item) => item.id === song.id)
  const existingSong = existingIndex >= 0 ? index.songs[existingIndex] : undefined
  const nextSongs = index.songs.slice()

  if (!song.studyIndex && isSongStudyIndexFresh(existingSong?.studyIndex, song.id, song.lyricLines)) {
    song = { ...song, studyIndex: existingSong.studyIndex }
  }

  const needsAnalysis = song.lyricLines.length > 0 && !isSongStudyIndexFresh(
    song.studyIndex,
    song.id,
    song.lyricLines,
  )
  const analysisInput = needsAnalysis
    ? normalizeSongAnalysisInput({
        profileId,
        songId: song.id,
        title: song.title,
        artist: song.artist,
        lyricLines: song.lyricLines,
      })
    : null
  const analysisJobId = analysisInput ? createSongAnalysisJobId(analysisInput) : undefined
  if (analysisInput) {
    song = {
      ...song,
      analysis: {
        jobId: analysisJobId,
        lyricVersion: createSongLyricVersion(song.lyricLines),
        status: 'queued',
        updatedAt: new Date().toISOString(),
      },
    }
  } else if (song.studyIndex) {
    song = {
      ...song,
      analysis: {
        jobId: existingSong?.analysis?.jobId,
        lyricVersion: song.studyIndex.lyricVersion,
        status: 'ready',
        updatedAt: existingSong?.analysis?.updatedAt || song.studyIndex.generatedAt,
      },
    }
  }

  if (existingIndex >= 0) {
    nextSongs[existingIndex] = song
  } else {
    nextSongs.unshift(song)
  }

  await writeSongIndex(profileId, {
    ...index,
    songs: nextSongs,
  })

  if (analysisInput) {
    let queue
    try {
      queue = createSongAnalysisQueue()
      const { job } = await enqueueSongAnalysis(queue, analysisInput)
      if (await job.getState() === 'failed') await job.retry('failed')
    } catch (error) {
      console.error('[song-assets] failed to enqueue song analysis', error)
      song = {
        ...song,
        analysis: {
          ...song.analysis,
          status: 'failed',
          error: '歌曲分析任务创建失败，请重新保存歌词后重试',
          updatedAt: new Date().toISOString(),
        },
      }
      const latest = await readSongIndex(profileId)
      await writeSongIndex(profileId, {
        ...latest,
        songs: latest.songs.map((item) => (item.id === song.id ? song : item)),
      })
    } finally {
      await queue?.close().catch(() => undefined)
    }
  }

  res.status(200).json({
    song: await attachPlaybackUrl(profileId, origin, song),
  })
}

async function deleteSong(profileId, req, res) {
  const body = readBody(req)
  const songId = sanitizeSongId(body.songId || req.query?.songId)
  if (!songId) {
    res.status(400).json({ error: 'Missing songId.' })
    return
  }

  const index = await readSongIndex(profileId)
  const song = index.songs.find((item) => item.id === songId)
  if (!song) {
    res.status(404).json({ error: 'Song not found.' })
    return
  }

  const objectKeys = [
    song.audioObjectKey,
    song.lyricObjectKey,
    song.coverObjectKey,
  ].filter(Boolean)

  await deleteTosObjects(objectKeys)
  await writeSongIndex(profileId, {
    ...index,
    songs: index.songs.filter((item) => item.id !== songId),
  })

  res.status(200).json({
    deleted: songId,
    objectCount: objectKeys.length,
  })
}

export default async function handler(req, res) {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (!['GET', 'PUT', 'DELETE'].includes(req.method)) {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const profileId = readProfileId(req)
    if (!profileId) {
      res.status(400).json({ error: 'Missing profileId.' })
      return
    }

    if (req.method === 'GET') {
      await listSongs(profileId, req, res)
      return
    }

    if (req.method === 'PUT') {
      await upsertSong(profileId, req, res)
      return
    }

    await deleteSong(profileId, req, res)
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Song asset request failed',
    })
  }
}
