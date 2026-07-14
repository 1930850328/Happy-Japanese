import assert from 'node:assert/strict'
import test from 'node:test'

import { selectCompatibleYrc } from '../../api/netease-song-match.mjs'
import { parseTtmlWordTimedLines } from '../../src/lib/ttmlLyrics.mjs'

test('uses compatible klyric data when the yrc field is empty', () => {
  const klyric = '[100,500](100,200,0)君(300,300,0)へ'
  assert.equal(selectCompatibleYrc({ yrc: '', klyric }), klyric)
})

test('does not let an incompatible klyric block later providers', () => {
  assert.equal(selectCompatibleYrc({ yrc: '', klyric: '[00:01.00]君へ' }), '')
})

test('parses AMLL TTML words and ignores translations and background vocals', () => {
  const ttml = `
    <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
      <body><div><p begin="00:01.000" end="00:02.000">
        <span begin="00:01.000" end="00:01.400">君</span>
        <span begin="00:01.400" end="00:02.000">へ</span>
        <span ttm:role="x-bg" begin="00:01.500" end="00:01.900"><span begin="00:01.500" end="00:01.900">愛</span></span>
        <span ttm:role="x-translation">致你</span>
      </p></div></body>
    </tt>
  `

  assert.deepEqual(parseTtmlWordTimedLines(ttml), [{
    startMs: 1000,
    endMs: 2000,
    text: '君へ',
    wordTimings: [
      { id: 'ttml-1-1', text: '君', startMs: 1000, endMs: 1400 },
      { id: 'ttml-1-2', text: 'へ', startMs: 1400, endMs: 2000 },
    ],
  }])
})
