export const CLOUD_PROFILE_STORAGE_KEY = 'yuru-nihongo-cloud-profile-id'

export function sanitizeCloudProfileId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 64)
}

export function getCloudProfileId() {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return 'server'
  }

  const current = sanitizeCloudProfileId(window.localStorage.getItem(CLOUD_PROFILE_STORAGE_KEY) || '')
  if (current) {
    return current
  }

  const next = createCloudProfileId()
  window.localStorage.setItem(CLOUD_PROFILE_STORAGE_KEY, next)
  return next
}

function createCloudProfileId() {
  if (typeof crypto.randomUUID === 'function') {
    return sanitizeCloudProfileId(crypto.randomUUID())
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const randomPart = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
  return `profile-${randomPart}`
}
