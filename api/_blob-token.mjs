const SHARED_BLOB_TOKEN_ENV_NAMES = [
  'BLOB_READ_WRITE_TOKEN',
  'VERCEL_BLOB_READ_WRITE_TOKEN',
  'BLOB_TOKEN',
]

const VIDEO_BLOB_TOKEN_ENV_NAMES = [
  'VIDEO_READ_WRITE_TOKEN',
  'VIDEO_BLOB_READ_WRITE_TOKEN',
  ...SHARED_BLOB_TOKEN_ENV_NAMES,
]

const APP_STATE_BLOB_TOKEN_ENV_NAMES = [
  'APP_STATE_READ_WRITE_TOKEN',
  'APP_STATE_BLOB_READ_WRITE_TOKEN',
  ...SHARED_BLOB_TOKEN_ENV_NAMES,
]

function readEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim()
}

function resolveFromNames(names) {
  for (const name of names) {
    const value = readEnv(name)
    if (value) {
      return value
    }
  }

  return ''
}

export function resolveVideoBlobToken() {
  return resolveFromNames(VIDEO_BLOB_TOKEN_ENV_NAMES)
}

export function resolveAppStateBlobToken() {
  return resolveFromNames(APP_STATE_BLOB_TOKEN_ENV_NAMES)
}

function requireToken(names, label) {
  const token = resolveFromNames(names)
  if (token) {
    return token
  }

  const expectedNames = names.slice(0, 2).map((name) => `\`${name}\``).join(' or ')

  throw new Error(
    [
      `Missing ${label} Vercel Blob token.`,
      `Configure ${expectedNames} in your Vercel project environment variables and redeploy.`,
      'If you are testing locally, run `vercel dev` after pulling env vars.',
    ].join(' '),
  )
}

export function requireVideoBlobToken() {
  return requireToken(VIDEO_BLOB_TOKEN_ENV_NAMES, 'video')
}

export function requireAppStateBlobToken() {
  return requireToken(APP_STATE_BLOB_TOKEN_ENV_NAMES, 'app state')
}
