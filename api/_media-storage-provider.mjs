function readEnv(name) {
  const value = process.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

export function getMediaStorageProvider() {
  const rawProvider = (
    readEnv('MEDIA_STORAGE_PROVIDER') || readEnv('VIDEO_STORAGE_PROVIDER') || 'r2'
  ).toLowerCase()

  if (['r2', 'cloudflare', 'cloudflare-r2'].includes(rawProvider)) {
    return 'r2'
  }

  if (['vercel', 'vercel-blob', 'blob'].includes(rawProvider)) {
    return 'vercel'
  }

  throw new Error(
    'Invalid media storage provider. Use MEDIA_STORAGE_PROVIDER=r2 or MEDIA_STORAGE_PROVIDER=vercel.',
  )
}
