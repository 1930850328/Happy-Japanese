import {
  TOS_CHUNK_MANIFEST_CONTENT_TYPE,
  assertSongObjectKeyForProfile,
  createSongChunkObjectKey,
  putTosObject,
  sanitizeProfileId,
} from './_tos-storage.mjs'

const MAX_UPLOAD_SIZE = 500 * 1024 * 1024
const MAX_CHUNK_SIZE = 8 * 1024 * 1024
const MAX_CHUNK_COUNT = 512

export const config = {
  maxDuration: 60,
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'PUT,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function readHeader(req, name) {
  const value = req.headers?.[name.toLowerCase()] ?? req.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

function readBody(req) {
  if (typeof req.body === 'string' && req.body) {
    return JSON.parse(req.body)
  }

  return req.body ?? {}
}

async function readRequestBuffer(req, maxSize, missingMessage) {
  const chunks = []
  let size = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxSize) {
      throw new Error('Song upload is larger than the upload limit.')
    }
    chunks.push(buffer)
  }

  if (size === 0) {
    throw new Error(missingMessage)
  }

  return Buffer.concat(chunks, size)
}

function readContentType(value) {
  return String(value || 'application/octet-stream').trim() || 'application/octet-stream'
}

function readChunk(profileId, parentKey, chunk, index) {
  const objectKey = assertSongObjectKeyForProfile(profileId, chunk?.objectKey)
  if (!objectKey.startsWith(`${parentKey}.chunks/`)) {
    throw new Error('Upload chunk does not belong to this song asset.')
  }

  const size = Math.max(0, Math.round(Number(chunk?.size ?? 0)))
  if (size <= 0) {
    throw new Error('Upload chunk has an invalid size.')
  }

  return {
    index,
    objectKey,
    size,
  }
}

async function handleFullUpload(req, res) {
  const profileId = sanitizeProfileId(req.query?.profileId)
  const objectKey = String(req.query?.objectKey ?? '').trim()
  const contentType = String(req.query?.contentType || readHeader(req, 'content-type') || '').trim()

  if (!profileId) {
    res.status(400).json({ error: 'Missing profileId.' })
    return
  }

  if (!objectKey) {
    res.status(400).json({ error: 'Missing objectKey.' })
    return
  }

  const body = await readRequestBuffer(req, MAX_UPLOAD_SIZE, 'Missing upload body.')
  const key = await putTosObject({
    profileId,
    objectKey,
    contentType,
    body,
  })

  res.status(200).json({
    provider: 'tos',
    objectKey: key,
    size: body.length,
  })
}

async function handleChunkUpload(req, res) {
  const profileId = sanitizeProfileId(req.query?.profileId)
  const objectKey = String(req.query?.objectKey ?? '').trim()
  const chunkIndex = Number(req.query?.chunkIndex)

  if (!profileId) {
    res.status(400).json({ error: 'Missing profileId.' })
    return
  }

  if (!objectKey) {
    res.status(400).json({ error: 'Missing objectKey.' })
    return
  }

  const chunkObjectKey = createSongChunkObjectKey({
    profileId,
    objectKey,
    chunkIndex,
  })
  const body = await readRequestBuffer(req, MAX_CHUNK_SIZE, 'Missing upload chunk body.')
  const key = await putTosObject({
    profileId,
    objectKey: chunkObjectKey,
    contentType: 'application/octet-stream',
    body,
  })

  res.status(200).json({
    provider: 'tos',
    objectKey: key,
    index: chunkIndex,
    size: body.length,
  })
}

async function handleFinalizeUpload(req, res) {
  const body = readBody(req)
  const profileId = sanitizeProfileId(body.profileId)

  if (!profileId) {
    res.status(400).json({ error: 'Missing profileId.' })
    return
  }

  const parentKey = assertSongObjectKeyForProfile(profileId, body.objectKey)
  const contentType = readContentType(body.contentType)
  const size = Math.max(0, Math.round(Number(body.size ?? 0)))
  const chunks = Array.isArray(body.chunks) ? body.chunks : []

  if (size <= 0 || size > MAX_UPLOAD_SIZE) {
    res.status(400).json({ error: 'Song upload is larger than the upload limit.' })
    return
  }

  if (chunks.length <= 0 || chunks.length > MAX_CHUNK_COUNT) {
    res.status(400).json({ error: 'Invalid song upload chunk count.' })
    return
  }

  const normalizedChunks = chunks.map((chunk, index) => readChunk(profileId, parentKey, chunk, index))
  const totalSize = normalizedChunks.reduce((total, chunk) => total + chunk.size, 0)
  if (totalSize !== size) {
    res.status(400).json({ error: 'Song upload chunk sizes do not match the file size.' })
    return
  }

  const manifest = {
    version: 1,
    type: 'chunked-audio',
    contentType,
    size,
    chunks: normalizedChunks,
    finalizedAt: new Date().toISOString(),
  }

  const key = await putTosObject({
    profileId,
    objectKey: parentKey,
    contentType: TOS_CHUNK_MANIFEST_CONTENT_TYPE,
    body: Buffer.from(JSON.stringify(manifest), 'utf8'),
  })

  res.status(200).json({
    provider: 'tos',
    objectKey: key,
    contentType,
    size,
    chunkCount: normalizedChunks.length,
  })
}

export default async function handler(req, res) {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  try {
    if (req.method === 'PUT' && req.query?.mode === 'chunk') {
      await handleChunkUpload(req, res)
      return
    }

    if (req.method === 'PUT') {
      await handleFullUpload(req, res)
      return
    }

    if (req.method === 'POST' && req.query?.mode === 'finalize') {
      await handleFinalizeUpload(req, res)
      return
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Song server upload failed',
    })
  }
}
