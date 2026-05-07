import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { execa } from 'execa'
import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

const ffprobePath = ffprobeStatic.path ?? ffprobeStatic

function assertBinary(pathValue, name) {
  if (!pathValue) {
    throw new Error(`${name} binary was not resolved.`)
  }
  return pathValue
}

export async function probeVideo(inputPath) {
  const { stdout } = await execa(assertBinary(ffprobePath, 'ffprobe'), [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    inputPath,
  ])
  const data = JSON.parse(stdout)
  const durationSec = Number(data.format?.duration)

  return {
    durationMs: Number.isFinite(durationSec) ? Math.round(durationSec * 1000) : 0,
    streams: Array.isArray(data.streams) ? data.streams : [],
  }
}

export async function extractFirstSubtitle(inputPath, outputPath) {
  await mkdir(dirname(outputPath), { recursive: true })
  try {
    await execa(assertBinary(ffmpegPath, 'ffmpeg'), [
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:s:0',
      outputPath,
    ])
    return outputPath
  } catch {
    return null
  }
}

export async function detectSilences(inputPath) {
  try {
    const { stderr } = await execa(
      assertBinary(ffmpegPath, 'ffmpeg'),
      ['-hide_banner', '-i', inputPath, '-af', 'silencedetect=noise=-35dB:d=0.35', '-f', 'null', '-'],
      { reject: false },
    )
    const events = []
    const lines = stderr.split('\n')

    for (const line of lines) {
      const startMatch = line.match(/silence_start:\s*([0-9.]+)/)
      if (startMatch) {
        events.push({ kind: 'start', ms: Math.round(Number(startMatch[1]) * 1000) })
      }
      const endMatch = line.match(/silence_end:\s*([0-9.]+)/)
      if (endMatch) {
        events.push({ kind: 'end', ms: Math.round(Number(endMatch[1]) * 1000) })
      }
    }

    return events
  } catch {
    return []
  }
}

export async function extractAudioWav({ inputPath, outputPath, startMs = 0, durationMs }) {
  await mkdir(dirname(outputPath), { recursive: true })
  const args = [
    '-y',
    '-ss',
    String(Math.max(0, startMs / 1000)),
  ]

  if (durationMs) {
    args.push('-t', String(Math.max(0.1, durationMs / 1000)))
  }

  args.push(
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-f',
    'wav',
    outputPath,
  )

  await execa(assertBinary(ffmpegPath, 'ffmpeg'), args)
}

export async function cutClip({ inputPath, outputPath, startMs, durationMs }) {
  await mkdir(dirname(outputPath), { recursive: true })
  await execa(assertBinary(ffmpegPath, 'ffmpeg'), [
    '-y',
    '-ss',
    String(Math.max(0, startMs / 1000)),
    '-i',
    inputPath,
    '-t',
    String(Math.max(0.1, durationMs / 1000)),
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    '-avoid_negative_ts',
    'make_zero',
    outputPath,
  ])
}

export async function captureCover({ inputPath, outputPath, atMs }) {
  await mkdir(dirname(outputPath), { recursive: true })
  await execa(assertBinary(ffmpegPath, 'ffmpeg'), [
    '-y',
    '-ss',
    String(Math.max(0, atMs / 1000)),
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    outputPath,
  ])
}
