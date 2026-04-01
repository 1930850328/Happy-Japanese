import translate from 'google-translate-api-x'

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
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

    const response = await translate(texts, {
      from,
      to,
      client: 'gtx',
      forceBatch: true,
      fallbackBatch: true,
    })

    const translations = Array.isArray(response)
      ? response.map((item) => item?.text?.trim?.() || '')
      : [response?.text?.trim?.() || '']

    res.status(200).json({ translations })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Translation failed',
    })
  }
}
