import { access, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { createRequire } from 'node:module'

import { parseSync, stringifySync } from 'subtitle'

const require = createRequire(import.meta.url)
const assParser = require('ass-parser')

const subtitleExtensions = ['.ass', '.srt', '.vtt']

function hasKana(input) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(input)
}

function hasCjk(input) {
  return /[\u3400-\u9fff]/u.test(input)
}

function stripAssTags(input) {
  return input.replace(/\{\\[^}]+\}/g, '').replace(/\\N/g, '\n').trim()
}

function parseAssTimestamp(input) {
  const [hours = '0', minutes = '0', seconds = '0'] = input.trim().split(':')
  return Math.round((Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000)
}

function splitBilingualText(input, language = 'auto') {
  const lines = input
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  const kanaLine = lines.find(hasKana)
  const cjkLines = lines.filter(hasCjk)
  const ja =
    language === 'ja'
      ? (kanaLine ?? lines[0])
      : language === 'zh'
        ? ''
        : (kanaLine ?? '')
  const zh =
    language === 'zh'
      ? (lines.find((line) => hasCjk(line) || !hasKana(line)) ?? lines[0])
      : (cjkLines.find((line) => line !== ja && !hasKana(line)) ?? '')

  return {
    jaText: ja,
    zhText: zh || undefined,
  }
}

function keepCue(cue, language) {
  if (language === 'zh') {
    return cue.endMs > cue.startMs && Boolean(cue.zhText)
  }
  if (language === 'ja') {
    return cue.endMs > cue.startMs && Boolean(cue.jaText)
  }
  return cue.endMs > cue.startMs && (Boolean(cue.jaText) || Boolean(cue.zhText))
}

function parseAss(raw, options = {}) {
  const language = options.language ?? 'auto'
  const sections = assParser(raw)
  const events = sections.find((section) => section.section === 'Events')
  if (!events) {
    return []
  }

  return events.body
    .filter((item) => item.key === 'Dialogue' && item.value)
    .map((item) => {
      const value = item.value
      const text = stripAssTags(value.Text ?? '')
      const split = splitBilingualText(text, language)
      return {
        startMs: parseAssTimestamp(value.Start ?? '0:00:00.00'),
        endMs: parseAssTimestamp(value.End ?? '0:00:00.00'),
        ...split,
      }
    })
    .filter((cue) => keepCue(cue, language))
}

function parseSrtOrVtt(raw, options = {}) {
  const language = options.language ?? 'auto'
  return parseSync(raw)
    .filter((node) => node.type === 'cue')
    .map((node) => {
      const split = splitBilingualText(node.data.text, language)
      return {
        startMs: node.data.start,
        endMs: node.data.end,
        ...split,
      }
    })
    .filter((cue) => keepCue(cue, language))
}

export async function findSidecarSubtitle(inputPath) {
  const stem = inputPath.replace(/\.[^.]+$/, '')
  for (const extension of subtitleExtensions) {
    const candidate = `${stem}${extension}`
    try {
      await access(candidate)
      return candidate
    } catch {
      // try next extension
    }
  }

  return null
}

export async function readSubtitleCues(subtitlePath, options = {}) {
  const raw = await readFile(subtitlePath, 'utf8')
  return extname(subtitlePath).toLowerCase() === '.ass' ? parseAss(raw, options) : parseSrtOrVtt(raw, options)
}

export function cuesToVtt(cues) {
  return stringifySync(
    cues.map((cue) => ({
      type: 'cue',
      data: {
        start: Math.max(0, cue.startMs),
        end: Math.max(1, cue.endMs),
        text: cue.zhText ? `${cue.jaText}\n${cue.zhText}` : cue.jaText,
      },
    })),
    { format: 'WebVTT' },
  )
}

export async function writeClipSubtitle(outputPath, cues, offsetMs) {
  await writeFile(
    outputPath,
    cuesToVtt(
      cues.map((cue) => ({
        ...cue,
        startMs: Math.max(0, cue.startMs - offsetMs),
        endMs: Math.max(0, cue.endMs - offsetMs),
      })),
    ),
  )
}

export function resolveSubtitlePath(inputPath, candidate) {
  return candidate ? resolve(candidate) : resolve(dirname(inputPath), `${inputPath}.vtt`)
}
