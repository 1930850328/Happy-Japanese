import { upload as uploadBlob } from '@vercel/blob/client'

import type { LyricLine, LyricProvider, SongLyricQuality, SongStudyIndex } from '../types'
import { getCloudProfileId } from './cloudProfile'

const SONG_UPLOAD_ENDPOINT = '/api/song-upload'
const SONG_BLOB_UPLOAD_ENDPOINT = '/api/song-blob-upload'
const SONG_SERVER_UPLOAD_ENDPOINT = '/api/song-upload-server'
const SONG_ASSETS_ENDPOINT = '/api/song-assets'
const FALLBACK_API_ORIGIN = 'https://yuru-nihongo-study.vercel.app'
const SERVER_UPLOAD_CHUNK_SIZE = 2 * 1024 * 1024

export interface SiteSongAsset {
  id: string
  title: string
  artist: string
  cover: string
  durationMs: number
  storageProvider?: 'tos' | 'vercel-blob'
  audioObjectKey?: string
  audioUrl?: string
  audioFileName: string
  audioFileType: string
  audioSize: number
  lyricObjectKey?: string
  lyricUrl?: string
  lyricFileName?: string
  lyricFileType?: string
  lyricSize?: number
  lyricLines: LyricLine[]
  lyricProvider?: LyricProvider
  lyricQuality?: SongLyricQuality
  studyIndex?: SongStudyIndex
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
  lyricProvider?: LyricProvider
  lyricQuality?: SongLyricQuality
  studyIndex?: SongStudyIndex
  onProgress?: (message: string, percent: number) => void
}

interface SongLyricsUpdateInput {
  song: SiteSongAsset
  lyricsFile: File
  lyricLines: LyricLine[]
}

interface SongStudyIndexUpdateInput {
  song: SiteSongAsset
  studyIndex: SongStudyIndex
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
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
  const profileId = getCloudProfileId()
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

function uploadFileToSignedUrl(ticket: UploadTicket, file: File, onProgress?: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', ticket.uploadUrl)
    xhr.setRequestHeader('Content-Type', ticket.contentType || file.type || 'application/octet-stream')
    xhr.timeout = 45_000
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
        return
      }

      reject(new Error(`TOS upload failed with status ${xhr.status}.`))
    }
    xhr.onerror = () => reject(new Error('TOS upload network error.'))
    xhr.onabort = () => reject(new Error('TOS upload aborted.'))
    xhr.ontimeout = () => reject(new Error('TOS upload timed out.'))
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.send(file)
  })
}

async function uploadFileThroughServer(ticket: UploadTicket, file: File) {
  const params = new URLSearchParams({
    profileId: getCloudProfileId(),
    objectKey: ticket.objectKey,
    contentType: ticket.contentType || file.type || 'application/octet-stream',
  })
  const response = await fetch(`${getApiEndpoint(SONG_SERVER_UPLOAD_ENDPOINT)}?${params.toString()}`, {
    method: 'PUT',
    headers: {
      'Content-Type': ticket.contentType || file.type || 'application/octet-stream',
    },
    body: file,
  })

  await readJsonResponse(response, '歌曲服务端上传失败')
}

async function uploadFileThroughServerChunks(ticket: UploadTicket, file: File) {
  const profileId = getCloudProfileId()
  const contentType = ticket.contentType || file.type || 'application/octet-stream'
  const chunks: Array<{ objectKey: string; size: number }> = []
  const totalChunks = Math.ceil(file.size / SERVER_UPLOAD_CHUNK_SIZE)

  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * SERVER_UPLOAD_CHUNK_SIZE
    const end = Math.min(file.size, start + SERVER_UPLOAD_CHUNK_SIZE)
    const blob = file.slice(start, end)
    const params = new URLSearchParams({
      mode: 'chunk',
      profileId,
      objectKey: ticket.objectKey,
      chunkIndex: String(index),
    })

    const response = await fetch(`${getApiEndpoint(SONG_SERVER_UPLOAD_ENDPOINT)}?${params.toString()}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: blob,
    })
    const body = await readJsonResponse(response, 'Song chunk upload failed.') as {
      objectKey?: string
      size?: number
    }

    if (!body.objectKey) {
      throw new Error('Song chunk upload did not return an object key.')
    }

    chunks.push({
      objectKey: body.objectKey,
      size: Math.max(0, Math.round(Number(body.size ?? blob.size))),
    })
  }

  const finalizeResponse = await fetch(`${getApiEndpoint(SONG_SERVER_UPLOAD_ENDPOINT)}?mode=finalize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      profileId,
      objectKey: ticket.objectKey,
      contentType,
      size: file.size,
      chunks,
    }),
  })

  await readJsonResponse(finalizeResponse, 'Song chunk upload finalization failed.')
}

async function uploadFileToBlob(ticket: UploadTicket, file: File) {
  const blob = await uploadBlob(ticket.objectKey, file, {
    access: 'public',
    handleUploadUrl: getApiEndpoint(SONG_BLOB_UPLOAD_ENDPOINT),
    contentType: ticket.contentType || file.type || 'application/octet-stream',
    multipart: file.size > 64 * 1024 * 1024,
  })

  return {
    url: blob.url,
    pathname: blob.pathname,
    contentType: blob.contentType,
  }
}

