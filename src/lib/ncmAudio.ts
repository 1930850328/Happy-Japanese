import * as CryptoJS from 'crypto-js'

const MAGIC_HEADER = [67, 84, 69, 78, 70, 68, 65, 77]
const CORE_KEY = CryptoJS.enc.Hex.parse('687a4852416d736f356b496e62617857')
const META_KEY = CryptoJS.enc.Hex.parse('2331346C6A6B5F215C5D2630553C2728')

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  aac: 'audio/aac',
  dff: 'audio/x-dff',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  wma: 'audio/x-ms-wma',
}

const AUDIO_HEADERS: Array<{ ext: string; bytes: number[]; offset?: number }> = [
  { ext: 'mp3', bytes: [73, 68, 51] },
  { ext: 'flac', bytes: [102, 76, 97, 67] },
  { ext: 'ogg', bytes: [79, 103, 103, 83] },
  { ext: 'm4a', bytes: [102, 116, 121, 112], offset: 4 },
  { ext: 'wav', bytes: [82, 73, 70, 70] },
  { ext: 'wma', bytes: [48, 38, 178, 117, 142, 102, 207, 17, 166, 217, 0, 170, 0, 98, 206, 108] },
  { ext: 'aac', bytes: [255, 241] },
  { ext: 'dff', bytes: [70, 82, 77, 56] },
]

interface RawNcmMetadata {
  album?: string
  albumPic?: string
  artist?: unknown
  format?: string
  musicName?: string
}

export interface DecodedNcmAudio {
  file: File
  title?: string
  artist?: string
  album?: string
  cover?: string
  ext: string
  mime: string
}

function hasPrefix(bytes: Uint8Array, prefix: number[], offset = 0) {
  if (offset + prefix.length > bytes.length) {
    return false
  }

  return prefix.every((value, index) => bytes[offset + index] === value)
}

export function isNcmFile(file: File) {
  return file.name.toLowerCase().endsWith('.ncm')
}

function bytesToWordArray(bytes: Uint8Array) {
  const words: number[] = []

  for (let index = 0; index < bytes.length; index += 1) {
    words[index >>> 2] |= bytes[index] << (24 - (index % 4) * 8)
  }

  return CryptoJS.lib.WordArray.create(words, bytes.length)
}

function wordArrayToBytes(wordArray: CryptoJS.lib.WordArray) {
  const bytes = new Uint8Array(wordArray.sigBytes)

  for (let index = 0; index < wordArray.sigBytes; index += 1) {
    bytes[index] = (wordArray.words[index >>> 2] >>> (24 - (index % 4) * 8)) & 255
  }

  return bytes
}

function decryptAesEcb(cipherText: Uint8Array, key: CryptoJS.lib.WordArray) {
  const plainText = CryptoJS.AES.decrypt(
    { ciphertext: bytesToWordArray(cipherText) } as CryptoJS.lib.CipherParams,
    key,
    {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    },
  )

  return wordArrayToBytes(plainText)
}

function readKeyBox(raw: ArrayBuffer, view: DataView, offsetRef: { current: number }) {
  const keyLength = view.getUint32(offsetRef.current, true)
  offsetRef.current += 4

  const cipherText = new Uint8Array(raw, offsetRef.current, keyLength).map((value) => value ^ 100)
  offsetRef.current += keyLength

  const keyData = decryptAesEcb(cipherText, CORE_KEY).slice(17)
  const box = new Uint8Array(Array.from({ length: 256 }, (_, index) => index))
  let j = 0

  for (let index = 0; index < 256; index += 1) {
    j = (box[index] + j + keyData[index % keyData.length]) & 255
    const current = box[index]
    box[index] = box[j]
    box[j] = current
  }

  return box.map((_, index, arr) => {
    const nextIndex = (index + 1) & 255
    const si = arr[nextIndex]
    const sj = arr[(nextIndex + si) & 255]
    return arr[(si + sj) & 255]
  })
}

