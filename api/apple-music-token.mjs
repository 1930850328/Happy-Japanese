import crypto from 'node:crypto'

const ONE_HOUR_SECONDS = 60 * 60

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function normalizePrivateKey(value) {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value
}

function derToJoseSignature(signature) {
  let offset = 0
  if (signature[offset++] !== 0x30) {
    throw new Error('Invalid ECDSA signature')
  }

  const sequenceLength = signature[offset++]
  if (sequenceLength + offset !== signature.length) {
    throw new Error('Invalid ECDSA signature length')
  }

  if (signature[offset++] !== 0x02) {
    throw new Error('Invalid ECDSA signature R marker')
  }
  const rLength = signature[offset++]
  const r = signature.subarray(offset, offset + rLength)
  offset += rLength

  if (signature[offset++] !== 0x02) {
    throw new Error('Invalid ECDSA signature S marker')
  }
  const sLength = signature[offset++]
  const s = signature.subarray(offset, offset + sLength)

  const normalize = (part) => {
    const trimmed = part[0] === 0 ? part.subarray(1) : part
    if (trimmed.length > 32) {
      return trimmed.subarray(trimmed.length - 32)
    }
    if (trimmed.length === 32) {
      return trimmed
    }

    return Buffer.concat([Buffer.alloc(32 - trimmed.length), trimmed])
  }

  return Buffer.concat([normalize(r), normalize(s)])
}

function createDeveloperToken() {
  const teamId = process.env.APPLE_MUSIC_TEAM_ID
  const keyId = process.env.APPLE_MUSIC_KEY_ID
  const privateKey = process.env.APPLE_MUSIC_PRIVATE_KEY
  const missing = [
    !teamId ? 'APPLE_MUSIC_TEAM_ID' : '',
    !keyId ? 'APPLE_MUSIC_KEY_ID' : '',
    !privateKey ? 'APPLE_MUSIC_PRIVATE_KEY' : '',
  ].filter(Boolean)

  if (missing.length > 0) {
    return { missing }
  }

  const now = Math.floor(Date.now() / 1000)
  const header = {
    alg: 'ES256',
    kid: keyId,
    typ: 'JWT',
  }
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + ONE_HOUR_SECONDS,
  }
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`
  const derSignature = crypto.sign('sha256', Buffer.from(signingInput), normalizePrivateKey(privateKey))
  const signature = base64Url(derToJoseSignature(derSignature))

  return {
    developerToken: `${signingInput}.${signature}`,
  }
}

export default function handler(req, res) {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const result = createDeveloperToken()
    if (result.missing) {
      res.status(503).json({
        error: 'Apple Music 整首播放需要先配置开发者密钥',
        missing: result.missing,
      })
      return
    }

    res.status(200).json(result)
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Apple Music token 生成失败',
    })
  }
}
