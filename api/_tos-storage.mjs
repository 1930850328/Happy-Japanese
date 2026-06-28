import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import crypto from 'node:crypto'

export const TOS_SONG_PREFIX = 'song-assets/'
export const TOS_CHUNK_MANIFEST_CONTENT_TYPE = 'application/vnd.yuru-nihongo.chunked-audio+json'

const INDEX_FILE_NAME = 'index.json'
const UPLOAD_URL_EXPIRES_SECONDS = 15 * 60
const PLAYBACK_URL_EXPIRES_SECONDS = 60 * 60

let cachedClient
let cachedClientKey = ''

function readEnv(name) {
  const value = process.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

function firstEnv(names) {
  for (const name of names) {
    const value = readEnv(name)
    if (value) {
      return value
    }
  }

  return ''
}

function parseBooleanEnv(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

function sanitizeProfileId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 64)
}

function sanitizeSongId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 96)
}

function sanitizeFileName(value, fallback) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[/\\]/g, '-')
    .replace(/[^a-zA-Z0-9._\-\u3040-\u30ff\u3400-\u9fff]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)

  return normalized || fallback
}

function getTosConfig() {
  const endpoint = firstEnv(['TOS_S3_ENDPOINT', 'TOS_ENDPOINT', 'VOLCENGINE_TOS_ENDPOINT'])
  const region = firstEnv(['TOS_REGION', 'VOLCENGINE_TOS_REGION'])
  const accessKeyId = firstEnv(['TOS_ACCESS_KEY_ID', 'VOLCENGINE_TOS_ACCESS_KEY_ID'])
  const secretAccessKey = firstEnv(['TOS_SECRET_ACCESS_KEY', 'VOLCENGINE_TOS_SECRET_ACCESS_KEY'])
  const bucket = firstEnv(['TOS_BUCKET', 'TOS_BUCKET_NAME', 'VOLCENGINE_TOS_BUCKET'])
  const forcePathStyle = parseBooleanEnv(firstEnv(['TOS_FORCE_PATH_STYLE']), false)

  const missing = []
  if (!endpoint) missing.push('TOS_S3_ENDPOINT or TOS_ENDPOINT')
  if (!region) missing.push('TOS_REGION')
  if (!accessKeyId) missing.push('TOS_ACCESS_KEY_ID')
  if (!secretAccessKey) missing.push('TOS_SECRET_ACCESS_KEY')
  if (!bucket) missing.push('TOS_BUCKET')

  if (missing.length > 0) {
    throw new Error(
      `Missing TOS configuration: ${missing.join(
        ', ',
      )}. Configure these environment variables in Vercel and redeploy.`,
    )
  }

  return {
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    bucket,
    forcePathStyle,
  }
}

function getTosClient(config) {
  const clientKey = [
    config.endpoint,
    config.region,
    config.accessKeyId,
    config.secretAccessKey,
    config.forcePathStyle,
  ].join('|')

  if (cachedClient && cachedClientKey === clientKey) {
    return cachedClient
  }

  cachedClient = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
  cachedClientKey = clientKey
  return cachedClient
}

function getProfilePrefix(profileId) {
  const normalizedProfileId = sanitizeProfileId(profileId)
  if (!normalizedProfileId) {
    throw new Error('Missing profileId.')
  }

  return `${TOS_SONG_PREFIX}profiles/${normalizedProfileId}`
}

function getSongPrefix(profileId, songId) {
  const normalizedSongId = sanitizeSongId(songId)
  if (!normalizedSongId) {
    throw new Error('Missing songId.')
  }

  return `${getProfilePrefix(profileId)}/songs/${normalizedSongId}`
}

export function createSongId() {
  return `song-${crypto.randomUUID()}`
}

export function getSongIndexKey(profileId) {
  return `${getProfilePrefix(profileId)}/${INDEX_FILE_NAME}`
}

export function createSongObjectKey({ profileId, songId, kind, fileName }) {
  const safeKind = String(kind ?? '').trim().toLowerCase()
  if (!['audio', 'lyrics', 'cover'].includes(safeKind)) {
    throw new Error('Invalid song asset kind.')
  }

  const fallback = safeKind === 'audio' ? 'audio.bin' : safeKind === 'lyrics' ? 'lyrics.txt' : 'cover.bin'
  return `${getSongPrefix(profileId, songId)}/${safeKind}/${sanitizeFileName(fileName, fallback)}`
}

