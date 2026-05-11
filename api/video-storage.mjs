import { del, list } from '@vercel/blob'

import { requireVideoBlobToken } from './_blob-token.mjs'
import { getMediaStorageProvider } from './_media-storage-provider.mjs'
import { deleteR2SiteVideos, listR2SiteVideos } from './_r2-storage.mjs'

const SITE_VIDEO_PREFIX = 'site-videos/'
const MAX_LIST_PAGES = 20
const LIST_PAGE_SIZE = 1000

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-upload-password')
}

function getHeader(req, name) {
  const value = req.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

function readBody(req) {
  if (typeof req.body === 'string' && req.body) {
    return JSON.parse(req.body)
  }

  return req.body ?? {}
}

function verifyUploadPassword(req) {
  const configuredPassword = process.env.VIDEO_UPLOAD_PASSWORD?.trim()
  if (!configuredPassword) {
    return
  }

  const providedPassword = String(getHeader(req, 'x-upload-password') ?? '').trim()
  if (!providedPassword || providedPassword !== configuredPassword) {
    throw new Error('Upload password is incorrect.')
  }
}

function isManagedSiteVideoUrl(value) {
  try {
    const url = new URL(String(value))
    return (
      url.hostname.endsWith('.blob.vercel-storage.com') &&
      url.pathname.startsWith(`/${SITE_VIDEO_PREFIX}`)
    )
  } catch {
    return false
  }
}

function serializeBlob(blob) {
  return {
    url: blob.url,
    pathname: blob.pathname,
    size: Number(blob.size ?? 0),
    uploadedAt:
      blob.uploadedAt instanceof Date
        ? blob.uploadedAt.toISOString()
        : String(blob.uploadedAt ?? ''),
  }
}

async function listManagedVideos(token) {
  const blobs = []
  let cursor
  let hasMore = true
  let pageCount = 0

  while (hasMore && pageCount < MAX_LIST_PAGES) {
    const page = await list({
      token,
      prefix: SITE_VIDEO_PREFIX,
      limit: LIST_PAGE_SIZE,
      cursor,
    })

    blobs.push(...page.blobs.map(serializeBlob))
    cursor = page.cursor
    hasMore = Boolean(page.hasMore && cursor)
    pageCount += 1
  }

  return blobs
}

function sendStorageSummary(res, blobs) {
  res.status(200).json({
    blobs,
    count: blobs.length,
    totalSize: blobs.reduce((sum, blob) => sum + blob.size, 0),
  })
}

export default async function handler(req, res) {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    verifyUploadPassword(req)
    const provider = getMediaStorageProvider()

    if (req.method === 'GET') {
      const blobs =
        provider === 'r2' ? await listR2SiteVideos() : await listManagedVideos(requireVideoBlobToken())
      sendStorageSummary(res, blobs)
      return
    }

    const body = readBody(req)
    const urls = Array.isArray(body.urls)
      ? body.urls.map((item) => String(item ?? '').trim()).filter(Boolean)
      : []

    if (provider === 'r2') {
      const deleted = await deleteR2SiteVideos(urls)
      res.status(200).json({ deleted })
      return
    }

    const token = requireVideoBlobToken()
    const managedUrls = urls.filter(isManagedSiteVideoUrl)

    if (managedUrls.length === 0) {
      res.status(400).json({ error: 'Missing managed site video URLs.' })
      return
    }

    await del(managedUrls, { token })
    res.status(200).json({ deleted: managedUrls.length })
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Video storage operation failed',
    })
  }
}
