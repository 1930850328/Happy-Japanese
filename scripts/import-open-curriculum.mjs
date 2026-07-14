import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const vocabRoot = process.argv[2]
const grammarRoot = process.argv[3]
const kanjiFile = process.argv[4]
const outputRoot = process.argv[5] ?? path.resolve('public/curriculum')

if (!vocabRoot || !grammarRoot || !kanjiFile) {
  throw new Error('Usage: node scripts/import-open-curriculum.mjs <vocab-src> <grammar-src> <kanji-json> [output-dir]')
}

const levels = ['N5', 'N4', 'N3', 'N2', 'N1']

function stableId(prefix, ...parts) {
  return `${prefix}-${createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 12)}`
}

function parseCsv(source) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
      continue
    }

    if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''))
      if (row.some(Boolean)) rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  if (field || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

async function buildVocabulary() {
  const entries = []
  const seen = new Set()
  for (const level of levels) {
    const csv = await readFile(path.join(vocabRoot, `${level.toLowerCase()}.csv`), 'utf8')
    const [, ...rows] = parseCsv(csv)
    for (const [expression = '', reading = '', meaningEn = ''] of rows) {
      const term = expression.trim()
      const kana = reading.trim()
      const meaning = meaningEn.replace(/\s+/g, ' ').trim()
      const key = `${term}\u0000${kana}`
      if (!term || !meaning || seen.has(key)) continue
      seen.add(key)
      entries.push({
        id: stableId('word', term, kana),
        level,
        term,
        reading: kana || term,
        meaningEn: meaning,
      })
    }
  }
  return entries
}

async function buildGrammar() {
  const entries = []
  for (const level of levels) {
    const source = await readFile(
      path.join(grammarRoot, `grammar_ja_${level}_full_alphabetical_0001.json`),
      'utf8',
    )
    const items = JSON.parse(source)
    for (const item of items) {
      const title = String(item.title ?? '').trim()
      if (!title) continue
      entries.push({
        id: stableId('grammar', level, title),
        level,
        title,
        formation: String(item.formation ?? '').trim(),
        shortExplanationEn: String(item.short_explanation ?? '').trim(),
        longExplanationEn: String(item.long_explanation ?? '').trim(),
        examples: Array.isArray(item.examples)
          ? item.examples.slice(0, 4).map((example) => ({
              ja: String(example.jp ?? '').trim(),
              romaji: String(example.romaji ?? '').trim(),
              meaningEn: String(example.en ?? '').trim(),
            })).filter((example) => example.ja)
          : [],
      })
    }
  }
  return entries
}

async function buildKanji() {
  const source = JSON.parse(await readFile(kanjiFile, 'utf8'))
  return Object.values(source)
    .filter((item) => Number.isInteger(item.jlpt) && item.jlpt >= 1 && item.jlpt <= 5)
    .map((item) => ({
      id: `kanji-${item.kanji}`,
      level: `N${item.jlpt}`,
      character: item.kanji,
      meaningsEn: Array.isArray(item.meanings) ? item.meanings.slice(0, 5) : [],
      onReadings: Array.isArray(item.on_readings) ? item.on_readings : [],
      kunReadings: Array.isArray(item.kun_readings) ? item.kun_readings : [],
      strokeCount: Number(item.stroke_count) || 0,
      frequency: Number(item.freq_mainichi_shinbun) || null,
      grade: Number(item.grade) || null,
    }))
    .sort((left, right) => {
      const levelDifference = Number(right.level.slice(1)) - Number(left.level.slice(1))
      if (levelDifference !== 0) return levelDifference
      return (left.frequency ?? Number.MAX_SAFE_INTEGER) - (right.frequency ?? Number.MAX_SAFE_INTEGER)
    })
}

await mkdir(outputRoot, { recursive: true })
const [vocabulary, grammar, kanji] = await Promise.all([
  buildVocabulary(),
  buildGrammar(),
  buildKanji(),
])

await Promise.all([
  writeFile(path.join(outputRoot, 'vocabulary.json'), JSON.stringify(vocabulary)),
  writeFile(path.join(outputRoot, 'grammar.json'), JSON.stringify(grammar)),
  writeFile(path.join(outputRoot, 'kanji.json'), JSON.stringify(kanji)),
])

process.stdout.write(`${JSON.stringify({ vocabulary: vocabulary.length, grammar: grammar.length, kanji: kanji.length }, null, 2)}\n`)
