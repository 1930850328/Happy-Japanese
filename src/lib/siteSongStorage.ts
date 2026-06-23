import type { LyricLine } from '../types'

const PROFILE_STORAGE_KEY = 'yuru-nihongo-cloud-profile-id'
const SONG_UPLOAD_ENDPOINT = '/api/song-upload'
const SONG_ASSETS_ENDPOINT = '/api/song-assets'
const FALLBACK_API_ORIGIN = 'https://yuru-nihongo-study.vercel.app'

export interface SiteSongAsset {
  id: string
  title: string
  artist: string
  cover: string
  durationMs: number
  audioObjectKey: string
  audioFileName: string
  audioFileType: string
  audioSize: number
  lyricObjectKey?: string
  lyricFileName?: string
  lyricFileType?: string
  lyricSize?: number
  lyricLines: LyricLine[]
  importedAt: string
  updatedAt: string
  sourceUrl: string
}

interface UploadTicket {
  kind: 'audio' | 'lyrics'
  objectKey: string
  contentType: string
  uploadUrl: string
}

interface UploadTicketResponse {
  songId: string
  tickets: {
    audio?: UploadTicket
    lyrics?: UploadTicket
  }
}

interface SongUploadInput {
  audioFile: File
  lyricsFile?: File
  title: string
  artist: string
  cover: string
  durationMs: number
  lyricLines: LyricLine[]
}

interface SongLyricsUpdateInput {
  song: SiteSongAsset
  lyricsFile: File
  lyricLines: LyricLine[]
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function sanitizeProfileId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 64)
}

function getProfileId() {
  if (!isBrowser()) {
    return 'server'
  }

  const current = sanitizeProfileId(window.localStorage.getItem(PROFILE_STORAGE_KEY) || '')
  if (current) {
    return current
  }

  const next = sanitizeProfileId(crypto.randomUUID())
  window.localStorage.setItem(PROFILE_STORAGE_KEY, next)
  return next
}

function getApiEndpoint(pathname: string) {
  if (!isBrowser()) {
    return pathname
  }

  const { origin, hostname } = window.location
  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    return `${FALLBACK_API_ORIGIN}${pathname}`
  }

  return `${origin}${pathname}`
}

async function readJsonResponse(response: Response, fallback: string) {
  const contentType = response.headers.get('content-type') ?? ''
  const raw = await response.text()
  const body = contentType.includes('application/json') || raw.trimStart().startsWith('{')
    ? JSON.parse(raw) as { error?: string }
    : null

  if (!response.ok) {
    throw new Error(body?.error || fallback)
  }

  return body
}

function getFileContentType(file: File, fallback: string) {
  return file.type || fallback
}

async function createUploadTicket({
  songId,
  audioFile,
  lyricsFile,
}: {
  songId?: string
  audioFile?: File
  lyricsFile?: File
}) {
  const profileId = getProfileId()
  const response = await fetch(getApiEndpoint(SONG_UPLOAD_ENDPOINT), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      profileId,
      songId,
      audio: audioFile
        ? {
            fileName: audioFile.name,
            contentType: getFileContentType(audioFile, 'audio/mpeg'),
            size: audioFile.size,
          }
        : undefined,
      lyrics: lyricsFile
        ? {
            fileName: lyricsFile.name,
            contentType: getFileContentType(lyricsFile, 'text/plain; charset=utf-8'),
            size: lyricsFile.size,
          }
        : undefined,
    }),
  })

  return await readJsonResponse(response, '歌曲上传凭证创建失败') as unknown as UploadTicketResponse
}

function uploadFileToSignedUrl(ticket: UploadTicket, file: File) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', ticket.uploadUrl)
    xhr.setRequestHeader('Content-Type', ticket.contentType || file.type || 'application/octet-stream')
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
        return
      }

      reject(new Error(`TOS upload failed with status ${xhr.status}.`))
    }
    xhr.onerror = () => reject(new Error('TOS upload network error.'))
    xhr.onabort = () => reject(new Error('TOS upload aborted.'))
    xhr.send(file)
  })
}

async function saveSongAsset(song: Omit<SiteSongAsset, 'sourceUrl'>) {
  const profileId = getProfileId()
  const response = await fetch(getApiEndpoint(SONG_ASSETS_ENDPOINT), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      profileId,
      song,
    }),
  })
  const body = await readJsonResponse(response, '歌曲元数据保存失败') as { song?: SiteSongAsset }

  if (!body.song) {
    throw new Error('歌曲元数据保存后没有返回歌曲资源。')
  }

  return body.song
}

export async function listSiteSongAssets() {
  const profileId = getProfileId()
  const response = await fetch(
    `${getApiEndpoint(SONG_ASSETS_ENDPOINT)}?profileId=${encodeURIComponent(profileId)}`,
    {
      cache: 'no-store',
    },
  )
  const body = await readJsonResponse(response, '歌曲资源加载失败') as { songs?: SiteSongAsset[] }
  return Array.isArray(body.songs) ? body.songs : []
}

export async function uploadSongToSite({
  audioFile,
  lyricsFile,
  title,
  artist,
  cover,
  durationMs,
  lyricLines,
}: SongUploadInput) {
  const ticket = await createUploadTicket({
    audioFile,
    lyricsFile,
  })

  if (!ticket.tickets.audio) {
    throw new Error('歌曲上传没有返回音频上传地址。')
  }

  await uploadFileToSignedUrl(ticket.tickets.audio, audioFile)
  if (lyricsFile && ticket.tickets.lyrics) {
    await uploadFileToSignedUrl(ticket.tickets.lyrics, lyricsFile)
  }

  const now = new Date().toISOString()
  return await saveSongAsset({
    id: ticket.songId,
    title,
    artist,
    cover,
    durationMs,
    audioObjectKey: ticket.tickets.audio.objectKey,
    audioFileName: audioFile.name,
    audioFileType: getFileContentType(audioFile, 'audio/mpeg'),
    audioSize: audioFile.size,
    lyricObjectKey: ticket.tickets.lyrics?.objectKey,
    lyricFileName: lyricsFile?.name,
    lyricFileType: lyricsFile ? getFileContentType(lyricsFile, 'text/plain; charset=utf-8') : undefined,
    lyricSize: lyricsFile?.size,
    lyricLines,
    importedAt: now,
    updatedAt: now,
  })
}

export async function updateSiteSongLyrics({
  song,
  lyricsFile,
  lyricLines,
}: SongLyricsUpdateInput) {
  const ticket = await createUploadTicket({
    songId: song.id,
    lyricsFile,
  })

  if (!ticket.tickets.lyrics) {
    throw new Error('歌词上传没有返回上传地址。')
  }

  await uploadFileToSignedUrl(ticket.tickets.lyrics, lyricsFile)
  return await saveSongAsset({
    ...song,
    lyricObjectKey: ticket.tickets.lyrics.objectKey,
    lyricFileName: lyricsFile.name,
    lyricFileType: getFileContentType(lyricsFile, 'text/plain; charset=utf-8'),
    lyricSize: lyricsFile.size,
    lyricLines,
    durationMs: Math.max(song.durationMs, lyricLines.at(-1)?.endMs ?? 0),
    updatedAt: new Date().toISOString(),
  })
}

export async function deleteSiteSongAsset(songId: string) {
  const profileId = getProfileId()
  const response = await fetch(getApiEndpoint(SONG_ASSETS_ENDPOINT), {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      profileId,
      songId,
    }),
  })

  await readJsonResponse(response, '歌曲资源删除失败')
}
