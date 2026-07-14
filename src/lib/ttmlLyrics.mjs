const XML_ENTITY_MAP = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
}

function decodeXmlText(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/giu, (entity, code) => {
    if (code.startsWith('#x')) return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
    if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10))
    return XML_ENTITY_MAP[code.toLowerCase()] ?? entity
  })
}

function parseAttributes(tag) {
  const attributes = {}
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu
  for (const match of tag.matchAll(pattern)) {
    attributes[match[1]] = decodeXmlText(match[2] ?? match[3] ?? '')
  }
  return attributes
}

function parseTtmlTime(value) {
  if (!value) return undefined
  const normalized = value.trim()
  if (/^\d+(?:\.\d+)?s$/u.test(normalized)) {
    return Math.round(Number(normalized.slice(0, -1)) * 1000)
  }

  const parts = normalized.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return undefined
  if (parts.length === 2) return Math.round((parts[0] * 60 + parts[1]) * 1000)
  if (parts.length === 3) return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000)
  return undefined
}

function isExcludedRole(role) {
  return role === 'x-bg' || role === 'x-translation' || role === 'x-roman'
}

export function parseTtmlWordTimedLines(text) {
  if (!text.includes('<tt') || !text.includes('<p')) return []

  const lines = []
  const spanStack = []
  let currentLine
  let lineIndex = 0
  const tokenPattern = /<[^>]+>|[^<]+/gu

  for (const tokenMatch of text.matchAll(tokenPattern)) {
    const token = tokenMatch[0]
    if (!token.startsWith('<')) {
      if (spanStack.length > 0) spanStack.at(-1).text += decodeXmlText(token)
      continue
    }
    if (/^<\?|^<!/u.test(token)) continue

    const closingMatch = token.match(/^<\/([:\w-]+)\s*>$/u)
    if (closingMatch) {
      const name = closingMatch[1].split(':').at(-1)
      if (name === 'span') {
        const span = spanStack.pop()
        if (!span || !currentLine) continue
        const parent = spanStack.at(-1)
        if (parent) parent.timedDescendants += span.timedDescendants

        const startMs = parseTtmlTime(span.attributes.begin)
        const endMs = parseTtmlTime(span.attributes.end)
        if (
          !span.excluded &&
          span.timedDescendants === 0 &&
          startMs !== undefined &&
          endMs !== undefined &&
          endMs > startMs &&
          span.text.trim()
        ) {
          currentLine.wordTimings.push({
            id: `ttml-${lineIndex + 1}-${currentLine.wordTimings.length + 1}`,
            text: span.text,
            startMs,
            endMs,
          })
          if (parent) parent.timedDescendants += 1
        }
        continue
      }

      if (name === 'p' && currentLine) {
        const timings = currentLine.wordTimings.sort((left, right) => left.startMs - right.startMs)
        if (timings.length > 0) {
          const startMs = parseTtmlTime(currentLine.attributes.begin) ?? timings[0].startMs
          const endMs = parseTtmlTime(currentLine.attributes.end) ?? timings.at(-1).endMs
          const lineText = timings.map((timing) => timing.text).join('').trim()
          if (lineText && endMs > startMs) {
            lines.push({ startMs, endMs, text: lineText, wordTimings: timings })
            lineIndex += 1
          }
        }
        currentLine = undefined
        spanStack.length = 0
      }
      continue
    }

    const openingMatch = token.match(/^<([:\w-]+)/u)
    if (!openingMatch) continue
    const name = openingMatch[1].split(':').at(-1)
    const attributes = parseAttributes(token)
    if (name === 'p') {
      currentLine = { attributes, wordTimings: [] }
      spanStack.length = 0
      continue
    }
    if (name === 'span' && currentLine) {
      const parent = spanStack.at(-1)
      spanStack.push({
        attributes,
        excluded: Boolean(parent?.excluded) || isExcludedRole(attributes['ttm:role']),
        text: '',
        timedDescendants: 0,
      })
    }
  }

  return lines.sort((left, right) => left.startMs - right.startMs)
}
