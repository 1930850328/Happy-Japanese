export const CLOUD_PROFILE_STORAGE_KEY = 'yuru-nihongo-cloud-profile-id'
export const DEFAULT_CLOUD_PROFILE_ID = 'f8a180c6-9f54-461d-9647-f072183d3814'

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

  const next = sanitizeCloudProfileId(DEFAULT_CLOUD_PROFILE_ID)
  window.localStorage.setItem(CLOUD_PROFILE_STORAGE_KEY, next)
  return next
}
