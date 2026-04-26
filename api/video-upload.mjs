import { handleUpload } from '@vercel/blob/client'

import { requireVideoBlobToken } from './_blob-token.mjs'

const SITE_VIDEO_PREFIX = 'site-videos/'
const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
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
    verifyUploadPassword(req)
    const token = requireVideoBlobToken()

    const json = await handleUpload({
      token,
      request: req,
      body: readBody(req),
      onBeforeGenerateToken: async (pathname) => {
        if (typeof pathname !== 'string' || !pathname.startsWith(SITE_VIDEO_PREFIX)) {
          throw new Error('Invalid upload path.')
        }

        return {
          allowedContentTypes: ['video/*'],
          addRandomSuffix: true,
          cacheControlMaxAge: 60 * 60 * 24 * 30,
          maximumSizeInBytes: MAX_VIDEO_SIZE,
        }
      },
      onUploadCompleted: async () => undefined,
    })

    res.status(200).json(json)
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Video upload failed',
    })
  }
}
