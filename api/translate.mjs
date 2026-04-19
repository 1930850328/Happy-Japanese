import translate from 'google-translate-api-x'

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function normalizeTranslationArray(values, expectedLength) {
  return Array.from({ length: expectedLength }, (_, index) => {
    const value = values[index]
    return typeof value === 'string' ? value.trim() : ''
  })
}

async function translateWithGoogle(texts, from, to) {
  const results = await Promise.all(
    texts.map(async (text) => {
      const response = await translate(text, {
        from,
        to,
        client: 'gtx',
        forceBatch: false,
        fallbackBatch: true,
      })

      return response?.text?.trim?.() || ''
    }),
  )

  return normalizeTranslationArray(results, texts.length)
}

async function translateWithOpenAI(texts, from, to) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return null
  }

  const model = process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4.1-mini'
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a subtitle translator. Translate each Japanese subtitle line into natural Simplified Chinese for language learners. Preserve names, tone, and omitted subjects when they are obvious from the line. Return strict JSON: {"translations":["..."]}.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            from,
            to,
            texts,
          }),
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI translation failed: ${response.status}`)
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OpenAI translation returned empty content')
  }

  const parsed = JSON.parse(content)
  if (!Array.isArray(parsed?.translations)) {
    throw new Error('OpenAI translation returned invalid JSON')
  }

  return normalizeTranslationArray(parsed.translations, texts.length)
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
    const body =
      typeof req.body === 'string' && req.body
        ? JSON.parse(req.body)
        : req.body ?? {}

    const texts = Array.isArray(body.texts)
      ? body.texts.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 24)
      : []

    if (texts.length === 0) {
      res.status(400).json({ error: 'Missing texts' })
      return
    }

    const from = typeof body.from === 'string' ? body.from : 'ja'
    const to = typeof body.to === 'string' ? body.to : 'zh-CN'
    let translations = null

    try {
      translations = await translateWithOpenAI(texts, from, to)
    } catch (error) {
      console.error('OpenAI subtitle translation fallback triggered:', error)
    }

    if (!translations) {
      translations = await translateWithGoogle(texts, from, to)
    }

    res.status(200).json({ translations })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Translation failed',
    })
  }
}
