import {
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

import { LyricLearningLine } from '../components/songLearning/LyricLearningLine'
import { songLessons } from '../data/songLessons'
import {
  getNextStudyStage,
  getStudyStageLabel,
  isOccurrenceFocusedForStage,
  studyStageOptions,
} from '../lib/learningStagePolicy'
import { decodeNcmAudio, isNcmFile } from '../lib/ncmAudio'
import { type MatchedNeteaseSong, matchNeteaseSongForUpload } from '../lib/neteaseSongProvider'
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
  readCachedSiteSongAssets,
  type SiteSongAsset,
  updateSiteSongStudyIndex,
  uploadSongToSite,
} from '../lib/siteSongStorage'
import { speakJapanese } from '../lib/speech'
import {
  buildSongStudyIndex,
  getActiveSongStudyPartId,
  isSongStudyIndexFresh,
  songKnowledgeToKnowledgePoint,
} from '../lib/songStudyIndex'
import { useAppStore } from '../store/useAppStore'
import type {
  LyricLine,
  LyricProvider,
  SongKnowledge,
  SongLesson,
  SongLyricQuality,
  SongStudyIndex,
  SongStudyOccurrence,
  StudyStage,
} from '../types'
import styles from './SongsPage.module.css'

const playbackRates = [0.75, 1, 1.25]
const demoSongs = songLessons.filter((song) => song.sourceType === 'demo')
const fallbackSongId = demoSongs[0]?.id ?? songLessons[0]?.id ?? ''

function formatTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
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
  studyIndex?: SongStudyIndex
  importedAt: string
  updatedAt: string
  siteAsset?: SiteSongAsset
  localAsset?: StoredSongAsset
}

interface ImportProgress {
  fileName: string
  current: number
  total: number
  message: string
  percent: number
}

function getImportedAssetTitle(asset: Pick<ImportedSongAsset, 'title' | 'audioFileName'>) {
  if (asset.title !== '我的日语歌') return asset.title
  const fileTitle = asset.audioFileName.replace(/\.[^.]+$/, '').trim()
  return fileTitle && fileTitle.toLowerCase() !== 'audio' ? fileTitle : '未命名歌曲'
}

function buildImportedSong(asset: ImportedSongAsset): SongLesson {
  const durationMs = Math.max(30000, asset.durationMs, asset.lyricLines.at(-1)?.endMs ?? 0)
  return {
    id: asset.id,
    sourceType: 'local',
    sourceUrl: asset.sourceUrl,
    title: getImportedAssetTitle(asset),
    artist: asset.artist,
    cover: asset.cover,
    theme: '我的歌曲',
    difficulty: 'Custom',
    durationMs,
    lyricLines: asset.lyricLines,
    studyIndex: asset.studyIndex,
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
    studyIndex: asset.studyIndex,
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
    studyIndex: asset.studyIndex,
    importedAt: asset.importedAt,
    updatedAt: asset.updatedAt,
    localAsset: asset,
  }
}

function stripFileExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').trim()
}

