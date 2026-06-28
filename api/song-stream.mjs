import {
  TOS_CHUNK_MANIFEST_CONTENT_TYPE,
  assertSongObjectKeyForProfile,
  getTosObject,
  headTosObject,
  sanitizeProfileId,
} from './_tos-storage.mjs'

export const config = {
  maxDuration: 60,
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Range,Content-Type')
  res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges,Content-Length,Content-Range,Content-Type')
}

function readHeader(req, name) {
  const value = req.headers?.[name.toLowerCase()] ?? req.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

function createHttpError(message, statusCode, totalSize) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.totalSize = totalSize
  return error
}

function isChunkManifestContentType(contentType) {
  return String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase() === TOS_CHUNK_MANIFEST_CONTENT_TYPE
}

async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0)
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray())
  }

  const chunks = []
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function writeBody(body, res) {
  if (!body) {
    return
  }

  for await (const chunk of body) {
    res.write(chunk)
  }
}

function parseRange(range, totalSize) {
  const normalizedRange = String(range || '').trim()
  if (!normalizedRange) {
    return {
      start: 0,
      end: totalSize - 1,
      partial: false,
      length: totalSize,
    }
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(normalizedRange)
  if (!match) {
    throw createHttpError('Invalid range header.', 416, totalSize)
  }

  let start
  let end
  if (match[1] === '') {
    const suffixLength = Number(match[2])
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      throw createHttpError('Invalid range header.', 416, totalSize)
    }
    start = Math.max(totalSize - suffixLength, 0)
    end = totalSize - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? totalSize - 1 : Number(match[2])
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= totalSize) {
    throw createHttpError('Requested range is not satisfiable.', 416, totalSize)
  }

  end = Math.min(end, totalSize - 1)
  return {
    start,
    end,
    partial: true,
    length: end - start + 1,
  }
}

function readChunkManifest(profileId, parentKey, value) {
  if (!value || value.type !== 'chunked-audio' || !Array.isArray(value.chunks)) {
    throw new Error('Invalid chunked song manifest.')
  }

  const size = Math.max(0, Math.round(Number(value.size ?? 0)))
  if (size <= 0) {
    throw new Error('Invalid chunked song size.')
  }

  const chunks = value.chunks.map((chunk, index) => {
    const objectKey = assertSongObjectKeyForProfile(profileId, chunk?.objectKey)
    if (!objectKey.startsWith(`${parentKey}.chunks/`)) {
      throw new Error('Chunked song manifest contains an invalid chunk key.')
    }

    const chunkSize = Math.max(0, Math.round(Number(chunk?.size ?? 0)))
    if (chunkSize <= 0) {
      throw new Error('Chunked song manifest contains an invalid chunk size.')
    }

    return {
      index,
      objectKey,
      size: chunkSize,
    }
  })

  const totalChunkSize = chunks.reduce((total, chunk) => total + chunk.size, 0)
  if (totalChunkSize !== size) {
    throw new Error('Chunked song manifest size does not match its chunks.')
  }

  return {
    contentType: String(value.contentType || 'audio/mpeg').trim() || 'audio/mpeg',
    size,
    chunks,
  }
}

async function loadChunkManifest(profileId, objectKey) {
  const parentKey = assertSongObjectKeyForProfile(profileId, objectKey)
  const result = await getTosObject({
    profileId,
    objectKey: parentKey,
    contentType: TOS_CHUNK_MANIFEST_CONTENT_TYPE,
  })
  const raw = (await bodyToBuffer(result.Body)).toString('utf8')
  return readChunkManifest(profileId, parentKey, JSON.parse(raw))
}

async function streamRegularObject({ profileId, objectKey, contentType, range, req, res }) {
  const result = await getTosObject({
    profileId,
    objectKey,
    contentType,
    range,
  })

  res.status(result.ContentRange ? 206 : 200)
  res.setHeader('Accept-Ranges', result.AcceptRanges || 'bytes')
  res.setHeader('Content-Type', result.ContentType || contentType)
  if (typeof result.ContentLength === 'number') {
    res.setHeader('Content-Length', String(result.ContentLength))
  }
  if (result.ContentRange) {
    res.setHeader('Content-Range', result.ContentRange)
  }
  res.setHeader('Cache-Control', 'private, max-age=300')

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  await writeBody(result.Body, res)
  res.end()
}

async function streamChunkedObject({ profileId, manifest, range, req, res }) {
  const selectedRange = parseRange(range, manifest.size)

  res.status(selectedRange.partial ? 206 : 200)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', manifest.contentType)
  res.setHeader('Content-Length', String(selectedRange.length))
  res.setHeader('Cache-Control', 'private, max-age=300')
  if (selectedRange.partial) {
    res.setHeader('Content-Range', `bytes ${selectedRange.start}-${selectedRange.end}/${manifest.size}`)
  }

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  let offset = 0
  for (const chunk of manifest.chunks) {
    const chunkStart = offset
    const chunkEnd = offset + chunk.size - 1
    offset += chunk.size

    if (chunkEnd < selectedRange.start || chunkStart > selectedRange.end) {
      continue
    }

    const localStart = Math.max(0, selectedRange.start - chunkStart)
    const localEnd = Math.min(chunk.size - 1, selectedRange.end - chunkStart)
    const result = await getTosObject({
      profileId,
      objectKey: chunk.objectKey,
      contentType: 'application/octet-stream',
      range: `bytes=${localStart}-${localEnd}`,
    })
    await writeBody(result.Body, res)
  }

  res.end()
}

export default async function handler(req, res) {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (!['GET', 'HEAD'].includes(req.method)) {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const profileId = sanitizeProfileId(req.query?.profileId)
    const objectKey = String(req.query?.objectKey ?? '').trim()
    const contentType = String(req.query?.contentType ?? '').trim() || 'audio/mpeg'
    const range = String(readHeader(req, 'range') ?? '').trim()

    if (!profileId) {
      res.status(400).json({ error: 'Missing profileId.' })
      return
    }

    if (!objectKey) {
      res.status(400).json({ error: 'Missing objectKey.' })
      return
    }

    const head = await headTosObject({
      profileId,
      objectKey,
    })

    if (isChunkManifestContentType(head.ContentType)) {
      const manifest = await loadChunkManifest(profileId, objectKey)
      await streamChunkedObject({
        profileId,
        manifest,
        range,
        req,
        res,
      })
      return
    }

    await streamRegularObject({
      profileId,
      objectKey,
      contentType,
      range,
      req,
      res,
    })
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 400
    if (statusCode === 416) {
      res.setHeader('Content-Range', `bytes */${Math.max(0, Math.round(Number(error?.totalSize ?? 0)))}`)
    }
    res.status(statusCode).json({
      error: error instanceof Error ? error.message : 'Song stream request failed',
    })
  }
}
