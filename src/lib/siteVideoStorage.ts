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
    if (/Missing Cloudflare R2 configuration|R2_/i.test(error.message)) {
      return [
        'Cloudflare R2 视频存储配置不完整，当前视频仍保留在本地草稿。',
        '请在 Vercel 环境变量里配置 R2_ACCOUNT_ID、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY、R2_BUCKET 和 R2_PUBLIC_BASE_URL。',
      ].join('')
    }

    if (/cors|network|failed to fetch|status 0|R2 upload network/i.test(error.message)) {
      return [
        'Cloudflare R2 上传失败，当前视频仍保留在本地草稿。',
        '请检查 R2 Bucket CORS 是否允许当前网站域名进行 PUT 上传。',
      ].join('')
    }

    if (/quota|Storage quota exceeded|insufficient storage/i.test(error.message)) {
      return [
        '站点视频存储额度已满，当前视频仍保留在本地草稿。',
        '请先在“站点视频存储”里清理未关联旧视频，或检查 Cloudflare R2 的账户额度后再上传。',
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
  onUploadProgress?: (event: SiteVideoUploadProgressEvent) => void
}

export interface SiteVideoUploadProgressEvent {
  percentage: number
  loaded?: number
  total?: number
}

export interface SiteVideoUploadResult {
  url: string
  pathname: string
  contentType?: string
  provider?: string
}

interface SiteVideoUploadTicket extends SiteVideoUploadResult {
  uploadUrl: string
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
    return url.pathname.includes(`/${SITE_VIDEO_PREFIX}/`)
  } catch {
    return false
  }
}

async function createUploadTicket(
  file: File,
  title: string | undefined,
  uploadPassword: string | undefined,
) {
  const response = await fetch(getApiEndpoint(VIDEO_UPLOAD_ENDPOINT), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildPasswordHeaders(uploadPassword),
    },
    body: JSON.stringify({
      pathname: buildSiteVideoPath(file, title),
      contentType: file.type || 'video/mp4',
      size: file.size,
    }),
  })
  const body = (await readJsonResponse(response)) as SiteVideoUploadTicket | null

  if (!body?.uploadUrl || !body.url || !body.pathname) {
    throw new Error('站内视频存储没有返回可用的上传地址。')
  }

  return body
}

function uploadFileToSignedUrl(
  ticket: SiteVideoUploadTicket,
  file: File,
  onUploadProgress?: (event: SiteVideoUploadProgressEvent) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', ticket.uploadUrl)
    xhr.setRequestHeader('Content-Type', ticket.contentType || file.type || 'video/mp4')

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        return
      }

      const percentage = event.total > 0 ? (event.loaded / event.total) * 100 : 0
      onUploadProgress?.({
        percentage,
        loaded: event.loaded,
        total: event.total,
      })
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onUploadProgress?.({
          percentage: 100,
          loaded: file.size,
          total: file.size,
        })
        resolve()
        return
      }

      reject(new Error(`R2 upload failed with status ${xhr.status}.`))
    }

    xhr.onerror = () => reject(new Error('R2 upload network error.'))
    xhr.onabort = () => reject(new Error('R2 upload aborted.'))
    xhr.send(file)
  })
}

export async function uploadVideoToSite({
  file,
  title,
  uploadPassword,
  onUploadProgress,
}: SiteVideoUploadInput): Promise<SiteVideoUploadResult> {
  try {
    const ticket = await createUploadTicket(file, title, uploadPassword)
    await uploadFileToSignedUrl(ticket, file, onUploadProgress)
    return {
      url: ticket.url,
      pathname: ticket.pathname,
      contentType: ticket.contentType || file.type || 'video/mp4',
      provider: ticket.provider,
    }
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