function createGeneratedLyricFileName(title: string) {
  const safeTitle = Array.from(title.replace(/[<>:"/\\|?*]/g, ''))
    .filter((char) => char.charCodeAt(0) > 31)
    .join('')
    .trim()
    .slice(0, 80)
  return `${safeTitle || 'lyrics'}.netease.lrc`
}

function normalizeDedupeText(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeMatchText(value: string) {
  return normalizeDedupeText(value)
    .replace(/[([{【（].*?[)\]}】）]/g, ' ')
    .replace(/[^\p{L}\p{N}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu, '')
}

function hasTextOverlap(left: string, right: string) {
  const leftText = normalizeMatchText(left)
  const rightText = normalizeMatchText(right)
  if (!leftText || !rightText) return false
  return leftText.includes(rightText) || rightText.includes(leftText)
}

function getAudioDedupeKey(fileName: string, fileSize: number) {
  const normalizedName = normalizeDedupeText(fileName)
  return normalizedName && fileSize > 0 ? `${normalizedName}:${fileSize}` : ''
}

function getImportedAssetDedupeKey(asset: Pick<ImportedSongAsset, 'audioFileName' | 'audioSize' | 'title' | 'artist'>) {
  const audioKey = getAudioDedupeKey(asset.audioFileName, asset.audioSize)
  if (audioKey) return `audio:${audioKey}`
  return `meta:${normalizeDedupeText(asset.title)}:${normalizeDedupeText(asset.artist)}`
}

function dedupeImportedAssets(assets: ImportedSongAsset[]) {
  const seen = new Set<string>()
  return assets.filter((asset) => {
    const key = getImportedAssetDedupeKey(asset)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function findDuplicateImportedAsset(
  assets: ImportedSongAsset[],
  candidate: {
    audioFileName: string
    audioSize: number
    title: string
    artist: string
    durationMs: number
  },
) {
  const audioKey = getAudioDedupeKey(candidate.audioFileName, candidate.audioSize)
  const audioDuplicate = audioKey
    ? assets.find((asset) => getAudioDedupeKey(asset.audioFileName, asset.audioSize) === audioKey)
    : undefined
  if (audioDuplicate) return audioDuplicate

  const candidateTitle = normalizeDedupeText(candidate.title)
  const candidateArtist = normalizeDedupeText(candidate.artist)
  if (!candidateTitle || !candidateArtist) return undefined

  return assets.find((asset) => {
    const sameSong = normalizeDedupeText(asset.title) === candidateTitle && normalizeDedupeText(asset.artist) === candidateArtist
    const closeDuration = !candidate.durationMs || !asset.durationMs || Math.abs(asset.durationMs - candidate.durationMs) <= 2500
    return sameSong && closeDuration
  })
}

function isUsableNeteaseMatch(input: { title: string; artist: string; durationMs: number }, match: MatchedNeteaseSong) {
  const titleMatches = hasTextOverlap(input.title, match.title)
  const artistMatches = hasTextOverlap(input.artist, match.artist)
  const durationMatches = !input.durationMs || !match.durationMs || Math.abs(input.durationMs - match.durationMs) <= 7000
  return titleMatches && (artistMatches || durationMatches)
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

function getArtistLabel(song: SongLesson) {
  if (song.sourceType === 'demo' && song.artist === 'YuruNihongo Original') return '原创示例'
  return song.artist
}

export function SongsPage() {
  const addSentenceToReview = useAppStore((state) => state.addSentenceToReview)
  const addKnowledgeToReview = useAppStore((state) => state.addKnowledgeToReview)
  const recordStudyEvent = useAppStore((state) => state.recordStudyEvent)
  const [searchParams, setSearchParams] = useSearchParams()

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const activeLyricRowRef = useRef<HTMLDivElement | null>(null)
  const speechPlaybackTimerRef = useRef<number | null>(null)

  const immersiveMode = searchParams.get('mode') === 'immersive'
  const initialSiteAssets = useMemo(() => readCachedSiteSongAssets(), [])
  const [siteAssets, setSiteAssets] = useState<SiteSongAsset[]>(initialSiteAssets)
  const [storedAssets, setStoredAssets] = useState<StoredSongAsset[]>([])
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({})
  const [activeSongId, setActiveSongId] = useState(fallbackSongId)
  const [selectedLineId, setSelectedLineId] = useState(demoSongs[0]?.lyricLines[0]?.id ?? '')
  const [currentMs, setCurrentMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [lineLoop, setLineLoop] = useState(false)
  const [studyStage, setStudyStage] = useState<StudyStage>('beginner')
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showKana, setShowKana] = useState(false)
  const [showRomaji, setShowRomaji] = useState(false)
  const [showZh, setShowZh] = useState(true)
  const [learningOpen, setLearningOpen] = useState(false)
  const [assetsLoading, setAssetsLoading] = useState(initialSiteAssets.length === 0)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [deletingSongIds, setDeletingSongIds] = useState<Set<string>>(() => new Set())
  const [loadError, setLoadError] = useState('')
  const [studyIndexes, setStudyIndexes] = useState<Record<string, SongStudyIndex>>({})
  const [indexingSongIds, setIndexingSongIds] = useState<Record<string, boolean>>({})

  const importedAssets = useMemo(() => {
    const siteImportedAssets = siteAssets.map(buildSiteImportedAsset)
    const localImportedAssets = storedAssets.map((asset) => buildLocalImportedAsset(asset, assetUrls[asset.id] ?? ''))
    return dedupeImportedAssets([...siteImportedAssets, ...localImportedAssets])
  }, [assetUrls, siteAssets, storedAssets])
  const assetById = useMemo(() => new Map(importedAssets.map((asset) => [asset.id, asset])), [importedAssets])
  const songs = useMemo(() => {
    if (assetsLoading) return []
    return importedAssets.length > 0 ? importedAssets.map(buildImportedSong) : demoSongs
  }, [assetsLoading, importedAssets])
  const activeSong = songs.find((song) => song.id === activeSongId) ?? songs[0]
  const displayCover = activeSong?.artworkUrl || activeSong?.cover
  const activeAsset = activeSong ? assetById.get(activeSong.id) : undefined
  const activeStudyIndexCandidate = activeSong
    ? studyIndexes[activeSong.id] ?? activeSong.studyIndex ?? activeAsset?.studyIndex
    : undefined
  const activeStudyIndex = activeSong && isSongStudyIndexFresh(activeStudyIndexCandidate, activeSong.id, activeSong.lyricLines)
    ? activeStudyIndexCandidate
    : undefined
  const activeStudyLineById = useMemo(() => {
    return new Map((activeStudyIndex?.lines ?? []).map((line) => [line.lineId, line]))
  }, [activeStudyIndex])
  const activeOccurrenceById = useMemo(() => {
    return new Map((activeStudyIndex?.occurrences ?? []).map((occurrence) => [occurrence.id, occurrence]))
  }, [activeStudyIndex])

  const lineByTime = useMemo(() => {
    return activeSong?.lyricLines.find((line) => currentMs >= line.startMs && currentMs < line.endMs) ?? null
  }, [activeSong, currentMs])

  const selectedLine = useMemo(() => {
    return activeSong?.lyricLines.find((line) => line.id === selectedLineId) ?? null
  }, [activeSong, selectedLineId])

  const activeLine = lineByTime ?? selectedLine ?? activeSong?.lyricLines[0] ?? null
  const activeStudyLine = activeLine ? activeStudyLineById.get(activeLine.id) : undefined
  const durationMs = activeSong?.durationMs ?? 0
  const progressRatio = durationMs ? Math.min(1, currentMs / durationMs) : 0
  const activeStudyPartId = useMemo(
    () => getActiveSongStudyPartId(activeStudyLine, currentMs),
    [activeStudyLine, currentMs],
  )
  const activeKnowledgeItems = useMemo(() => {
    if (!activeStudyIndex || !activeStudyLine) return []

    const seenKnowledgeIds = new Set<string>()
    return activeStudyLine.occurrenceIds
      .map((id) => activeOccurrenceById.get(id))
      .filter((occurrence): occurrence is SongStudyOccurrence => Boolean(occurrence))
      .filter((occurrence) => isOccurrenceFocusedForStage(occurrence, activeStudyIndex, studyStage))
      .map((occurrence) => activeStudyIndex.knowledge[occurrence.knowledgeId])
      .filter((knowledge): knowledge is SongKnowledge => {
        if (!knowledge || seenKnowledgeIds.has(knowledge.id)) return false
        seenKnowledgeIds.add(knowledge.id)
        return true
      })
  }, [activeOccurrenceById, activeStudyIndex, activeStudyLine, studyStage])

  const clearSpeechPlaybackTimer = () => {
    if (speechPlaybackTimerRef.current === null) return
    window.clearTimeout(speechPlaybackTimerRef.current)
    speechPlaybackTimerRef.current = null
  }

  const stopSpeechPreview = () => {
    clearSpeechPlaybackTimer()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setPlaying(false)
  }

  const playSpeechPreview = (text: string) => {
    const started = speakJapanese(text)
    if (!started) return false

    clearSpeechPlaybackTimer()
    setPlaying(true)
    const estimatedDurationMs = Math.min(8000, Math.max(1500, text.length * 170))
    speechPlaybackTimerRef.current = window.setTimeout(() => {
      speechPlaybackTimerRef.current = null
      setPlaying(false)
    }, estimatedDurationMs)
    return true
  }

  const persistSongStudyIndex = async (index: SongStudyIndex) => {
    const asset = assetById.get(index.songId)
    if (!asset) return

    try {
      if (asset.storage === 'site' && asset.siteAsset) {
        const updated = await updateSiteSongStudyIndex({
          song: asset.siteAsset,
          studyIndex: index,
        })
        setSiteAssets((current) => current.map((item) => (item.id === updated.id ? updated : item)))
        return
      }

      if (asset.storage === 'local' && asset.localAsset) {
        const updated: StoredSongAsset = {
          ...asset.localAsset,
          studyIndex: index,
          updatedAt: new Date().toISOString(),
        }
        await saveStoredSongAsset(updated)
        setStoredAssets((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      }
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : '学习索引保存失败，本次会先使用临时索引')
    }
  }

  async function refreshSongAssets(nextActiveId?: string) {
    if (siteAssets.length === 0 && storedAssets.length === 0) setAssetsLoading(true)
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
    clearSpeechPlaybackTimer()
    setCurrentMs(0)
    setPlaying(false)
    setSelectedLineId(activeSong?.lyricLines[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSong?.id])

  useEffect(() => {
    return () => {
      clearSpeechPlaybackTimer()
    }
  }, [])

  useEffect(() => {
    const row = activeLyricRowRef.current
    const container = row?.parentElement
    if (row && container) {
      const rowRect = row.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const rowMiddle = rowRect.top - containerRect.top + container.scrollTop + rowRect.height / 2
      const targetTop = rowMiddle - container.clientHeight / 2
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      })
    }
  }, [activeLine?.id, showKana, showRomaji, showZh])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate
  }, [playbackRate])

  useEffect(() => {
    if (!activeSong || activeSong.lyricLines.length === 0) {
      return
    }

    const existingIndex = studyIndexes[activeSong.id] ?? activeSong.studyIndex ?? activeAsset?.studyIndex
    if (isSongStudyIndexFresh(existingIndex, activeSong.id, activeSong.lyricLines)) {
      if (!studyIndexes[activeSong.id] && existingIndex) {
        setStudyIndexes((current) => ({
          ...current,
          [activeSong.id]: existingIndex,
        }))
      }
      return
    }

    let ignore = false
    setIndexingSongIds((current) => ({ ...current, [activeSong.id]: true }))
    void buildSongStudyIndex({
      songId: activeSong.id,
      title: activeSong.title,
      artist: activeSong.artist,
      lyricLines: activeSong.lyricLines,
      quality: activeSong.quality,
    })
      .then((index) => {
        if (ignore) return

        setStudyIndexes((current) => ({
          ...current,
          [activeSong.id]: index,
        }))
        void persistSongStudyIndex(index)
      })
      .catch((error: unknown) => {
        if (!ignore) {
          toast.warning(error instanceof Error ? error.message : '学习索引生成失败')
        }
      })
      .finally(() => {
        if (!ignore) {
          setIndexingSongIds((current) => ({ ...current, [activeSong.id]: false }))
        }
      })

    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAsset?.studyIndex, activeSong, studyIndexes])

  const handleSelectSong = (song: SongLesson) => {
    setActiveSongId(song.id)
  }

  const seekToLine = (line: LyricLine, shouldPlay = false) => {
    setSelectedLineId(line.id)
    setCurrentMs(line.startMs)

    if (activeSong?.playbackProvider === 'localFile' && audioRef.current && activeSong.sourceUrl) {
      clearSpeechPlaybackTimer()
      audioRef.current.currentTime = line.startMs / 1000
      if (shouldPlay) {
        void audioRef.current.play().then(() => setPlaying(true)).catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : '本地音频播放失败')
        })
      }
      return
    }

    if (shouldPlay) playSpeechPreview(line.ja)
  }

  const handlePlayPause = async () => {
    if (!activeSong) return

    if (activeSong.playbackProvider === 'localFile' && activeSong.sourceUrl) {
      clearSpeechPlaybackTimer()
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

    if (playing) {
      stopSpeechPreview()
      return
    }

    if (activeLine) playSpeechPreview(activeLine.ja)
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

  const importMediaFile = async (
    file: File,
    knownAssets: ImportedSongAsset[],
    onProgress: (message: string, percent: number) => void,
  ) => {
    onProgress('正在读取音频信息', 6)
    let audioFile = file
    let ncmInfo: Awaited<ReturnType<typeof decodeNcmAudio>> | null = null

    if (isNcmFile(file)) {
      onProgress('正在解析 NCM 音频', 10)
      ncmInfo = await decodeNcmAudio(file)
      audioFile = ncmInfo.file
    }

    let title = ncmInfo?.title || stripFileExtension(audioFile.name)
    let artist = ncmInfo?.artist || '本地音频'
    const durationMs = await readMediaDurationMs(audioFile)
    onProgress('音频信息读取完成', 20)
    let cover = ncmInfo?.cover || createImportedCover(title, artist)
    let lyricLines: LyricLine[] = []
    let lyricText = ''
    let lyricFileName = ''
    let lyricProvider: LyricProvider | undefined
    let lyricQuality: SongLyricQuality | undefined
    let lyricsFile: File | undefined

    const duplicateBeforeMatch = findDuplicateImportedAsset(knownAssets, {
      audioFileName: audioFile.name,
      audioSize: audioFile.size,
      title,
      artist,
      durationMs,
    })
    if (duplicateBeforeMatch) {
      return {
        status: 'skipped' as const,
        id: duplicateBeforeMatch.id,
        title: duplicateBeforeMatch.title,
        firstLineId: duplicateBeforeMatch.lyricLines[0]?.id ?? '',
      }
    }

    try {
      onProgress('正在匹配歌词和封面', 28)
      const matchInput = { title, artist, durationMs }
      const match = await matchNeteaseSongForUpload(matchInput)

      if (match && isUsableNeteaseMatch(matchInput, match)) {
        title = ncmInfo?.title || match.title || title
        artist = ncmInfo?.artist || match.artist || artist
        cover = match.cover || cover
        lyricLines = match.lyricLines
        lyricText = match.rawLyricText
        lyricFileName = createGeneratedLyricFileName(title)
        lyricsFile = new File([lyricText], lyricFileName, { type: 'text/plain; charset=utf-8' })
        lyricProvider = 'netease'
        lyricQuality = 'community_synced'
      } else if (match) {
        toast.warning(`${title} 的歌词匹配结果不一致，已跳过自动绑定`)
      }
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : `${title} 自动匹配歌词失败，仍会保存音频`)
    }

    const duplicateAfterMatch = findDuplicateImportedAsset(knownAssets, {
      audioFileName: audioFile.name,
      audioSize: audioFile.size,
      title,
      artist,
      durationMs,
    })
    if (duplicateAfterMatch) {
      return {
        status: 'skipped' as const,
        id: duplicateAfterMatch.id,
        title: duplicateAfterMatch.title,
        firstLineId: duplicateAfterMatch.lyricLines[0]?.id ?? '',
      }
    }

    const lyricDurationMs = lyricLines.at(-1)?.endMs ?? 0
    const finalDurationMs = Math.max(durationMs, lyricDurationMs)

    try {
      const siteAsset = await uploadSongToSite({
        audioFile,
        lyricsFile,
        title,
        artist,
        cover,
        durationMs: finalDurationMs,
        lyricLines,
        lyricProvider,
        lyricQuality,
        onProgress,
      })
      onProgress('导入完成', 100)
      return {
        status: 'imported' as const,
        id: siteAsset.id,
        title,
        firstLineId: siteAsset.lyricLines[0]?.id ?? '',
        asset: buildSiteImportedAsset(siteAsset),
      }
    } catch (error) {
      onProgress('云端暂不可用，正在保存到本机', 82)
      toast.warning(error instanceof Error ? `云端保存失败：${error.message}` : '云端保存失败，正在保存到本机')
      const now = new Date().toISOString()
      const localAssetId = createLocalSongAssetId()

      const asset: StoredSongAsset = {
        id: localAssetId,
        title,
        artist,
        cover,
        audioBlob: audioFile,
        audioFileName: audioFile.name,
        audioFileType: audioFile.type || 'audio/mpeg',
        audioSize: audioFile.size,
        durationMs: finalDurationMs,
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
        onProgress('已保存到本机', 100)
        return {
          status: 'imported' as const,
          id: asset.id,
          title,
          firstLineId: asset.lyricLines[0]?.id ?? '',
          asset: buildLocalImportedAsset(asset, ''),
        }
      } catch (localError) {
        throw localError instanceof Error ? localError : error
      }
    }
  }

  const handleMediaUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const files = Array.from(input.files ?? [])
    if (files.length === 0) return

    setImporting(true)
    input.value = ''

    let knownAssets = [...importedAssets]
    let firstActiveId = ''
    let firstLineId = ''
    let importedCount = 0
    let skippedCount = 0
    let failedCount = 0

    for (const [index, file] of files.entries()) {
      const reportProgress = (message: string, percent: number) => {
        setImportProgress((current) => ({
          fileName: file.name,
          current: index + 1,
          total: files.length,
          message,
          percent: current?.fileName === file.name
            ? Math.max(current.percent, Math.max(0, Math.min(100, percent)))
            : Math.max(0, Math.min(100, percent)),
        }))
      }
      try {
        const result = await importMediaFile(file, knownAssets, reportProgress)
        if (!firstActiveId) {
          firstActiveId = result.id
          firstLineId = result.firstLineId
        }

        if (result.status === 'imported') {
          importedCount += 1
          knownAssets = dedupeImportedAssets([...knownAssets, result.asset])
        } else {
          skippedCount += 1
        }
      } catch (error) {
        failedCount += 1
        toast.error(error instanceof Error ? `${file.name}：${error.message}` : `${file.name} 导入失败`)
      }
    }

    try {
      setImportProgress((current) => current ? { ...current, message: '正在刷新歌曲列表', percent: 100 } : current)
      await refreshSongAssets(firstActiveId || undefined)
      if (firstLineId) setSelectedLineId(firstLineId)

      if (importedCount > 0) {
        toast.success(`已导入 ${importedCount} 首歌曲`)
      }
      if (skippedCount > 0) {
        toast.message(`已跳过 ${skippedCount} 首重复歌曲`)
      }
      if (failedCount > 0 && importedCount === 0 && skippedCount === 0) {
        toast.error('没有歌曲导入成功')
      }
    } finally {
      setImporting(false)
      setImportProgress(null)
    }
  }

  const handleDeleteSong = async (song: SongLesson) => {
    const asset = assetById.get(song.id)
    if (!asset || deletingSongIds.has(song.id)) return

    setDeletingSongIds((current) => new Set(current).add(song.id))
    if (asset.storage === 'site') {
      setSiteAssets((current) => current.filter((item) => item.id !== song.id))
    } else {
      setStoredAssets((current) => current.filter((item) => item.id !== song.id))
    }

    try {
      if (asset.storage === 'site') {
        await deleteSiteSongAsset(song.id)
      } else {
        await deleteStoredSongAsset(song.id)
      }
      toast.success(`已删除 ${song.title}`)
    } catch (error) {
      if (asset.storage === 'site' && asset.siteAsset) {
        setSiteAssets((current) => [asset.siteAsset!, ...current.filter((item) => item.id !== song.id)])
      } else if (asset.localAsset) {
        setStoredAssets((current) => [asset.localAsset!, ...current.filter((item) => item.id !== song.id)])
      }
      toast.error(error instanceof Error ? error.message : '歌曲删除失败')
    } finally {
      setDeletingSongIds((current) => {
        const next = new Set(current)
        next.delete(song.id)
        return next
      })
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

  const handleAddKnowledgeReview = async (knowledge: SongKnowledge) => {
    if (!activeSong) return

    const sourceId = `song:${activeSong.id}:knowledge:${knowledge.id}`
    const addedCount = await addKnowledgeToReview(
      [songKnowledgeToKnowledgePoint(knowledge)],
      sourceId,
      activeSong.id,
    )
    await recordStudyEvent({
      type: knowledge.kind,
      sourceId,
      title: knowledge.expression,
      dedupeKey: `song-knowledge-review:${activeSong.id}:${knowledge.id}`,
    })
    toast.success(addedCount > 0 ? '已加入学习' : '复习库里已经有这个知识点')
  }

  const setImmersiveMode = (next: boolean) => {
    const nextParams = new URLSearchParams(searchParams)
    if (next) nextParams.set('mode', 'immersive')
    else nextParams.delete('mode')
    setSearchParams(nextParams, { replace: true })
  }

  if (assetsLoading || !activeSong) {
    return (
      <div className={styles.page} aria-busy="true" aria-label="正在加载歌曲库">
        <section className={styles.musicApp}>
          <aside className={styles.catalogRail}>
            <div className={styles.brand}>
              <strong>悠<span>日语</span></strong>
              <small>用歌曲学日语</small>
            </div>
            <nav className={styles.songNav} aria-label="歌曲模块导航">
              <NavLink to="/">发现</NavLink>
              <span>歌曲</span>
              <NavLink to="/review">复习库</NavLink>
            </nav>
            <label className={styles.searchBox}>
              <Search size={16} />
              <input aria-label="搜索歌曲" placeholder="搜索歌曲 / 歌手" disabled />
            </label>
            <div className={styles.catalogLoading}>
              <div className={styles.catalogLoadingTitle}>
                <RefreshCw size={16} />
                <strong>正在加载歌曲</strong>
              </div>
              {[0, 1, 2].map((item) => <span key={item} className={styles.songLoadingRow} />)}
            </div>
          </aside>
          <main className={styles.stage}>
            <header className={styles.topBar}>
              <div />
              <div className={styles.sourcePill}><strong>歌曲库</strong><span>正在同步歌曲资源</span></div>
              <div />
            </header>
            <div className={styles.stageLoading}>
              <RefreshCw size={28} />
              <strong>正在加载你的歌曲库</strong>
              <span>马上就好…</span>
            </div>
          </main>
        </section>
      </div>
    )
  }

  const loadingCurrentSong = assetsLoading || importing
  const canUseNativeAudio = activeSong.playbackProvider === 'localFile' && Boolean(activeSong.sourceUrl)
  const playLabel = canUseNativeAudio ? (playing ? '暂停' : '播放') : '听当前句'
  const importedSongCount = importedAssets.length

  return (
    <div className={`${styles.page} ${immersiveMode ? styles.pageImmersive : ''} ${playing ? styles.pagePlaying : ''}`}>
      <div className={styles.backgroundGlow} style={{ backgroundImage: `url(${displayCover})` }} />

      <section className={styles.musicApp}>
        {!immersiveMode ? (
          <aside className={styles.catalogRail}>
            <div className={styles.brand}>
              <strong>悠<span>日语</span></strong>
              <small>用歌曲学日语</small>
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
                <span>{importedSongCount > 0 ? `${importedSongCount} 首已导入` : '上传后自动整理'}</span>
                <strong>我的歌曲</strong>
              </div>
              <button type="button" aria-label="刷新歌曲资源" onClick={() => void refreshSongAssets()}>
                <RefreshCw size={16} className={assetsLoading ? styles.spinning : undefined} />
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
                          {getArtistLabel(song)}
                          {song.releaseYear ? ` · ${song.releaseYear}` : ''}
                        </small>
                      </span>
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
                <strong>导入歌曲</strong>
                <small>上传音频后自动匹配歌词和封面</small>
              </div>
              <div className={styles.importActions}>
                <label>
                  <Upload size={16} />
                  {importing ? '导入中' : '选择音频'}
                  <input hidden multiple type="file" accept="audio/*,video/*,.ncm" disabled={importing} onChange={(event) => void handleMediaUpload(event)} />
                </label>
              </div>
              {importProgress ? (
                <div className={styles.importProgress} role="status" aria-live="polite">
                  <div>
                    <strong>{importProgress.message}</strong>
                    <span>{importProgress.current}/{importProgress.total} · {importProgress.percent}%</span>
                  </div>
                  <small title={importProgress.fileName}>{importProgress.fileName}</small>
                  <span className={styles.importProgressTrack}>
                    <span style={{ width: `${importProgress.percent}%` }} />
                  </span>
                </div>
              ) : null}
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
              <strong>歌曲库</strong>
              <span>{importing ? '正在整理导入资源' : '选择歌曲后开始学习'}</span>
            </div>
            <button className={styles.immersiveButton} type="button" onClick={() => setImmersiveMode(!immersiveMode)}>
              {immersiveMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              {immersiveMode ? '播放器模式' : '沉浸学习'}
            </button>
          </header>

          <section className={styles.albumHero}>
            <div className={styles.vinylDisc}>
              <img className={styles.heroCover} src={displayCover} alt={activeSong.title} />
            </div>
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
              <p>{getArtistLabel(activeSong)}</p>
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
                  <button className={showKana ? styles.tabActive : ''} onClick={() => setShowKana((value) => !value)}>
                    假名
                  </button>
                  <button className={showRomaji ? styles.tabActive : ''} onClick={() => setShowRomaji((value) => !value)}>
                    罗马音
                  </button>
                  <button className={showZh ? styles.tabActive : ''} onClick={() => setShowZh((value) => !value)}>
                    译文
                  </button>
                </>
              )}
              <div className={styles.stageTabs} aria-label="学习阶段">
                {studyStageOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={studyStage === option.id ? styles.tabActive : ''}
                    onClick={() => setStudyStage(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {activeSong && indexingSongIds[activeSong.id] ? (
                <span className={styles.indexingBadge}>本地 Codex 正在分析歌词（约 1–3 分钟）</span>
              ) : null}
            </div>

            {activeSong.lyricLines.length > 0 ? (
              <div className={styles.lyricQueue}>
                {activeSong.lyricLines.map((line) => {
                  const active = activeLine?.id === line.id
                  return (
                    <LyricLearningLine
                      key={line.id}
                      rowRef={active ? activeLyricRowRef : undefined}
                      line={line}
                      studyLine={activeStudyLineById.get(line.id)}
                      studyIndex={activeStudyIndex}
                      occurrenceById={activeOccurrenceById}
                      active={active}
                      activePartId={active ? activeStudyPartId : ''}
                      studyStage={studyStage}
                      showZh={showZh}
                      showKana={showKana}
                      showRomaji={showRomaji}
                      timeLabel={formatTime(line.startMs)}
                      classes={{
                        row: styles.lyricRow,
                        rowActive: styles.lyricRowActive,
                        time: styles.lyricTime,
                        textStack: styles.lyricTextStack,
                        wordLine: styles.lyricWordLine,
                        word: styles.lyricWord,
                        wordActive: styles.lyricWordActive,
                      }}
                      onSeek={seekToLine}
                      onAddKnowledge={handleAddKnowledgeReview}
                    />
                  )
                })}
              </div>
            ) : (
              <div className={styles.emptyLyrics}>
                {loadingCurrentSong ? <RefreshCw size={24} /> : <Headphones size={24} />}
                <strong>{loadingCurrentSong ? '正在处理本地资源' : loadError || '等待双语歌词'}</strong>
                <span>导入音频后会自动匹配歌词和封面。</span>
              </div>
            )}

          </section>
        </main>

        {immersiveMode ? (
          <button className={styles.learningDrawerButton} onClick={() => setLearningOpen((value) => !value)}>
            <Sparkles size={18} />
            学习
          </button>
        ) : null}
      </section>

      {immersiveMode && learningOpen ? (
        <aside className={styles.immersiveDrawer}>
          <button onClick={() => setLearningOpen(false)}>关闭</button>
          <h2>{getStudyStageLabel(studyStage)}学习</h2>
          {activeKnowledgeItems.length > 0 ? (
            <div className={styles.tokenRail} aria-label="当前句学习点">
              {activeKnowledgeItems.map((knowledge) => (
                <button
                  key={knowledge.id}
                  type="button"
                  className={knowledge.kind === 'grammar' ? styles.tokenRailGrammar : styles.tokenRailBeginner}
                  onClick={() => void handleAddKnowledgeReview(knowledge)}
                >
                  <strong>{knowledge.expression}</strong>
                  <small>{knowledge.meaningZh}</small>
                </button>
              ))}
            </div>
          ) : (
            <p>当前句暂无这个阶段的学习点</p>
          )}
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
            <small>{getArtistLabel(activeSong)}</small>
          </span>
        </div>
        <div className={styles.transport}>
          <button aria-label="单句循环" className={lineLoop ? styles.controlActive : ''} onClick={() => setLineLoop((value) => !value)}>
            <Repeat1 size={18} />
          </button>
          <button className={styles.barPlay} onClick={() => void handlePlayPause()}>
            {playing ? <Pause size={22} /> : <Play size={22} />}
          </button>
          <button aria-label="发音" onClick={() => activeLine && playSpeechPreview(activeLine.ja)}>
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
          <button className={styles.controlActive} onClick={() => setStudyStage((value) => getNextStudyStage(value))}>
            <Sparkles size={17} />
            {getStudyStageLabel(studyStage)}
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
