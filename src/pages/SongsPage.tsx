import {
  BookOpenText,
  Captions,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Headphones,
  LibraryBig,
  ListMusic,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  Repeat1,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react'
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { songLessons } from '../data/songLessons'
import { parseLyrics } from '../lib/lyrics'
import { decodeNcmAudio, isNcmFile } from '../lib/ncmAudio'
import { matchNeteaseSongForUpload } from '../lib/neteaseSongProvider'
import {
  createLocalSongAssetId,
  deleteStoredSongAsset,
  listStoredSongAssets,
  saveStoredSongAsset,
  type StoredSongAsset,
} from '../lib/songAssetStorage'
import {
  deleteSiteSongAsset,
  listSiteSongAssets,
  type SiteSongAsset,
  updateSiteSongLyrics,
  uploadSongToSite,
} from '../lib/siteSongStorage'
import { speakJapanese } from '../lib/speech'
import { analyzeJapaneseText, hasReliableMeaning } from '../lib/textAnalysis'
import { useAppStore } from '../store/useAppStore'
import type { LyricLine, LyricProvider, SentenceAnalysis, SongLesson, SongLyricQuality, TokenAnalysis } from '../types'
import styles from './SongsPage.module.css'

const playbackRates = [0.75, 1, 1.25]
const demoSongs = songLessons.filter((song) => song.sourceType === 'demo')
const fallbackSongId = demoSongs[0]?.id ?? songLessons[0]?.id ?? ''
const beginnerParticles = new Map([
  ['は', '主题'],
  ['が', '主语'],
  ['を', '宾语'],
  ['に', '时间/方向'],
  ['へ', '方向'],
  ['で', '地点/方式'],
  ['と', '和/引用'],
  ['の', '的'],
  ['も', '也'],
  ['から', '从/因为'],
  ['まで', '到'],
  ['より', '比'],
  ['ね', '语气'],
  ['よ', '提醒'],
])
const beginnerWords = new Set([
  '私',
  '僕',
  '君',
  '今日',
  '明日',
  '昨日',
  '人',
  '心',
  '声',
  '夢',
  '夜',
  '朝',
  '好き',
  '見る',
  '聞く',
  '言う',
  '行く',
  '来る',
  'いる',
  'ある',
  'ない',
  'なる',
  'する',
])

function formatTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function getSectionLabel(section: LyricLine['section']) {
  if (section === 'chorus') return '副歌'
  if (section === 'bridge') return '桥段'
  if (section === 'intro') return '前奏'
  if (section === 'outro') return '尾声'
  return '主歌'
}

function createImportedCover(title: string, artist: string) {
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').slice(0, 24)
  const safeArtist = artist.replace(/&/g, '&amp;').replace(/</g, '&lt;').slice(0, 22)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#f1d9c2"/>
          <stop offset=".48" stop-color="#d9e7e3"/>
          <stop offset="1" stop-color="#bfd7e5"/>
        </linearGradient>
      </defs>
      <rect width="720" height="720" rx="54" fill="url(#bg)"/>
      <rect x="92" y="92" width="536" height="536" rx="42" fill="#24332f" opacity=".88"/>
      <circle cx="360" cy="340" r="118" fill="#fffaf2" opacity=".92"/>
      <circle cx="360" cy="340" r="42" fill="#24332f" opacity=".9"/>
      <path d="M488 162v172c0 34-27 62-62 62s-62-28-62-62 27-62 62-62c13 0 26 4 36 11V162h26z" fill="#fffaf2" opacity=".88"/>
      <text x="112" y="554" fill="#fffaf2" font-family="sans-serif" font-size="34" font-weight="700">${safeTitle}</text>
      <text x="112" y="596" fill="#d8e4dd" font-family="sans-serif" font-size="22">${safeArtist}</text>
    </svg>
  `
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

interface ImportedSongAsset {
  id: string
  storage: 'site' | 'local'
  title: string
  artist: string
  cover: string
  sourceUrl: string
  durationMs: number
  audioFileName: string
  audioFileType: string
  audioSize: number
  lyricFileName?: string
  lyricText?: string
  lyricLines: LyricLine[]
  lyricProvider?: LyricProvider
  lyricQuality?: SongLyricQuality
  importedAt: string
  updatedAt: string
  siteAsset?: SiteSongAsset
  localAsset?: StoredSongAsset
}

function buildImportedSong(asset: ImportedSongAsset): SongLesson {
  const durationMs = Math.max(30000, asset.durationMs, asset.lyricLines.at(-1)?.endMs ?? 0)
  return {
    id: asset.id,
    sourceType: 'local',
    sourceUrl: asset.sourceUrl,
    title: asset.title,
    artist: asset.artist,
    cover: asset.cover,
    theme: '我的歌曲',
    difficulty: 'Custom',
    durationMs,
    lyricLines: asset.lyricLines,
    knowledgePoints: [],
    tags: ['本地导入', asset.lyricLines.length > 0 ? '双语歌词' : '等待歌词'],
    description: '本地整首歌曲学习会话。',
    creditLine: asset.storage === 'site' ? '保存在 TOS 云端歌曲资源包。' : '保存在当前浏览器的本地歌曲资源包。',
    playbackProvider: 'localFile',
    playbackStatus: asset.sourceUrl ? 'ready' : 'loading',
    lyricProvider: asset.lyricProvider ?? 'manual',
    lyricQuality: asset.lyricQuality ?? (asset.lyricLines.length > 0 ? 'manual_imported' : 'needs_review'),
    quality: asset.lyricLines.length > 0 ? 'draft' : 'blocked',
  }
}

function buildSiteImportedAsset(asset: SiteSongAsset): ImportedSongAsset {
  return {
    id: asset.id,
    storage: 'site',
    title: asset.title,
    artist: asset.artist,
    cover: asset.cover,
    sourceUrl: asset.sourceUrl,
    durationMs: asset.durationMs,
    audioFileName: asset.audioFileName,
    audioFileType: asset.audioFileType,
    audioSize: asset.audioSize,
    lyricFileName: asset.lyricFileName,
    lyricLines: asset.lyricLines,
    lyricProvider: asset.lyricProvider,
    lyricQuality: asset.lyricQuality,
    importedAt: asset.importedAt,
    updatedAt: asset.updatedAt,
    siteAsset: asset,
  }
}

function buildLocalImportedAsset(asset: StoredSongAsset, sourceUrl: string): ImportedSongAsset {
  return {
    id: asset.id,
    storage: 'local',
    title: asset.title,
    artist: asset.artist,
    cover: asset.cover,
    sourceUrl,
    durationMs: asset.durationMs,
    audioFileName: asset.audioFileName,
    audioFileType: asset.audioFileType,
    audioSize: asset.audioSize,
    lyricFileName: asset.lyricFileName,
    lyricText: asset.lyricText,
    lyricLines: asset.lyricLines,
    lyricProvider: asset.lyricProvider,
    lyricQuality: asset.lyricQuality,
    importedAt: asset.importedAt,
    updatedAt: asset.updatedAt,
    localAsset: asset,
  }
}

function stripFileExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').trim()
}

function createGeneratedLyricFileName(title: string) {
  const safeTitle = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 80)
  return `${safeTitle || 'lyrics'}.netease.lrc`
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function readMediaDurationMs(file: File) {
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = document.createElement('audio')
    let settled = false
    const finish = (durationMs = 0) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(durationMs) ? Math.round(durationMs) : 0)
    }
    const timeout = window.setTimeout(() => finish(), 4500)

    audio.preload = 'metadata'
    audio.addEventListener('loadedmetadata', () => finish(audio.duration * 1000), { once: true })
    audio.addEventListener('error', () => finish(), { once: true })
    audio.src = url
  })
}

function resolveTokenMeaning(token: TokenAnalysis) {
  const particle = beginnerParticles.get(token.surface)
  if (particle) return particle
  return hasReliableMeaning(token.meaningZh) ? token.meaningZh : null
}

function hasDisplayableMeaning(token: TokenAnalysis) {
  return Boolean(resolveTokenMeaning(token))
}

function isBeginnerToken(token: TokenAnalysis) {
  return (
    beginnerParticles.has(token.surface) ||
    beginnerWords.has(token.surface) ||
    beginnerWords.has(token.base) ||
    /助詞|助動詞/.test(token.partOfSpeech)
  )
}

function getLyricQualityLabel(song: SongLesson) {
  if (song.lyricProvider === 'netease') return '网易云同步歌词'
  if (song.lyricQuality === 'licensed_synced') return '授权同步歌词'
  if (song.lyricQuality === 'licensed_plain') return '授权歌词'
  if (song.lyricQuality === 'community_synced') return '社区同步歌词'
  if (song.lyricQuality === 'manual_imported') return '用户导入歌词'
  if (song.lyricQuality === 'machine_translated') return '学习翻译'
  if (song.quality === 'trusted') return '可信歌词'
  return '等待歌词'
}

function getPlaybackLabel(song: SongLesson) {
  if (song.playbackProvider === 'localFile') return '本地整首音频'
  if (song.playbackProvider === 'speech') return '逐句发音'
  return '等待音频'
}

function renderTokenRail(tokens: TokenAnalysis[], beginnerMode: boolean) {
  const displayTokens = tokens.filter(hasDisplayableMeaning).slice(0, 9)
  if (displayTokens.length === 0) return null

  return (
    <div className={styles.tokenRail} aria-label="单词对照">
      {displayTokens.map((token) => {
        const beginner = beginnerMode && isBeginnerToken(token)
        const meaning = resolveTokenMeaning(token)
        return (
          <span key={token.id} className={beginner ? styles.tokenRailBeginner : ''}>
            <strong>{token.surface}</strong>
            <small>{meaning}</small>
          </span>
        )
      })}
    </div>
  )
}

export function SongsPage() {
  const notes = useAppStore((state) => state.notes)
  const addSentenceToReview = useAppStore((state) => state.addSentenceToReview)
  const recordStudyEvent = useAppStore((state) => state.recordStudyEvent)
  const [searchParams, setSearchParams] = useSearchParams()

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const activeLyricRowRef = useRef<HTMLButtonElement | null>(null)

  const immersiveMode = searchParams.get('mode') === 'immersive'
  const [siteAssets, setSiteAssets] = useState<SiteSongAsset[]>([])
  const [storedAssets, setStoredAssets] = useState<StoredSongAsset[]>([])
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({})
  const [pendingLyricFile, setPendingLyricFile] = useState<File | null>(null)
  const [pendingLyricLines, setPendingLyricLines] = useState<LyricLine[]>([])
  const [pendingLyricText, setPendingLyricText] = useState('')
  const [pendingLyricFileName, setPendingLyricFileName] = useState('')
  const [activeSongId, setActiveSongId] = useState(fallbackSongId)
  const [selectedLineId, setSelectedLineId] = useState(demoSongs[0]?.lyricLines[0]?.id ?? '')
  const [currentMs, setCurrentMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [lineLoop, setLineLoop] = useState(false)
  const [beginnerMode, setBeginnerMode] = useState(true)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showKana, setShowKana] = useState(false)
  const [showRomaji, setShowRomaji] = useState(false)
  const [showZh, setShowZh] = useState(true)
  const [learningOpen, setLearningOpen] = useState(false)
  const [assetsLoading, setAssetsLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [importTitle, setImportTitle] = useState('')
  const [importArtist, setImportArtist] = useState('')
  const [analysis, setAnalysis] = useState<SentenceAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  const importedAssets = useMemo(() => {
    const siteImportedAssets = siteAssets.map(buildSiteImportedAsset)
    const localImportedAssets = storedAssets.map((asset) => buildLocalImportedAsset(asset, assetUrls[asset.id] ?? ''))
    return [...siteImportedAssets, ...localImportedAssets]
  }, [assetUrls, siteAssets, storedAssets])
  const assetById = useMemo(() => new Map(importedAssets.map((asset) => [asset.id, asset])), [importedAssets])
  const songs = useMemo(() => {
    return [...importedAssets.map(buildImportedSong), ...demoSongs]
  }, [importedAssets])
  const activeSong = songs.find((song) => song.id === activeSongId) ?? songs[0]
  const activeAsset = activeSong ? assetById.get(activeSong.id) ?? null : null
  const displayCover = activeSong?.artworkUrl || activeSong?.cover

  const lineByTime = useMemo(() => {
    return activeSong?.lyricLines.find((line) => currentMs >= line.startMs && currentMs < line.endMs) ?? null
  }, [activeSong, currentMs])

  const selectedLine = useMemo(() => {
    return activeSong?.lyricLines.find((line) => line.id === selectedLineId) ?? null
  }, [activeSong, selectedLineId])

  const activeLine = lineByTime ?? selectedLine ?? activeSong?.lyricLines[0] ?? null
  const activeIndex = activeSong?.lyricLines.findIndex((line) => line.id === activeLine?.id) ?? -1
  const previousLine = activeIndex > 0 ? activeSong?.lyricLines[activeIndex - 1] : null
  const nextLine = activeIndex >= 0 ? activeSong?.lyricLines[activeIndex + 1] : null
  const activeKnowledge = useMemo(() => {
    if (!activeSong || !activeLine) return []
    return activeSong.knowledgePoints.filter((point) => activeLine.focusTermIds.includes(point.id))
  }, [activeLine, activeSong])

  const learnedLineCount = activeSong?.lyricLines.filter((line) => line.endMs <= currentMs).length ?? 0
  const totalLineCount = activeSong?.lyricLines.length ?? 0
  const durationMs = activeSong?.durationMs ?? 0
  const progressRatio = durationMs ? Math.min(1, currentMs / durationMs) : 0
  const displayTokens = analysis?.tokens.filter(hasDisplayableMeaning) ?? []
  const immersiveHintToken = displayTokens[0]
  const immersiveHintKnowledge = activeKnowledge[0]
  const immersiveHintTitle = immersiveHintToken?.surface ?? immersiveHintKnowledge?.expression ?? activeLine?.ja ?? '当前句'
  const immersiveHintText = immersiveHintToken
    ? `${immersiveHintToken.kana ? `${immersiveHintToken.kana} · ` : ''}${resolveTokenMeaning(immersiveHintToken)}`
    : immersiveHintKnowledge
      ? immersiveHintKnowledge.meaningZh
      : activeLine?.zh
  const lineProgressRatio =
    activeLine && activeLine.endMs > activeLine.startMs
      ? Math.max(0, Math.min(1, (currentMs - activeLine.startMs) / (activeLine.endMs - activeLine.startMs)))
      : 0

  async function refreshSongAssets(nextActiveId?: string) {
    setAssetsLoading(true)
    try {
      const [siteResult, localAssets] = await Promise.allSettled([
        listSiteSongAssets(),
        listStoredSongAssets(),
      ])
      const nextSiteAssets = siteResult.status === 'fulfilled' ? siteResult.value : []
      const nextLocalAssets = localAssets.status === 'fulfilled' ? localAssets.value : []
      const nextAssets = [...nextSiteAssets, ...nextLocalAssets]

      setSiteAssets(nextSiteAssets)
      setStoredAssets(nextLocalAssets)

      if (siteResult.status === 'rejected') {
        setLoadError(siteResult.reason instanceof Error ? siteResult.reason.message : 'TOS 歌曲资源加载失败')
      } else {
        setLoadError('')
      }

      if (localAssets.status === 'rejected') {
        toast.error(localAssets.reason instanceof Error ? localAssets.reason.message : '本地歌曲缓存读取失败')
      }

      if (nextActiveId) {
        setActiveSongId(nextActiveId)
      } else if (nextAssets.length > 0 && !nextAssets.some((asset) => asset.id === activeSongId)) {
        setActiveSongId(nextAssets[0].id)
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '本地歌曲资源读取失败')
    } finally {
      setAssetsLoading(false)
    }
  }

  useEffect(() => {
    void refreshSongAssets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const entries = storedAssets.map((asset) => [asset.id, URL.createObjectURL(asset.audioBlob)] as const)
    setAssetUrls(Object.fromEntries(entries))

    return () => {
      entries.forEach(([, url]) => URL.revokeObjectURL(url))
    }
  }, [storedAssets])

  useEffect(() => {
    if (songs.length > 0 && !songs.some((song) => song.id === activeSongId)) {
      setActiveSongId(songs[0].id)
    }
  }, [activeSongId, songs])

  useEffect(() => {
    setCurrentMs(0)
    setPlaying(false)
    setSelectedLineId(activeSong?.lyricLines[0]?.id ?? '')
    setAnalysis(null)
  }, [activeSong?.id])

  useEffect(() => {
    const row = activeLyricRowRef.current
    const container = row?.parentElement
    if (row && container) {
      container.scrollTo({
        top: Math.max(0, row.offsetTop - container.clientHeight / 2),
        behavior: 'smooth',
      })
    }
  }, [activeLine?.id])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate
  }, [playbackRate])

  useEffect(() => {
    if (!activeLine?.ja) {
      setAnalysis(null)
      return
    }

    let ignore = false
    setAnalyzing(true)
    void analyzeJapaneseText(activeLine.ja, notes)
      .then((next) => {
        if (!ignore) setAnalysis(next)
      })
      .finally(() => {
        if (!ignore) setAnalyzing(false)
      })

    return () => {
      ignore = true
    }
  }, [activeLine?.ja, notes])

  const handleSelectSong = (song: SongLesson) => {
    setActiveSongId(song.id)
  }

  const seekToLine = (line: LyricLine, shouldPlay = false) => {
    setSelectedLineId(line.id)
    setCurrentMs(line.startMs)

    if (activeSong?.playbackProvider === 'localFile' && audioRef.current && activeSong.sourceUrl) {
      audioRef.current.currentTime = line.startMs / 1000
      if (shouldPlay) {
        void audioRef.current.play().then(() => setPlaying(true)).catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : '本地音频播放失败')
        })
      }
      return
    }

    if (shouldPlay) speakJapanese(line.ja)
  }

  const handlePlayPause = async () => {
    if (!activeSong) return

    if (activeSong.playbackProvider === 'localFile' && activeSong.sourceUrl) {
      const audio = audioRef.current
      if (!audio) return

      try {
        if (audio.paused) {
          await audio.play()
          setPlaying(true)
        } else {
          audio.pause()
          setPlaying(false)
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '本地音频播放失败')
      }
      return
    }

    if (activeSong.playbackProvider === 'localFile') {
      toast.error('请先导入音频文件')
      return
    }

    if (activeLine) speakJapanese(activeLine.ja)
  }

  const handleTimeUpdate = () => {
    const audio = audioRef.current
    if (!audio) return

    const nextMs = Math.round(audio.currentTime * 1000)
    const playbackLine = activeSong?.lyricLines.find((line) => nextMs >= line.startMs && nextMs < line.endMs) ?? null

    if (lineLoop && playbackLine && nextMs >= playbackLine.endMs - 80) {
      audio.currentTime = playbackLine.startMs / 1000
      setCurrentMs(playbackLine.startMs)
      return
    }

    if (playbackLine && playbackLine.id !== selectedLineId) setSelectedLineId(playbackLine.id)
    setCurrentMs(nextMs)
  }

  const handleMediaUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return

    setImporting(true)
    input.value = ''
    let audioFile = file
    let ncmInfo: Awaited<ReturnType<typeof decodeNcmAudio>> | null = null

    if (isNcmFile(file)) {
      try {
        ncmInfo = await decodeNcmAudio(file)
        audioFile = ncmInfo.file
        toast.success(`已转换 NCM：${ncmInfo.file.name}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'NCM 文件转换失败')
        setImporting(false)
        return
      }
    }

    let title = importTitle.trim() || ncmInfo?.title || audioFile.name.replace(/\.[^.]+$/, '')
    let artist = importArtist.trim() || ncmInfo?.artist || '本地音频'
    const durationMs = await readMediaDurationMs(audioFile)
    let cover = ncmInfo?.cover || createImportedCover(title, artist)
    let lyricLines = pendingLyricLines
    let lyricText = pendingLyricText
    let lyricFileName = pendingLyricFileName
    let lyricProvider: LyricProvider | undefined = pendingLyricLines.length > 0 ? 'manual' : undefined
    let lyricQuality: SongLyricQuality | undefined = pendingLyricLines.length > 0 ? 'manual_imported' : undefined
    let lyricsFile: File | undefined =
      pendingLyricFile ??
      (pendingLyricText && pendingLyricFileName
        ? new File([pendingLyricText], pendingLyricFileName, { type: 'text/plain; charset=utf-8' })
        : undefined)

    if (lyricLines.length === 0) {
      toast.message('正在自动匹配歌词和封面')
      try {
        const match = await matchNeteaseSongForUpload({
          title,
          artist,
          durationMs,
        })

        if (match) {
          title = importTitle.trim() || match.title || title
          artist = importArtist.trim() || match.artist || artist
          cover = match.cover || cover
          lyricLines = match.lyricLines
          lyricText = match.rawLyricText
          lyricFileName = createGeneratedLyricFileName(title)
          lyricsFile = new File([lyricText], lyricFileName, { type: 'text/plain; charset=utf-8' })
          lyricProvider = 'netease'
          lyricQuality = 'community_synced'
          toast.success(`已匹配网易云歌词：${match.title}`)
        } else {
          toast.warning('没有自动匹配到可用同步歌词，仍会保存音频')
        }
      } catch (error) {
        toast.warning(error instanceof Error ? error.message : '自动匹配歌词失败，仍会保存音频')
      }
    }

    const lyricDurationMs = lyricLines.at(-1)?.endMs ?? 0
    const now = new Date().toISOString()

    try {
      const siteAsset = await uploadSongToSite({
        audioFile,
        lyricsFile,
        title,
        artist,
        cover,
        durationMs: Math.max(durationMs, lyricDurationMs),
        lyricLines,
        lyricProvider,
        lyricQuality,
      })
      await refreshSongAssets(siteAsset.id)
      setImportTitle(title)
      setImportArtist(artist)
      setPendingLyricFile(null)
      setPendingLyricLines([])
      setPendingLyricText('')
      setPendingLyricFileName('')
      setSelectedLineId(siteAsset.lyricLines[0]?.id ?? '')
      toast.success(`已保存到 TOS：${title}`)
    } catch (error) {
      const asset: StoredSongAsset = {
        id: createLocalSongAssetId(),
        title,
        artist,
        cover,
        audioBlob: audioFile,
        audioFileName: audioFile.name,
        audioFileType: audioFile.type || 'audio/mpeg',
        audioSize: audioFile.size,
        durationMs: Math.max(durationMs, lyricDurationMs),
        lyricFileName: lyricFileName || undefined,
        lyricText: lyricText || undefined,
        lyricLines,
        lyricProvider,
        lyricQuality,
        importedAt: now,
        updatedAt: now,
      }

      try {
        await saveStoredSongAsset(asset)
        await refreshSongAssets(asset.id)
        setImportTitle(title)
        setImportArtist(artist)
        setPendingLyricFile(null)
        setPendingLyricLines([])
        setPendingLyricText('')
        setPendingLyricFileName('')
        setSelectedLineId(asset.lyricLines[0]?.id ?? '')
        toast.success(`TOS 暂不可用，已保存到本地浏览器：${title}`)
      } catch (localError) {
        toast.error(localError instanceof Error ? localError.message : error instanceof Error ? error.message : '歌曲保存失败')
      }
    } finally {
      setImporting(false)
    }
  }

  const handleLyricsUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return

    const lyricText = await file.text()
    const lyricLines = parseLyrics(lyricText, file.name)
    input.value = ''
    if (lyricLines.length === 0) {
      toast.error('没有识别到可用歌词')
      return
    }

    if (!activeAsset) {
      setPendingLyricFile(file)
      setPendingLyricLines(lyricLines)
      setPendingLyricText(lyricText)
      setPendingLyricFileName(file.name)
      setImportTitle((current) => current.trim() || stripFileExtension(file.name))
      setSelectedLineId(lyricLines[0].id)
      toast.success(`歌词已暂存：${lyricLines.length} 行，继续导入音频即可保存`)
      return
    }

    if (activeAsset.storage === 'site' && activeAsset.siteAsset) {
      try {
        const nextAsset = await updateSiteSongLyrics({
          song: activeAsset.siteAsset,
          lyricsFile: file,
          lyricLines,
        })
        await refreshSongAssets(nextAsset.id)
        setSelectedLineId(lyricLines[0].id)
        toast.success(`已为 ${nextAsset.title} 保存云端歌词`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '云端歌词保存失败')
      }
      return
    }

    if (!activeAsset.localAsset) {
      toast.error('当前歌曲暂时不能绑定歌词')
      return
    }

    const nextAsset: StoredSongAsset = {
      ...activeAsset.localAsset,
      durationMs: Math.max(activeAsset.durationMs, lyricLines.at(-1)?.endMs ?? 0),
      lyricFileName: file.name,
      lyricText,
      lyricLines,
      updatedAt: new Date().toISOString(),
    }

    try {
      await saveStoredSongAsset(nextAsset)
      await refreshSongAssets(nextAsset.id)
      setSelectedLineId(lyricLines[0].id)
      toast.success(`已为 ${nextAsset.title} 保存 ${lyricLines.length} 行歌词`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '歌词保存失败')
    }
  }

  const handleDeleteSong = async (song: SongLesson) => {
    const asset = assetById.get(song.id)
    if (!asset) return

    try {
      if (asset.storage === 'site') {
        await deleteSiteSongAsset(song.id)
      } else {
        await deleteStoredSongAsset(song.id)
      }
      await refreshSongAssets()
      toast.success(`已删除 ${song.title}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '歌曲删除失败')
    }
  }

  const handleAddReview = async () => {
    if (!activeLine || !activeSong) return

    await addSentenceToReview(activeLine.ja, activeLine.kana, activeLine.zh)
    await recordStudyEvent({
      type: 'review',
      sourceId: `song:${activeSong.id}:${activeLine.id}`,
      title: activeLine.ja,
      dedupeKey: `song-line-review:${activeSong.id}:${activeLine.id}`,
    })
    toast.success('这句歌词已加入复习')
  }

  const setImmersiveMode = (next: boolean) => {
    const nextParams = new URLSearchParams(searchParams)
    if (next) nextParams.set('mode', 'immersive')
    else nextParams.delete('mode')
    setSearchParams(nextParams, { replace: true })
  }

  if (!activeSong) return null

  const loadingCurrentSong = assetsLoading || importing
  const canUseNativeAudio = activeSong.playbackProvider === 'localFile' && Boolean(activeSong.sourceUrl)
  const playLabel = canUseNativeAudio ? (playing ? '暂停' : '播放') : '听当前句'
  const sourceSummary = activeAsset
    ? `${activeAsset.storage === 'site' ? 'TOS 云端' : '本地缓存'} · ${activeAsset.audioFileName} · ${formatFileSize(activeAsset.audioSize)}`
    : activeSong.sourceType === 'demo'
      ? '演示素材'
      : '本地资源包'
  const lyricSummary = activeSong.lyricLines.length > 0 ? `${activeSong.lyricLines.length} 句歌词` : '等待歌词'

  return (
    <div className={`${styles.page} ${immersiveMode ? styles.pageImmersive : ''}`}>
      <div className={styles.backgroundGlow} style={{ backgroundImage: `url(${displayCover})` }} />

      <section className={styles.musicApp}>
        {!immersiveMode ? (
          <aside className={styles.catalogRail}>
            <div className={styles.brand}>
              <strong>Yuru<span>Nihongo</span></strong>
              <small>歌で学ぶ</small>
            </div>

            <nav className={styles.songNav} aria-label="歌曲模块导航">
              <NavLink to="/">发现</NavLink>
              <span>歌曲</span>
              <NavLink to="/review">复习库</NavLink>
            </nav>

            <label className={styles.searchBox}>
              <Search size={16} />
              <input aria-label="搜索歌曲" placeholder="搜索歌曲 / 歌手" />
            </label>

            <div className={styles.catalogHeader}>
              <div>
                <span>TOS / 本地资源包</span>
                <strong>我的歌曲</strong>
              </div>
              <button type="button" aria-label="刷新歌曲资源" onClick={() => void refreshSongAssets()}>
                <RefreshCw size={16} />
              </button>
            </div>

            <div className={styles.songList}>
              {songs.map((song) => {
                const importedAsset = assetById.get(song.id)
                return (
                  <div key={song.id} className={`${styles.songItemShell} ${song.id === activeSong.id ? styles.songItemShellActive : ''}`}>
                    <button
                      className={styles.songItem}
                      onClick={() => handleSelectSong(song)}
                    >
                      <img src={song.artworkUrl || song.cover} alt="" />
                      <span>
                        <strong>{song.title}</strong>
                        <small>
                          {song.artist}
                          {song.releaseYear ? ` · ${song.releaseYear}` : ''}
                        </small>
                      </span>
                      <em>{importedAsset ? (song.lyricLines.length ? `${song.lyricLines.length} 句` : '待歌词') : '示例'}</em>
                    </button>
                    {importedAsset ? (
                      <button
                        className={styles.songDeleteButton}
                        type="button"
                        aria-label={`删除 ${song.title}`}
                        onClick={() => void handleDeleteSong(song)}
                      >
                        <Trash2 size={15} />
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>

            <div className={styles.importDock}>
              <div>
                <strong>本地整首歌</strong>
                <small>优先上传到 TOS；接口不可用时保存在当前浏览器</small>
              </div>
              <div className={styles.importFields}>
                <input
                  aria-label="导入歌名"
                  placeholder="自动识别歌名"
                  value={importTitle}
                  onChange={(event) => setImportTitle(event.target.value)}
                />
                <input
                  aria-label="导入歌手"
                  placeholder="自动识别歌手"
                  value={importArtist}
                  onChange={(event) => setImportArtist(event.target.value)}
                />
              </div>
              {pendingLyricLines.length > 0 ? (
                <div className={styles.pendingImport}>
                  <CheckCircle2 size={15} />
                  <span>{pendingLyricFileName} · {pendingLyricLines.length} 行，等待音频</span>
                </div>
              ) : null}
              <div className={styles.importActions}>
                <label>
                  <Upload size={16} />
                  {importing ? '保存中' : '音频'}
                  <input hidden type="file" accept="audio/*,video/*,.ncm" disabled={importing} onChange={(event) => void handleMediaUpload(event)} />
                </label>
                <label>
                  <Captions size={16} />
                  歌词
                  <input hidden type="file" accept=".lrc,.srt,.vtt,.txt" onChange={(event) => void handleLyricsUpload(event)} />
                </label>
              </div>
            </div>
          </aside>
        ) : null}

        <main className={styles.stage}>
          <header className={styles.topBar}>
            <div className={styles.navigationButtons}>
              {immersiveMode ? (
                <button type="button" aria-label="退出沉浸模式" onClick={() => setImmersiveMode(false)}>
                  <ChevronDown size={22} />
                </button>
              ) : (
                <>
                  <button type="button" aria-label="上一首">
                    <ChevronLeft size={18} />
                  </button>
                  <button type="button" aria-label="下一首">
                    <ChevronRight size={18} />
                  </button>
                </>
              )}
            </div>
            <div className={styles.sourcePill}>
              <span>来源：{sourceSummary}</span>
              <strong>{loadingCurrentSong ? '处理中' : lyricSummary}</strong>
            </div>
            <button className={styles.immersiveButton} type="button" onClick={() => setImmersiveMode(!immersiveMode)}>
              {immersiveMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              {immersiveMode ? '播放器模式' : '沉浸学习'}
            </button>
          </header>

          <section className={styles.albumHero}>
            <img className={styles.heroCover} src={displayCover} alt={activeSong.title} />
            <div className={styles.heroMeta}>
              <div className={styles.statusBadges}>
                <span className={canUseNativeAudio || activeSong.playbackProvider === 'speech' ? styles.statusReady : styles.statusMuted}>
                  {loadingCurrentSong ? <RefreshCw size={14} /> : <CheckCircle2 size={14} />}
                  {getPlaybackLabel(activeSong)}
                </span>
                <span className={loadingCurrentSong ? styles.statusSyncing : styles.statusReady}>
                  {loadingCurrentSong ? <RefreshCw size={14} /> : <Captions size={14} />}
                  {loadingCurrentSong ? '资源处理中' : getLyricQualityLabel(activeSong)}
                </span>
              </div>
              <h1>{activeSong.title}</h1>
              <p>{activeSong.artist}</p>
              <dl>
                <div>
                  <dt>流派</dt>
                  <dd>{activeSong.theme}</dd>
                </div>
                <div>
                  <dt>年份</dt>
                  <dd>{activeSong.releaseYear ?? '原创'}</dd>
                </div>
                <div>
                  <dt>难度</dt>
                  <dd>{activeSong.difficulty}</dd>
                </div>
              </dl>
              <div className={styles.heroActions}>
                <button className={styles.primaryPlay} onClick={() => void handlePlayPause()}>
                  {playing ? <Pause size={20} /> : <Play size={20} />}
                  {playLabel}
                </button>
                <button onClick={() => void handleAddReview()}>
                  <LibraryBig size={18} />
                  加入复习
                </button>
              </div>
            </div>
          </section>

          <section className={styles.lyricStage}>
            <div className={styles.lyricTabs}>
              {immersiveMode ? (
                <>
                  <button className={styles.tabActive}>歌词</button>
                  <button type="button" onClick={() => setLearningOpen(true)}>
                    学习
                  </button>
                  <button type="button">相似推荐</button>
                </>
              ) : (
                <>
                  <button className={styles.tabActive}>同步歌词</button>
                  <button className={showKana ? styles.tabActive : ''} onClick={() => setShowKana((value) => !value)}>
                    假名
                  </button>
                  <button className={showRomaji ? styles.tabActive : ''} onClick={() => setShowRomaji((value) => !value)}>
                    罗马音
                  </button>
                  <button className={showZh ? styles.tabActive : ''} onClick={() => setShowZh((value) => !value)}>
                    译文
                  </button>
                  <button className={beginnerMode ? styles.tabActive : ''} onClick={() => setBeginnerMode((value) => !value)}>
                    新手高亮
                  </button>
                </>
              )}
            </div>

            {activeLine ? (
              <div className={styles.focusLyrics}>
                {previousLine ? (
                  <button className={styles.sideLyric} onClick={() => seekToLine(previousLine)}>
                    <strong>{previousLine.ja}</strong>
                    {showZh ? <small>{previousLine.zh}</small> : null}
                  </button>
                ) : null}

                <div className={styles.activeLyric}>
                  <span>{getSectionLabel(activeLine.section)}</span>
                  <strong>{activeLine.ja}</strong>
                  {showZh ? <p>{activeLine.zh}</p> : null}
                  {analysis ? renderTokenRail(analysis.tokens, beginnerMode) : null}
                  {showKana ? <small>{activeLine.kana}</small> : null}
                  {showRomaji ? <small>{activeLine.romaji}</small> : null}
                  <div className={styles.lineProgress}>
                    <div style={{ width: `${lineProgressRatio * 100}%` }} />
                  </div>
                </div>

                {nextLine ? (
                  <button className={styles.sideLyric} onClick={() => seekToLine(nextLine)}>
                    <strong>{nextLine.ja}</strong>
                    {showZh ? <small>{nextLine.zh}</small> : null}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className={styles.emptyLyrics}>
                {loadingCurrentSong ? <RefreshCw size={24} /> : <Headphones size={24} />}
                <strong>{loadingCurrentSong ? '正在处理本地资源' : loadError || '等待双语歌词'}</strong>
                <span>选择一首本地歌后上传 LRC/SRT/VTT，歌词会和音频一起保存。</span>
              </div>
            )}

            <div className={styles.lyricQueue}>
              {activeSong.lyricLines.map((line) => {
                const active = activeLine?.id === line.id
                return (
                  <button
                    key={line.id}
                    ref={active ? activeLyricRowRef : undefined}
                    className={`${styles.lyricRow} ${active ? styles.lyricRowActive : ''}`}
                    onClick={() => seekToLine(line)}
                    onDoubleClick={() => seekToLine(line, true)}
                  >
                    <span>{formatTime(line.startMs)}</span>
                    <strong>{line.ja}</strong>
                    {showZh ? <small>{line.zh}</small> : null}
                  </button>
                )
              })}
            </div>

            {activeLine && immersiveHintText ? (
              <div className={styles.immersiveStudyHint}>
                <strong>{immersiveHintTitle}</strong>
                <span>{immersiveHintText}</span>
              </div>
            ) : null}
          </section>
        </main>

        {!immersiveMode ? (
          <aside className={styles.studyRail}>
            <div className={styles.studyHeader}>
              <button className={styles.studyHeaderActive}>学习ノート</button>
              <button>AI 解说</button>
            </div>
            <section className={styles.studyCard}>
              <header>
                <span>キーワード</span>
                <strong>{displayTokens.length}</strong>
              </header>
              <div className={styles.tokenGrid}>
                {displayTokens.length > 0 ? (
                  displayTokens.slice(0, 7).map((token) => (
                    <article key={token.id} className={beginnerMode && isBeginnerToken(token) ? styles.beginnerTokenCard : ''}>
                      <strong>{token.surface}</strong>
                      <span>{token.kana}</span>
                      <small>{resolveTokenMeaning(token)}</small>
                    </article>
                  ))
                ) : (
                  <p className="sectionIntro">{analysis ? '这句暂无可确认单词。' : '选中一句歌词后显示单词。'}</p>
                )}
              </div>
            </section>

            <section className={styles.studyCard}>
              <header>
                <span>文法ノート</span>
                <strong>{analysis?.grammarMatches.length ?? 0}</strong>
              </header>
              <div className={styles.grammarHints}>
                {analysis?.grammarMatches.slice(0, 3).map((grammar) => (
                  <article key={grammar.id}>
                    <strong>{grammar.pattern}</strong>
                    <span>{grammar.meaningZh}</span>
                    <small>{grammar.explanationZh}</small>
                  </article>
                ))}
                {analysis && analysis.grammarMatches.length === 0 ? <p className="sectionIntro">这句暂无命中的固定语法。</p> : null}
              </div>
            </section>

            <section className={styles.studyCard}>
              <header>
                <span>学习进度</span>
                <strong>{learnedLineCount}/{totalLineCount}</strong>
              </header>
              <div className={styles.songProgress}>
                <div style={{ width: `${totalLineCount ? (learnedLineCount / totalLineCount) * 100 : 0}%` }} />
              </div>
              <div className={styles.quickStats}>
                <article>
                  <small>解析</small>
                  <strong>{analyzing ? '进行中' : '已就绪'}</strong>
                </article>
                <article>
                  <small>知识点</small>
                  <strong>{activeSong.knowledgePoints.length}</strong>
                </article>
              </div>
            </section>

            <section className={styles.studyCard}>
              <header>
                <span>保存候补</span>
                <BookOpenText size={18} />
              </header>
              <div className={styles.knowledgeList}>
                {(activeKnowledge.length > 0 ? activeKnowledge : activeSong.knowledgePoints.slice(0, 2)).map((point) => (
                  <article key={point.id}>
                    <strong>{point.expression}</strong>
                    <span>{point.meaningZh}</span>
                    <p>{point.explanationZh}</p>
                  </article>
                ))}
                {activeSong.knowledgePoints.length === 0 ? <p className="sectionIntro">导入歌曲的表达会通过句子解析辅助学习。</p> : null}
              </div>
            </section>
          </aside>
        ) : (
          <button className={styles.learningDrawerButton} onClick={() => setLearningOpen((value) => !value)}>
            <Sparkles size={18} />
            学习
          </button>
        )}
      </section>

      {immersiveMode && learningOpen ? (
        <aside className={styles.immersiveDrawer}>
          <button onClick={() => setLearningOpen(false)}>关闭</button>
          <h2>当前句学习</h2>
          {analysis ? renderTokenRail(analysis.tokens, beginnerMode) : <p>暂无解析</p>}
        </aside>
      ) : null}

      {canUseNativeAudio ? (
        <audio
          ref={audioRef}
          src={activeSong.sourceUrl}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      ) : null}

      <footer className={styles.playerBar}>
        <div className={styles.barSong}>
          <img src={displayCover} alt="" />
          <span>
            <strong>{activeSong.title}</strong>
            <small>{activeSong.artist}</small>
          </span>
        </div>
        <div className={styles.transport}>
          <button aria-label="单句循环" className={lineLoop ? styles.controlActive : ''} onClick={() => setLineLoop((value) => !value)}>
            <Repeat1 size={18} />
          </button>
          <button className={styles.barPlay} onClick={() => void handlePlayPause()}>
            {playing ? <Pause size={22} /> : <Play size={22} />}
          </button>
          <button aria-label="发音" onClick={() => activeLine && speakJapanese(activeLine.ja)}>
            <Volume2 size={18} />
          </button>
        </div>
        <div className={styles.barTimeline}>
          <span>{formatTime(currentMs)}</span>
          <div>
            <span style={{ width: `${progressRatio * 100}%` }} />
          </div>
          <span>{formatTime(durationMs)}</span>
        </div>
        <div className={styles.barTools}>
          <button className={showZh ? styles.controlActive : ''} onClick={() => setShowZh((value) => !value)}>
            <Captions size={17} />
          </button>
          <button className={beginnerMode ? styles.controlActive : ''} onClick={() => setBeginnerMode((value) => !value)}>
            <Sparkles size={17} />
          </button>
          <div className={styles.rateGroup}>
            <Gauge size={15} />
            {playbackRates.map((rate) => (
              <button key={rate} className={playbackRate === rate ? styles.rateActive : ''} onClick={() => setPlaybackRate(rate)}>
                {rate}x
              </button>
            ))}
          </div>
          <Settings2 size={18} />
          <ListMusic size={18} />
        </div>
      </footer>
    </div>
  )
}
