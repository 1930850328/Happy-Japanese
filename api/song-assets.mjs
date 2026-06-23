import {
  assertSongObjectKeyForProfile,
  createTosDownloadUrl,
  deleteTosObjects,
  readSongIndex,
  sanitizeProfileId,
  sanitizeSongId,
  writeSongIndex,
} from './_tos-storage.mjs'

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
    }))
    .filter((line) => line.ja)
}

function normalizeSongRecord(profileId, input) {
  const id = sanitizeSongId(input?.id)
  if (!id) {
    throw new Error('Missing song id.')
  }

  const audioObjectKey = assertSongObjectKeyForProfile(profileId, input.audioObjectKey)
  const lyricObjectKey = input.lyricObjectKey
    ? assertSongObjectKeyForProfile(profileId, input.lyricObjectKey)
    : undefined
  const now = new Date().toISOString()
  const lyricLines = readLyricLines(input.lyricLines)

  return {
    id,
    title: readString(input.title, 120, '我的日语歌') || '我的日语歌',
    artist: readString(input.artist, 120, '本地音频') || '本地音频',
    cover: readString(input.cover, 180_000),
    durationMs: Math.max(0, Math.round(Number(input.durationMs ?? 0))),
    audioObjectKey,
    audioFileName: readString(input.audioFileName, 240, 'audio'),
    audioFileType: readString(input.audioFileType, 120, 'audio/mpeg') || 'audio/mpeg',
    audioSize: Math.max(0, Math.round(Number(input.audioSize ?? 0))),
    lyricObjectKey,
    lyricFileName: input.lyricFileName ? readString(input.lyricFileName, 240) : undefined,
    lyricFileType: input.lyricFileType ? readString(input.lyricFileType, 120) : undefined,
    lyricSize: input.lyricSize ? Math.max(0, Math.round(Number(input.lyricSize))) : undefined,
    lyricLines,
    importedAt: readString(input.importedAt, 40, now) || now,
    updatedAt: readString(input.updatedAt, 40, now) || now,
  }
}

async function attachPlaybackUrl(song) {
  return {
    ...song,
    sourceUrl: await createTosDownloadUrl({
      objectKey: song.audioObjectKey,
      contentType: song.audioFileType,
    }),
  }
}

async function listSongs(profileId, res) {
  const index = await readSongIndex(profileId)
  const songs = await Promise.all(
    index.songs
      .slice()
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .map(attachPlaybackUrl),
  )

  res.status(200).json({
    profileId,
    songs,
    updatedAt: index.updatedAt,
  })
}

async function upsertSong(profileId, req, res) {
  const body = readBody(req)
  const song = normalizeSongRecord(profileId, body.song)
  const index = await readSongIndex(profileId)
  const existingIndex = index.songs.findIndex((item) => item.id === song.id)
  const nextSongs = index.songs.slice()

  if (existingIndex >= 0) {
    nextSongs[existingIndex] = song
  } else {
    nextSongs.unshift(song)
  }

  await writeSongIndex(profileId, {
    ...index,
    songs: nextSongs,
  })

  res.status(200).json({
    song: await attachPlaybackUrl(song),
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
      await listSongs(profileId, res)
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