async function uploadSongFiles(
  ticket: UploadTicketResponse,
  audioFile?: File,
  lyricsFile?: File,
  onProgress?: (message: string, percent: number) => void,
) {
  if (audioFile && !ticket.tickets.audio) {
    throw new Error('歌曲上传没有返回音频上传地址。')
  }

  try {
    if (audioFile && ticket.tickets.audio) {
      await uploadFileToSignedUrl(ticket.tickets.audio, audioFile, (percent) => {
        onProgress?.(`正在上传音频 ${percent}%`, percent)
      })
    }
    if (lyricsFile && ticket.tickets.lyrics) {
      onProgress?.('正在上传歌词', 96)
      await uploadFileToSignedUrl(ticket.tickets.lyrics, lyricsFile)
    }

    return {
      storageProvider: 'tos' as const,
    }
  } catch {
    onProgress?.('直传未完成，正在切换备用线路', 60)
    try {
      if (audioFile && ticket.tickets.audio) {
        await uploadFileThroughServer(ticket.tickets.audio, audioFile)
      }
      if (lyricsFile && ticket.tickets.lyrics) {
        await uploadFileThroughServer(ticket.tickets.lyrics, lyricsFile)
      }

      return {
        storageProvider: 'tos' as const,
      }
    } catch {
      onProgress?.('正在尝试分片上传', 68)
      // Fall through to Blob when direct browser PUT and server-side TOS upload are both unavailable.
    }

    try {
      if (audioFile && ticket.tickets.audio) {
        await uploadFileThroughServerChunks(ticket.tickets.audio, audioFile)
      }
      if (lyricsFile && ticket.tickets.lyrics) {
        await uploadFileThroughServer(ticket.tickets.lyrics, lyricsFile)
      }

      return {
        storageProvider: 'tos' as const,
      }
    } catch {
      onProgress?.('正在切换备用存储', 76)
      // Fall through to Blob when chunked TOS upload is also unavailable.
    }

    const audioBlob = audioFile && ticket.tickets.audio
      ? await uploadFileToBlob(ticket.tickets.audio, audioFile)
      : undefined
    const lyricBlob = lyricsFile && ticket.tickets.lyrics
      ? await uploadFileToBlob(ticket.tickets.lyrics, lyricsFile)
      : undefined

    return {
      storageProvider: 'vercel-blob' as const,
      audioUrl: audioBlob?.url,
      lyricUrl: lyricBlob?.url,
    }
  }
}

async function saveSongAsset(song: Omit<SiteSongAsset, 'sourceUrl'>) {
  const profileId = getCloudProfileId()
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
  const profileId = getCloudProfileId()
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
  lyricProvider,
  lyricQuality,
  studyIndex,
  onProgress,
}: SongUploadInput) {
  onProgress?.('正在创建上传任务', 42)
  const ticket = await createUploadTicket({
    audioFile,
    lyricsFile,
  })

  if (!ticket.tickets.audio) {
    throw new Error('歌曲上传没有返回音频上传地址。')
  }

  onProgress?.('正在上传音频', 48)
  const uploadResult = await uploadSongFiles(ticket, audioFile, lyricsFile, (message, percent) => {
    onProgress?.(message, 48 + Math.round(percent * 0.42))
  })

  const now = new Date().toISOString()
  onProgress?.('正在保存歌曲信息', 92)
  return await saveSongAsset({
    id: ticket.songId,
    title,
    artist,
    cover,
    durationMs,
    storageProvider: uploadResult.storageProvider,
    audioObjectKey: uploadResult.storageProvider === 'tos' ? ticket.tickets.audio.objectKey : undefined,
    audioUrl: uploadResult.audioUrl,
    audioFileName: audioFile.name,
    audioFileType: getFileContentType(audioFile, 'audio/mpeg'),
    audioSize: audioFile.size,
    lyricObjectKey: uploadResult.storageProvider === 'tos' ? ticket.tickets.lyrics?.objectKey : undefined,
    lyricUrl: uploadResult.lyricUrl,
    lyricFileName: lyricsFile?.name,
    lyricFileType: lyricsFile ? getFileContentType(lyricsFile, 'text/plain; charset=utf-8') : undefined,
    lyricSize: lyricsFile?.size,
    lyricLines,
    lyricProvider,
    lyricQuality,
    studyIndex,
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

  const uploadResult = await uploadSongFiles(ticket, undefined, lyricsFile)
  return await saveSongAsset({
    ...song,
    storageProvider: uploadResult.storageProvider === 'vercel-blob' ? 'vercel-blob' : song.storageProvider,
    lyricObjectKey: uploadResult.storageProvider === 'tos' ? ticket.tickets.lyrics.objectKey : song.lyricObjectKey,
    lyricUrl: uploadResult.lyricUrl ?? song.lyricUrl,
    lyricFileName: lyricsFile.name,
    lyricFileType: getFileContentType(lyricsFile, 'text/plain; charset=utf-8'),
    lyricSize: lyricsFile.size,
    lyricLines,
    studyIndex: undefined,
    durationMs: Math.max(song.durationMs, lyricLines.at(-1)?.endMs ?? 0),
    updatedAt: new Date().toISOString(),
  })
}

export async function updateSiteSongStudyIndex({
  song,
  studyIndex,
}: SongStudyIndexUpdateInput) {
  return await saveSongAsset({
    ...song,
    studyIndex,
    updatedAt: new Date().toISOString(),
  })
}

export async function deleteSiteSongAsset(songId: string) {
  const profileId = getCloudProfileId()
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
