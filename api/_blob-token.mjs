const BLOB_TOKEN_ENV_NAMES = [
  'BLOB_READ_WRITE_TOKEN',
  'VERCEL_BLOB_READ_WRITE_TOKEN',
  'BLOB_TOKEN',
]

function readEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim()
}

export function resolveBlobToken() {
  for (const name of BLOB_TOKEN_ENV_NAMES) {
    const value = readEnv(name)
    if (value) {
      return value
    }
  }

  return ''
}

export function requireBlobToken() {
  const token = resolveBlobToken()
  if (token) {
    return token
  }

  throw new Error(
    [
      'Missing Vercel Blob token.',
      'Configure `BLOB_READ_WRITE_TOKEN` in your Vercel project environment variables and redeploy.',
      'If you are testing locally, run `vercel dev` after pulling env vars.',
    ].join(' '),
  )
}
