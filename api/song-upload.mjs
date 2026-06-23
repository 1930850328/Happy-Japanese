import {
  createSongId,
  createTosUploadTicket,
  sanitizeProfileId,
  sanitizeSongId,
} from './_tos-storage.mjs'

const MAX_AUDIO_SIZE = 500 * 1024 * 1024
const MAX_LYRIC_SIZE = 2 * 1024 * 1024

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function readBody(req) {
  if (typeof req.body === 'string' && req.body) {
    return JSON.parse(req.body)
  }

  return req.body ?? {}
}

function readUploadInput(value, kind) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const fileName = String(value.fileName ?? '').trim()
  const contentType = String(value.contentType ?? '').trim()
  const size = Number(value.size ?? 0)
  const maxSize = kind === 'audio' ? MAX_AUDIO_SIZE : MAX_LYRIC_SIZE

  if (!fileName) {
    throw new Error(`${kind} fileName is required.`)
  }

  if (!Number.isFinite(size) || size <= 0 || size > maxSize) {
    throw new Error(`${kind} file is larger than the upload limit.`)
  }

  return {
    fileName,
    contentType: contentType || (kind === 'audio' ? 'audio/mpeg' : 'text/plain; charset=utf-8'),
    size,
  }
}

export default async function handler(req, res) {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const body = readBody(req)
    const profileId = sanitizeProfileId(body.profileId)
    if (!profileId) {
      res.status(400).json({ error: 'Missing profileId.' })
      return
    }

    const songId = sanitizeSongId(body.songId) || createSongId()
    const audio = readUploadInput(body.audio, 'audio')
    const lyrics = readUploadInput(body.lyrics, 'lyrics')
    if (!audio && !lyrics) {
      res.status(400).json({ error: 'Missing upload asset.' })
      return
    }

    const tickets = {}
    if (audio) {
      tickets.audio = await createTosUploadTicket({
        profileId,
        songId,
        kind: 'audio',
        fileName: audio.fileName,
        contentType: audio.contentType,
      })
    }
    if (lyrics) {
      tickets.lyrics = await createTosUploadTicket({
        profileId,
        songId,
        kind: 'lyrics',
        fileName: lyrics.fileName,
        contentType: lyrics.contentType,
      })
    }

    res.status(200).json({
      provider: 'tos',
      songId,
      tickets,
    })
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Song upload ticket creation failed',
    })
  }
}
