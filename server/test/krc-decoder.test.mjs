import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import test from 'node:test'

import { decodeKrcContent } from '../../api/netease-song-match.mjs'

const KRC_XOR_KEY = Buffer.from([
  0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47,
  0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69,
])

function encodeKrc(value) {
  const payload = deflateSync(Buffer.from(value, 'utf8'))
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] ^= KRC_XOR_KEY[index % KRC_XOR_KEY.length]
  }
  return Buffer.concat([Buffer.from('krc1'), payload]).toString('base64')
}

test('decodes encrypted KRC word timings', () => {
  const lyrics = '[715,3568]<0,209,0>世<209,791,0>界<1000,536,0>で'
  assert.equal(decodeKrcContent(encodeKrc(lyrics)), lyrics)
})

test('rejects content without the KRC header', () => {
  assert.equal(decodeKrcContent(Buffer.from('plain text').toString('base64')), '')
})
