import { handleUpload } from '@vercel/blob/client'

import { requireSongBlobToken } from './_blob-token.mjs'

const SONG_BLOB_PREFIX = 'song-assets/profiles/'
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

function assertSongBlobPath(pathname) {
  const normalized = String(pathname ?? '').trim().replace(/^\/+/g, '')

  if (!normalized.startsWith(SONG_BLOB_PREFIX) || normalized.includes('..') || normalized.endsWith('/')) {
    throw new Error('Invalid song upload path.')
  }

  const isAudio = normalized.includes('/audio/')
  const isLyrics = normalized.includes('/lyrics/')
  if (!isAudio && !isLyrics) {
    throw new Error('Invalid song upload kind.')
  }

  return {
    pathname: normalized,
    kind: isLyrics ? 'lyrics' : 'audio',
  }
}

async function handleSongBlobUpload(req, res) {
  const token = requireSongBlobToken()
  const json = await handleUpload({
    token,
    request: req,
    body: readBody(req),
    onBeforeGenerateToken: async (pathname) => {
      const upload = assertSongBlobPath(pathname)

      return {
        allowedContentTypes:
          upload.kind === 'lyrics'
            ? ['text/*', 'application/octet-stream']
            : ['audio/*', 'video/*', 'application/octet-stream'],
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60 * 60 * 24 * 30,
        maximumSizeInBytes: upload.kind === 'lyrics' ? MAX_LYRIC_SIZE : MAX_AUDIO_SIZE,
      }
    },
    onUploadCompleted: async () => undefined,
  })

  res.status(200).json(json)
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
    await handleSongBlobUpload(req, res)
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Song Blob upload failed',
    })
  }
}
