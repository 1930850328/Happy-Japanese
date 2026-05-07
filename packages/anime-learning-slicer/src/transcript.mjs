import { dirname, join } from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'

import { env, LogLevel, pipeline } from '@huggingface/transformers'

import { extractAudioWav } from './media.mjs'
import { cuesToVtt } from './subtitles.mjs'

const DEFAULT_ASR_MODEL = 'onnx-community/whisper-small_timestamped'
const FALLBACK_ASR_MODEL = 'onnx-community/whisper-base_timestamped'

function cleanTranscriptText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/<\|[^>]+?\|>/g, '')
    .replace(/【\s*音楽\s*】/g, '')
    .replace(/\[\s*音楽\s*\]/gi, '')
    .trim()
}

function normalizeKnownTerms(text) {
  return text
    .replace(/バング[・\s-]?ドリ(?:ーム)?|バンドリ(?:ー)?/g, 'BanG Dream!')
    .replace(/ア[ヴベ]ェ?ム[ジシ]カ/g, 'Ave Mujica')
    .replace(/プリ[ー-]?マ[・\s-]?ア[ウオ]ロ[ー-]?ラ[ー]?/g, 'prima aurora')
}

function hasLearningSignal(text) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\u3400-\u9fff]/u.test(text)
}

function normalizeChunks(chunks, durationMs) {
  const safeDurationSec = Math.max(1, Math.round(durationMs / 1000))
  const cues = []

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const text = normalizeKnownTerms(cleanTranscriptText(chunk.text ?? ''))
    if (!text || !hasLearningSignal(text)) {
      continue
    }

    const timestamp = chunk.timestamp
    const startSec =
      Array.isArray(timestamp) && Number.isFinite(timestamp[0]) ? timestamp[0] : index * 2
    const endSec =
      Array.isArray(timestamp) && Number.isFinite(timestamp[1])
        ? timestamp[1]
        : Math.min(safeDurationSec, startSec + 3)

    const startMs = Math.max(0, Math.round(startSec * 1000))
    const endMs = Math.max(startMs + 600, Math.round(endSec * 1000))
    cues.push({ startMs, endMs, jaText: text })
  }

  return cues
}

async function readMonoPcm16Wav(pathValue) {
  const buffer = await readFile(pathValue)
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Unsupported ASR audio container: ${pathValue}`)
  }

  let offset = 12
  let audioFormat = 0
  let channelCount = 0
  let bitsPerSample = 0
  let dataStart = 0
  let dataSize = 0

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8

    if (chunkId === 'fmt ') {
      audioFormat = buffer.readUInt16LE(chunkStart)
      channelCount = buffer.readUInt16LE(chunkStart + 2)
      bitsPerSample = buffer.readUInt16LE(chunkStart + 14)
    } else if (chunkId === 'data') {
      dataStart = chunkStart
      dataSize = chunkSize
      break
    }

    offset = chunkStart + chunkSize + (chunkSize % 2)
  }

  if (audioFormat !== 1 || channelCount !== 1 || bitsPerSample !== 16 || !dataStart || !dataSize) {
    throw new Error('ASR audio must be 16-bit mono PCM WAV.')
  }

  const sampleCount = Math.floor(dataSize / 2)
  const audio = new Float32Array(sampleCount)
  for (let index = 0; index < sampleCount; index += 1) {
    audio[index] = buffer.readInt16LE(dataStart + index * 2) / 32768
  }

  return audio
}

async function loadTranscriber(modelId) {
  env.allowLocalModels = true
  env.allowRemoteModels = true
  env.useBrowserCache = false
  env.logLevel = LogLevel.ERROR

  return pipeline('automatic-speech-recognition', modelId, {
    device: 'cpu',
    dtype: 'fp32',
  })
}

async function runAsr(audioPath, durationMs, modelId) {
  const transcriber = await loadTranscriber(modelId)
  const audio = await readMonoPcm16Wav(audioPath)
  const output = await transcriber(audio, {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
    force_full_sequences: false,
    language: 'japanese',
    task: 'transcribe',
  })

  const chunks =
    Array.isArray(output?.chunks) && output.chunks.length > 0
      ? output.chunks
      : output?.text
        ? [
            {
              text: output.text,
              timestamp: [0, Math.max(1, Math.round(durationMs / 1000))],
            },
          ]
        : []

  return normalizeChunks(chunks, durationMs)
}

export async function transcribeVideoToCues({
  inputPath,
  outputPath,
  durationMs,
  modelId = DEFAULT_ASR_MODEL,
}) {
  await mkdir(dirname(outputPath), { recursive: true })
  const audioPath = join(dirname(outputPath), 'source-audio.wav')
  await extractAudioWav({ inputPath, outputPath: audioPath, durationMs })

  let modelUsed = modelId
  let cues = []
  try {
    cues = await runAsr(audioPath, durationMs, modelId)
  } catch (error) {
    if (modelId === FALLBACK_ASR_MODEL) {
      throw error
    }
    modelUsed = FALLBACK_ASR_MODEL
    cues = await runAsr(audioPath, durationMs, FALLBACK_ASR_MODEL)
  } finally {
    await rm(audioPath, { force: true })
  }

  if (cues.length === 0) {
    throw new Error('ASR completed but produced no usable Japanese subtitle cues.')
  }

  await writeFile(outputPath, cuesToVtt(cues))

  return {
    cues,
    modelUsed,
    subtitlePath: outputPath,
  }
}
