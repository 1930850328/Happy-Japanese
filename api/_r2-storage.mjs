import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export const R2_SITE_VIDEO_PREFIX = 'site-videos/'

const MAX_LIST_PAGES = 20
const LIST_PAGE_SIZE = 1000
const UPLOAD_URL_EXPIRES_SECONDS = 15 * 60

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

function stripTrailingSlash(value) {
  return value.replace(/\/+$/g, '')
}

function getR2Config() {
  const accountId = firstEnv(['R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID'])
  const endpoint =
    firstEnv(['R2_ENDPOINT', 'CLOUDFLARE_R2_ENDPOINT']) ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '')
  const accessKeyId = firstEnv(['R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID'])
  const secretAccessKey = firstEnv(['R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY'])
  const bucket = firstEnv(['R2_BUCKET', 'R2_BUCKET_NAME', 'CLOUDFLARE_R2_BUCKET'])
  const publicBaseUrl = stripTrailingSlash(
    firstEnv(['R2_PUBLIC_BASE_URL', 'R2_PUBLIC_URL', 'CLOUDFLARE_R2_PUBLIC_URL']),
  )

  const missing = []
  if (!endpoint) {
    missing.push('R2_ACCOUNT_ID or R2_ENDPOINT')
  }
  if (!accessKeyId) {
    missing.push('R2_ACCESS_KEY_ID')
  }
  if (!secretAccessKey) {
    missing.push('R2_SECRET_ACCESS_KEY')
  }
  if (!bucket) {
    missing.push('R2_BUCKET')
  }
  if (!publicBaseUrl) {
    missing.push('R2_PUBLIC_BASE_URL')
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing Cloudflare R2 configuration: ${missing.join(
        ', ',
      )}. Configure these environment variables in Vercel and redeploy.`,
    )
  }

  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl,
  }
}

function getR2Client(config) {
  const clientKey = [config.endpoint, config.accessKeyId, config.secretAccessKey].join('|')
  if (cachedClient && cachedClientKey === clientKey) {
    return cachedClient
  }

  cachedClient = new S3Client({
    endpoint: config.endpoint,
    region: 'auto',
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
  cachedClientKey = clientKey
  return cachedClient
}

export function normalizeR2SiteVideoKey(value) {
  const key = String(value ?? '').trim().replace(/^\/+/g, '')

  if (!key.startsWith(R2_SITE_VIDEO_PREFIX)) {
    throw new Error('Invalid upload path.')
  }

  if (key.includes('..') || key.endsWith('/')) {
    throw new Error('Invalid upload path.')
  }

  return key
}

function normalizeVideoContentType(value) {
  const contentType = String(value ?? '').trim().toLowerCase()
  if (!contentType) {
    return 'video/mp4'
  }

  if (!contentType.startsWith('video/')) {
    throw new Error('Only video uploads are allowed.')
  }

  return contentType
}

export function buildR2PublicUrl(pathname) {
  const config = getR2Config()
  const key = normalizeR2SiteVideoKey(pathname)
  return `${config.publicBaseUrl}/${key}`
}

export async function createR2UploadTicket({ pathname, contentType }) {
  const config = getR2Config()
  const client = getR2Client(config)
  const key = normalizeR2SiteVideoKey(pathname)
  const normalizedContentType = normalizeVideoContentType(contentType)
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: normalizedContentType,
  })

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: UPLOAD_URL_EXPIRES_SECONDS,
  })

  return {
    provider: 'r2',
    uploadUrl,
    url: `${config.publicBaseUrl}/${key}`,
    pathname: key,
    contentType: normalizedContentType,
  }
}

export function extractR2SiteVideoKey(value) {
  const rawValue = String(value ?? '').trim()
  if (!rawValue) {
    return ''
  }

  if (rawValue.startsWith(R2_SITE_VIDEO_PREFIX)) {
    return normalizeR2SiteVideoKey(rawValue)
  }

  try {
    const config = getR2Config()
    const url = new URL(rawValue)
    const publicBaseUrl = new URL(config.publicBaseUrl)
    let pathname = decodeURIComponent(url.pathname).replace(/^\/+/g, '')
    const basePath = decodeURIComponent(publicBaseUrl.pathname).replace(/^\/+|\/+$/g, '')

    if (url.origin === publicBaseUrl.origin && basePath && pathname.startsWith(`${basePath}/`)) {
      pathname = pathname.slice(basePath.length + 1)
    }

    return normalizeR2SiteVideoKey(pathname)
  } catch {
    return ''
  }
}

function serializeR2Object(item) {
  const key = item.Key || ''
  return {
    url: buildR2PublicUrl(key),
    pathname: key,
    size: Number(item.Size ?? 0),
    uploadedAt: item.LastModified instanceof Date ? item.LastModified.toISOString() : '',
  }
}

export async function listR2SiteVideos() {
  const config = getR2Config()
  const client = getR2Client(config)
  const objects = []
  let continuationToken
  let pageCount = 0

  while (pageCount < MAX_LIST_PAGES) {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: R2_SITE_VIDEO_PREFIX,
        MaxKeys: LIST_PAGE_SIZE,
        ContinuationToken: continuationToken,
      }),
    )

    objects.push(
      ...(page.Contents || [])
        .filter((item) => item.Key && !item.Key.endsWith('/'))
        .map(serializeR2Object),
    )

    if (!page.IsTruncated || !page.NextContinuationToken) {
      break
    }

    continuationToken = page.NextContinuationToken
    pageCount += 1
  }

  return objects
}

export async function deleteR2SiteVideos(values) {
  const config = getR2Config()
  const client = getR2Client(config)
  const keys = [
    ...new Set(
      values
        .map((value) => extractR2SiteVideoKey(value))
        .filter((key) => key.startsWith(R2_SITE_VIDEO_PREFIX)),
    ),
  ]

  if (keys.length === 0) {
    throw new Error('Missing managed site video URLs.')
  }

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
