import type { LyricWordTiming } from '../types'

export interface ParsedTtmlWordTimedLine {
  startMs: number
  endMs: number
  text: string
  wordTimings: LyricWordTiming[]
}

export function parseTtmlWordTimedLines(text: string): ParsedTtmlWordTimedLine[]
