const CACHE_KEY = 'yuru-nihongo-translation-cache-v2'
const FALLBACK_API_ORIGIN = 'https://yuru-nihongo-study.vercel.app'

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

export async function translateJapaneseSentences(texts: string[]) {
  loadCacheFromStorage()

  const normalized = [...new Set(texts.map((item) => item.trim()).filter(Boolean))]
  const missing = normalized.filter((item) => !translationCache.has(item))

  if (missing.length > 0) {
    const response = await fetch(getEndpoint(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        texts: missing,
        from: 'ja',
        to: 'zh-CN',
      }),
    })

    if (!response.ok) {
      throw new Error('翻译服务暂时不可用')
    }

    const payload = (await response.json()) as { translations?: string[] }
    const translations = Array.isArray(payload.translations) ? payload.translations : []

    missing.forEach((item, index) => {
      const translated = translations[index]?.trim()
      if (translated) {
        translationCache.set(item, translated)
      }
    })

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