export function assertSongObjectKeyForProfile(profileId, key) {
  const normalizedKey = String(key ?? '').trim().replace(/^\/+/g, '')
  const profilePrefix = `${getProfilePrefix(profileId)}/songs/`
  if (!normalizedKey.startsWith(profilePrefix) || normalizedKey.includes('..') || normalizedKey.endsWith('/')) {
    throw new Error('Invalid song object key.')
  }

  return normalizedKey
}

export function createSongChunkObjectKey({ profileId, objectKey, chunkIndex }) {
  const parentKey = assertSongObjectKeyForProfile(profileId, objectKey)
  const index = Number(chunkIndex)
  if (!Number.isInteger(index) || index < 0 || index > 100_000) {
    throw new Error('Invalid upload chunk index.')
  }

  return `${parentKey}.chunks/${String(index).padStart(6, '0')}.part`
}

function isMissingObjectError(error) {
  return ['NoSuchKey', 'NotFound', 'NoSuchBucket'].includes(error?.name) || error?.$metadata?.httpStatusCode === 404
}

async function bodyToText(body) {
  if (!body) return ''
  if (typeof body.transformToString === 'function') {
    return body.transformToString()
  }

  const chunks = []
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function readSongIndex(profileId) {
  const config = getTosConfig()
  const client = getTosClient(config)

  try {
    const result = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: getSongIndexKey(profileId),
      }),
    )
    const raw = await bodyToText(result.Body)
    const parsed = JSON.parse(raw)
    return {
      version: 1,
      profileId: sanitizeProfileId(profileId),
      updatedAt: '',
      songs: [],
      ...parsed,
      songs: Array.isArray(parsed?.songs) ? parsed.songs : [],
    }
  } catch (error) {
    if (isMissingObjectError(error)) {
      return {
        version: 1,
        profileId: sanitizeProfileId(profileId),
        updatedAt: new Date().toISOString(),
        songs: [],
      }
    }

    throw error
  }
}

export async function writeSongIndex(profileId, index) {
  const config = getTosConfig()
  const client = getTosClient(config)
  const payload = {
    version: 1,
    profileId: sanitizeProfileId(profileId),
    updatedAt: new Date().toISOString(),
    songs: Array.isArray(index?.songs) ? index.songs : [],
  }

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: getSongIndexKey(profileId),
      Body: JSON.stringify(payload),
      ContentType: 'application/json; charset=utf-8',
    }),
  )

  return payload
}

export async function createTosUploadTicket({ profileId, songId, kind, fileName, contentType }) {
  const config = getTosConfig()
  const client = getTosClient(config)
  const key = createSongObjectKey({ profileId, songId, kind, fileName })
  const normalizedContentType = String(contentType || 'application/octet-stream').trim() || 'application/octet-stream'

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: normalizedContentType,
  })

  return {
    provider: 'tos',
    kind,
    objectKey: key,
    contentType: normalizedContentType,
    uploadUrl: await getSignedUrl(client, command, {
      expiresIn: UPLOAD_URL_EXPIRES_SECONDS,
    }),
  }
}

export async function createTosDownloadUrl({ objectKey, contentType }) {
  const config = getTosConfig()
  const client = getTosClient(config)
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: objectKey,
    ResponseContentType: contentType || undefined,
  })

  return getSignedUrl(client, command, {
    expiresIn: PLAYBACK_URL_EXPIRES_SECONDS,
  })
}

export async function getTosObject({ profileId, objectKey, contentType, range }) {
  const config = getTosConfig()
  const client = getTosClient(config)
  const key = assertSongObjectKeyForProfile(profileId, objectKey)

  return await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Range: range || undefined,
      ResponseContentType: contentType || undefined,
    }),
  )
}

export async function headTosObject({ profileId, objectKey }) {
  const config = getTosConfig()
  const client = getTosClient(config)
  const key = assertSongObjectKeyForProfile(profileId, objectKey)

  return await client.send(
    new HeadObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  )
}

export async function putTosObject({ profileId, objectKey, contentType, body }) {
  const config = getTosConfig()
  const client = getTosClient(config)
  const key = assertSongObjectKeyForProfile(profileId, objectKey)

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    }),
  )

  return key
}

export async function deleteTosObjects(objectKeys) {
  const config = getTosConfig()
  const client = getTosClient(config)
  const keys = [...new Set(objectKeys.map((key) => String(key ?? '').trim()).filter(Boolean))]

  await Promise.all(
    keys.map((key) =>
      client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
      ),
    ),
  )

  return keys.length
}

export { sanitizeProfileId, sanitizeSongId }
