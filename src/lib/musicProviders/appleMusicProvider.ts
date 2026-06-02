import type { SongLesson } from '../../types'

declare global {
  interface Window {
    MusicKit?: {
      configure(options: {
        developerToken: string
        app: {
          name: string
          build: string
        }
      }): AppleMusicInstance
      getInstance(): AppleMusicInstance
    }
  }
}

interface AppleMusicInstance {
  isAuthorized: boolean
  musicUserToken?: string
  player: {
    currentPlaybackTime: number
    currentPlaybackDuration: number
    isPlaying: boolean
    play(): Promise<void>
    pause(): void
    seekToTime(seconds: number): Promise<void>
  }
  authorize(): Promise<string>
  setQueue(options: { songs: string[] }): Promise<unknown>
}

interface AppleMusicTokenResponse {
  developerToken?: string
  error?: string
  missing?: string[]
}

let musicKitLoadPromise: Promise<void> | null = null
let configurePromise: Promise<AppleMusicInstance> | null = null

function loadMusicKitScript() {
  if (window.MusicKit) {
    return Promise.resolve()
  }

  if (musicKitLoadPromise) {
    return musicKitLoadPromise
  }

  musicKitLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-yuru-musickit]')
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true })
      existingScript.addEventListener('error', () => reject(new Error('MusicKit 加载失败')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.dataset.yuruMusickit = 'true'
    script.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'
    script.async = true
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('MusicKit 加载失败')), { once: true })
    document.head.appendChild(script)
  })

  return musicKitLoadPromise
}

async function fetchDeveloperToken() {
  const response = await fetch('/api/apple-music-token')
  const payload = (await response.json().catch(() => ({}))) as AppleMusicTokenResponse

  if (!response.ok || !payload.developerToken) {
    const missing = payload.missing?.length ? `：${payload.missing.join('、')}` : ''
    throw new Error(payload.error ? `${payload.error}${missing}` : 'Apple Music 未配置')
  }

  return payload.developerToken
}

export async function configureAppleMusic() {
  if (configurePromise) {
    return configurePromise
  }

  configurePromise = (async () => {
    const developerToken = await fetchDeveloperToken()
    await loadMusicKitScript()
    if (!window.MusicKit) {
      throw new Error('MusicKit 不可用')
    }

    return window.MusicKit.configure({
      developerToken,
      app: {
        name: 'YuruNihongo',
        build: 'song-learning',
      },
    })
  })()

  return configurePromise
}

export async function authorizeAppleMusic() {
  const music = await configureAppleMusic()
  if (music.isAuthorized || music.musicUserToken) {
    return music
  }

  await music.authorize()
  return music
}

export async function playAppleMusicSong(song: SongLesson) {
  if (!song.appleMusicId) {
    throw new Error('这首歌还没有匹配到 Apple Music 曲目')
  }

  const music = await authorizeAppleMusic()
  await music.setQueue({ songs: [song.appleMusicId] })
  await music.player.play()
  return music
}

export async function pauseAppleMusic() {
  const music = await configureAppleMusic()
  music.player.pause()
}

export async function seekAppleMusic(seconds: number) {
  const music = await configureAppleMusic()
  await music.player.seekToTime(seconds)
}

export async function getAppleMusicPlaybackSnapshot() {
  const music = await configureAppleMusic()
  return {
    currentMs: Math.round(music.player.currentPlaybackTime * 1000),
    durationMs: Math.round(music.player.currentPlaybackDuration * 1000),
    playing: music.player.isPlaying,
    authorized: music.isAuthorized || Boolean(music.musicUserToken),
  }
}
