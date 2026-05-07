import { dirname, join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import { env, LogLevel, pipeline } from '@huggingface/transformers'

import { extractAudioWav } from './media.mjs'
import { cuesToVtt } from './subtitles.mjs'

const DEFAULT_ASR_MODEL = 'onnx-community/whisper-base_timestamped'
const FALLBACK_ASR_MODEL = 'onnx-community/whisper-tiny_timestamped'

function cleanTranscriptText(text) {
  return text.replace(/\s+/g, ' ').replace(/<\|[^>]+?\|>/g, '').trim()
}

function normalizeChunks(chunks, durationMs) {
  const safeDurationSec = Math.max(1, Math.round(durationMs / 1000))
  const cues = []

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const text = cleanTranscriptText(chunk.text ?? '')
    if (!text) {
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
  const output = await transcriber(audioPath, {
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