function normalizeCoverUrl(value: string | undefined) {
  if (!value) {
    return undefined
  }

  return `${value.replace(/^http:\/\//, 'https://')}?param=500y500`
}

function readMetadata(raw: ArrayBuffer, view: DataView, offsetRef: { current: number }) {
  const metaLength = view.getUint32(offsetRef.current, true)
  offsetRef.current += 4

  if (metaLength === 0) {
    return {} as RawNcmMetadata
  }

  const cipherText = new Uint8Array(raw, offsetRef.current, metaLength).map((value) => value ^ 99)
  offsetRef.current += metaLength

  const encodedPayload = CryptoJS.enc.Utf8.stringify(bytesToWordArray(cipherText.slice(22)))
  const plainText = CryptoJS.AES.decrypt(
    { ciphertext: CryptoJS.enc.Base64.parse(encodedPayload) } as CryptoJS.lib.CipherParams,
    META_KEY,
    {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    },
  ).toString(CryptoJS.enc.Utf8)
  const labelIndex = plainText.indexOf(':')
  const payload = labelIndex >= 0 ? plainText.slice(labelIndex + 1) : plainText
  const parsed = JSON.parse(payload) as RawNcmMetadata & { mainMusic?: RawNcmMetadata }
  const metadata = parsed.mainMusic ?? parsed

  return {
    ...metadata,
    albumPic: normalizeCoverUrl(metadata.albumPic),
  }
}

function readAudio(raw: ArrayBuffer, view: DataView, offsetRef: { current: number }, keyBox: Uint8Array) {
  const coverLength = view.getUint32(offsetRef.current + 5, true)
  offsetRef.current += coverLength + 13

  const audio = new Uint8Array(raw.slice(offsetRef.current))
  for (let index = 0; index < audio.length; index += 1) {
    audio[index] ^= keyBox[index & 255]
  }

  return audio
}

function sniffAudioExt(bytes: Uint8Array, fallback = 'mp3') {
  const match = AUDIO_HEADERS.find((header) => hasPrefix(bytes, header.bytes, header.offset ?? 0))
  return match?.ext ?? fallback
}

function getArtistName(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (!Array.isArray(value)) {
    return undefined
  }

  const names = value
    .map((item) => {
      if (typeof item === 'string') return item
      if (Array.isArray(item) && typeof item[0] === 'string') return item[0]
      return ''
    })
    .filter(Boolean)

  return names.length > 0 ? names.join('; ') : undefined
}

function sanitizeFilePart(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 96)
}

function buildOutputFileName(fileName: string, title: string | undefined, ext: string) {
  const baseName = title || fileName.replace(/\.[^.]+$/, '')
  const safeName = sanitizeFilePart(baseName) || 'song'
  return `${safeName}.${ext}`
}

export async function decodeNcmAudio(file: File): Promise<DecodedNcmAudio> {
  const raw = await file.arrayBuffer()
  const prefix = new Uint8Array(raw, 0, MAGIC_HEADER.length)

  if (!hasPrefix(prefix, MAGIC_HEADER)) {
    throw new Error('这个 .ncm 文件无法识别，可能已经损坏。')
  }

  const view = new DataView(raw)
  const offsetRef = { current: 10 }
  const keyBox = readKeyBox(raw, view, offsetRef)
  const metadata = readMetadata(raw, view, offsetRef)
  const audio = readAudio(raw, view, offsetRef, keyBox)
  const ext = (metadata.format || sniffAudioExt(audio)).toLowerCase()
  const mime = AUDIO_MIME_BY_EXT[ext] ?? 'audio/mpeg'
  const title = metadata.musicName?.trim() || undefined
  const artist = getArtistName(metadata.artist)
  const output = new File([audio], buildOutputFileName(file.name, title, ext), {
    lastModified: file.lastModified,
    type: mime,
  })

  return {
    file: output,
    title,
    artist,
    album: metadata.album,
    cover: metadata.albumPic,
    ext,
    mime,
  }
}
