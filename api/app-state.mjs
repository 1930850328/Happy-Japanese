import { BlobNotFoundError, get, put } from '@vercel/blob'

const STATE_PREFIX = 'app-state'

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function sanitizeProfileId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 64)
}

function getStatePath(profileId) {
  return `${STATE_PREFIX}/${profileId}.json`
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
  return {
    profileId: sanitizeProfileId(body.profileId),
    state: body.state,
  }
}

async function readBlobJson(pathname) {
  const result = await get(pathname, {
    access: 'private',
  })

  if (!result || result.statusCode !== 200 || !result.stream) {
    return null
  }

  const text = await new Response(result.stream).text()
  return JSON.parse(text)
}

export default async function handler(req, res) {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  try {
    if (req.method === 'GET') {
      const profileId = readProfileId(req)
      if (!profileId) {
        res.status(400).json({ error: 'Missing profileId.' })
        return
      }

      const state = await readBlobJson(getStatePath(profileId))
      if (!state) {
        res.status(404).json({ error: 'State not found.' })
        return
      }

      res.status(200).json({ state })
      return
    }

    if (req.method === 'PUT') {
      const { profileId, state } = readProfileId(req)
      if (!profileId) {
        res.status(400).json({ error: 'Missing profileId.' })
        return
      }

      if (!state || typeof state !== 'object') {
        res.status(400).json({ error: 'Missing state payload.' })
        return
      }

      const payload = {
        ...state,
        version: 1,
        profileId,
        updatedAt: new Date().toISOString(),
      }

      await put(getStatePath(profileId), JSON.stringify(payload), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json; charset=utf-8',
        cacheControlMaxAge: 60,
      })

      res.status(200).json({ ok: true })
      return
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    if (error instanceof BlobNotFoundError) {
      res.status(404).json({ error: 'State not found.' })
      return
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : 'App state request failed',
    })
  }
}
