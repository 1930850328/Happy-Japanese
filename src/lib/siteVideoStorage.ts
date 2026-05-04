import type { PutBlobResult, UploadProgressEvent } from '@vercel/blob'
import { upload } from '@vercel/blob/client'

const SITE_VIDEO_PREFIX = 'site-videos'
const FALLBACK_API_ORIGIN = 'https://yuru-nihongo-study.vercel.app'
const VIDEO_UPLOAD_ENDPOINT = '/api/video-upload'
const VIDEO_DELETE_ENDPOINT = '/api/video-delete'

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
    return error.message
  }

  return fallback
}

export interface SiteVideoUploadInput {
  file: File
  title?: string
  uploadPassword?: string
  onUploadProgress?: (event: UploadProgressEvent) => void
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
      headers: uploadPassword?.trim()
        ? {
            'x-upload-password': uploadPassword.trim(),
          }
        : undefined,
      contentType: file.type || undefined,
      multipart: true,
      onUploadProgress,
    })
  } catch (error) {
    throw new Error(parseErrorMessage(error, '视频上传到站点失败。'))
  }
}

export async function deleteSiteVideos(urls: string[]) {
  const targets = urls.filter(isManagedSiteVideoUrl)
  if (targets.length === 0) {
    return
  }

  const response = await fetch(getApiEndpoint(VIDEO_DELETE_ENDPOINT), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ urls: targets }),
  })

  if (response.ok) {
    return
  }

  const body = (await response.json().catch(() => null)) as { error?: string } | null
  throw new Error(body?.error || '站内视频删除失败。')
}
