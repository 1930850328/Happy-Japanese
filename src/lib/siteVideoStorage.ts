import type { PutBlobResult, UploadProgressEvent } from '@vercel/blob'
import { upload } from '@vercel/blob/client'

const SITE_VIDEO_PREFIX = 'site-videos'
const FALLBACK_API_ORIGIN = 'https://yuru-nihongo-study.vercel.app'
const VIDEO_UPLOAD_ENDPOINT = '/api/video-upload'
const VIDEO_DELETE_ENDPOINT = '/api/video-delete'
const VIDEO_STORAGE_ENDPOINT = '/api/video-storage'

function sanitizeSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function getFileExtension(file: File) {
  const fileMatch = file.name.match(/(\.[a-z0-9]+)$/i)
  if (fileMatch) {
    return fileMatch[1].toLowerCase()
  }

  const mimeMap: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/ogg': '.ogv',
    'video/quicktime': '.mov',
    'video/x-matroska': '.mkv',
    'video/x-msvideo': '.avi',
  }

  return mimeMap[file.type] || '.mp4'
}

function buildSiteVideoPath(file: File, title?: string) {
  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const stem = sanitizeSegment(title || file.name) || `video-${crypto.randomUUID()}`
  return `${SITE_VIDEO_PREFIX}/${year}/${month}/${stem}${getFileExtension(file)}`
}

function getApiEndpoint(pathname: string) {
  if (typeof window === 'undefined') {
    return pathname
  }

  const { origin, hostname } = window.location
  if (hostname === '127.0.0.1' || hostname === 'localhost') {
    return `${FALLBACK_API_ORIGIN}${pathname}`
  }

  return `${origin}${pathname}`
}

function parseErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    if (/quota|Storage quota exceeded|insufficient storage/i.test(error.message)) {
      return [
        '站点视频存储额度已满，当前视频仍保留在本地草稿。',
        '请先在“站点视频存储”里清理未关联旧视频，或到 Vercel 升级 Blob 存储额度后再上传。',
      ].join('')
    }

    return error.message
  }

  return fallback
}

function buildPasswordHeaders(uploadPassword?: string) {
  return uploadPassword?.trim()
    ? {
        'x-upload-password': uploadPassword.trim(),
      }
    : undefined
}

async function readJsonResponse(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  if (!response.ok) {
    throw new Error(body?.error || '站内视频存储请求失败。')
  }

  return body
}

export interface SiteVideoUploadInput {
  file: File
  title?: string
  uploadPassword?: string
  onUploadProgress?: (event: UploadProgressEvent) => void
}

export interface SiteVideoObject {
  url: string
  pathname: string
  size: number
  uploadedAt: string
}

export interface SiteVideoStorageSummary {
  blobs: SiteVideoObject[]
  count: number
  totalSize: number
}

export function isManagedSiteVideoUrl(value: string) {
  try {
    const url = new URL(value)
    return (
      url.hostname.endsWith('.blob.vercel-storage.com') &&
      url.pathname.startsWith(`/${SITE_VIDEO_PREFIX}/`)
    )
  } catch {
    return false
  }
}

export async function uploadVideoToSite({
  file,
  title,
  uploadPassword,
  onUploadProgress,
}: SiteVideoUploadInput): Promise<PutBlobResult> {
  try {
    return await upload(buildSiteVideoPath(file, title), file, {
      access: 'public',
      handleUploadUrl: getApiEndpoint(VIDEO_UPLOAD_ENDPOINT),
      headers: buildPasswordHeaders(uploadPassword),
      contentType: file.type || undefined,
      multipart: true,
      onUploadProgress,
    })
  } catch (error) {
    throw new Error(parseErrorMessage(error, '视频上传到站点失败。'))
  }
}

export async function listSiteVideoObjects(uploadPassword?: string) {
  const response = await fetch(getApiEndpoint(VIDEO_STORAGE_ENDPOINT), {
    method: 'GET',
    headers: buildPasswordHeaders(uploadPassword),
  })
  const body = (await readJsonResponse(response)) as SiteVideoStorageSummary | null
  return {
    blobs: Array.isArray(body?.blobs) ? body.blobs : [],
    count: Number(body?.count ?? 0),
    totalSize: Number(body?.totalSize ?? 0),
  } satisfies SiteVideoStorageSummary
}

export async function deleteSiteVideos(urls: string[], uploadPassword?: string) {
  const targets = urls.filter(isManagedSiteVideoUrl)
  if (targets.length === 0) {
    return
  }

  const response = await fetch(getApiEndpoint(VIDEO_DELETE_ENDPOINT), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildPasswordHeaders(uploadPassword),
    },
    body: JSON.stringify({ urls: targets }),
  })

  await readJsonResponse(response)
}
