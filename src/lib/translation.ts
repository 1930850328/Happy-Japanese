const CACHE_KEY = 'yuru-nihongo-translation-cache-v4'
const FALLBACK_API_ORIGIN = 'https://yuru-nihongo-study.vercel.app'
const TRANSLATION_BATCH_SIZE = 24
const TRANSLATION_BATCH_TIMEOUT_MS = 15_000

const translationCache = new Map<string, string>()

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function loadCacheFromStorage() {
  if (!canUseStorage() || translationCache.size > 0) {
    return
  }

  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) {
      return
    }

    const parsed = JSON.parse(raw) as Record<string, string>
    for (const [key, value] of Object.entries(parsed)) {
      if (key.trim() && value.trim()) {
        translationCache.set(key, value)
      }
    }
  } catch {
    // Ignore malformed cache.
  }
}

function persistCache() {
  if (!canUseStorage()) {
    return
  }

  try {
    const payload = Object.fromEntries(translationCache.entries())
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore storage quota errors.
  }
}

function getEndpoint() {
  if (typeof window === 'undefined') {
    return '/api/translate'
  }

  const { origin, hostname } = window.location
  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    return `${FALLBACK_API_ORIGIN}/api/translate`
  }

  return `${origin}/api/translate`
}

async function fetchTranslationBatch(batch: string[]) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), TRANSLATION_BATCH_TIMEOUT_MS)

  try {
    const response = await fetch(getEndpoint(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        texts: batch,
        from: 'ja',
        to: 'zh-CN',
      }),
    })

    if (!response.ok) {
      throw new Error('翻译服务暂时不可用')
    }

    const payload = (await response.json()) as { translations?: string[] }
    return Array.isArray(payload.translations) ? payload.translations : []
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export async function translateJapaneseSentences(texts: string[]) {
  loadCacheFromStorage()

  const normalized = [...new Set(texts.map((item) => item.trim()).filter(Boolean))]
  const missing = normalized.filter((item) => !translationCache.has(item))

  for (let index = 0; index < missing.length; index += TRANSLATION_BATCH_SIZE) {
    const batch = missing.slice(index, index + TRANSLATION_BATCH_SIZE)
    let translations: string[] = []

    try {
      translations = await fetchTranslationBatch(batch)
    } catch {
      break
    }

    batch.forEach((item, batchIndex) => {
      const translated = translations[batchIndex]?.trim()
      if (translated) {
        translationCache.set(item, translated)
      }
    })
  }

  if (missing.length > 0) {
    persistCache()
  }

  return normalized.reduce<Record<string, string>>((acc, item) => {
    const value = translationCache.get(item)
    if (value) {
      acc[item] = value
    }
    return acc
  }, {})
}
