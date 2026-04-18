import { del } from '@vercel/blob'

const SITE_VIDEO_PREFIX = '/site-videos/'

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

function isManagedSiteVideoUrl(value) {
  try {
    const url = new URL(String(value))
    return (
      url.hostname.endsWith('.blob.vercel-storage.com') &&
      url.pathname.startsWith(SITE_VIDEO_PREFIX)
    )
  } catch {
    return false
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
    const urls = Array.isArray(body.urls)
      ? body.urls.map((item) => String(item ?? '').trim()).filter(Boolean)
      : []
    const managedUrls = urls.filter(isManagedSiteVideoUrl)

    if (managedUrls.length === 0) {
      res.status(400).json({ error: 'Missing managed site video URLs.' })
      return
    }

    await del(managedUrls)
    res.status(200).json({ deleted: managedUrls.length })
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Video deletion failed',
    })
  }
}
