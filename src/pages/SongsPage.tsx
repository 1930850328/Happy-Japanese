import {
  AlertCircle,
  BookOpenText,
  Captions,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Gauge,
  Headphones,
  LibraryBig,
  ListMusic,
  Lock,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  Repeat1,
  Search,
  Settings2,
  Sparkles,
  Upload,
  Volume2,
} from 'lucide-react'
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { songLessons } from '../data/songLessons'
import { parseLyrics } from '../lib/lyrics'
import {
  getAppleMusicPlaybackSnapshot,
  pauseAppleMusic,
  playAppleMusicSong,
  seekAppleMusic,
} from '../lib/musicProviders/appleMusicProvider'
import { fetchApplePreview, fetchCommunitySyncedLyrics } from '../lib/songProviders'
import { speakJapanese } from '../lib/speech'
import { analyzeJapaneseText, hasReliableMeaning } from '../lib/textAnalysis'
import { useAppStore } from '../store/useAppStore'
import type { LyricLine, SentenceAnalysis, SongLesson, TokenAnalysis } from '../types'
import styles from './SongsPage.module.css'

const playbackRates = [0.75, 1, 1.25]
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

function buildImportedSong({
  title,
  artist,
  sourceUrl,
  lyricLines,
}: {
  title: string
  artist: string
  sourceUrl: string
  lyricLines: LyricLine[]
}): SongLesson {
  const durationMs = Math.max(30000, lyricLines.at(-1)?.endMs ?? 0)
  return {
    id: 'song-local-session',
    sourceType: 'local',
    sourceUrl,
    title,
    artist,
    cover: createImportedCover(title, artist),
    theme: '我的歌曲',
    difficulty: 'Custom',
    durationMs,
    lyricLines,
    knowledgePoints: [],
    tags: ['本地导入', lyricLines.length > 0 ? '双语歌词' : '等待歌词'],
    description: '本地整首歌曲学习会话。',
    creditLine: '仅在当前设备会话中学习。',
    playbackProvider: 'localFile',
    playbackStatus: sourceUrl ? 'ready' : 'locked',
    lyricProvider: 'manual',
    lyricQuality: lyricLines.length > 0 ? 'manual_imported' : 'needs_review',
    quality: lyricLines.length > 0 ? 'draft' : 'blocked',
  }
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
  if (song.lyricQuality === 'licensed_synced') return '授权同步歌词'
  if (song.lyricQuality === 'licensed_plain') return '授权歌词'
  if (song.lyricQuality === 'community_synced') return '社区同步歌词'
  if (song.lyricQuality === 'manual_imported') return '用户导入歌词'
  if (song.lyricQuality === 'machine_translated') return '学习翻译'
  if (song.quality === 'trusted') return '可信歌词'
  return '等待歌词'
}

function getPlaybackLabel(song: SongLesson, appleError: string) {
  if (song.playbackProvider === 'localFile') return '本地整首音频'
  if (song.playbackProvider === 'speech') return '逐句发音'
  if (song.playbackProvider === 'appleMusic') {
    return appleError ? '需配置 MusicKit' : 'Apple Music 整首'
  }
  return '播放源待确认'
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
  const uploadedUrlRef = useRef('')
  const activeLyricRowRef = useRef<HTMLButtonElement | null>(null)

  const immersiveMode = searchParams.get('mode') === 'immersive'
  const [customSong, setCustomSong] = useState<SongLesson | null>(null)
  const [catalogSongs, setCatalogSongs] = useState<Record<string, SongLesson>>({})
  const [activeSongId, setActiveSongId] = useState(songLessons[0]?.id ?? '')
  const [selectedLineId, setSelectedLineId] = useState(songLessons[0]?.lyricLines[0]?.id ?? '')
  const [currentMs, setCurrentMs] = useState(0)
  const [appleDurationMs, setAppleDurationMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [lineLoop, setLineLoop] = useState(false)
  const [beginnerMode, setBeginnerMode] = useState(true)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showKana, setShowKana] = useState(false)
  const [showRomaji, setShowRomaji] = useState(false)
  const [showZh, setShowZh] = useState(true)
  const [learningOpen, setLearningOpen] = useState(false)
  const [loadingSongId, setLoadingSongId] = useState('')
  const [metadataLoadingId, setMetadataLoadingId] = useState('')
  const [loadError, setLoadError] = useState('')
  const [appleError, setAppleError] = useState('')
  const [importTitle, setImportTitle] = useState('我的日语歌')
  const [importArtist, setImportArtist] = useState('本地音频')
  const [analysis, setAnalysis] = useState<SentenceAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  const songs = useMemo(() => {
    const hydratedCatalog = songLessons.map((song) => catalogSongs[song.id] ?? song)
    return customSong ? [customSong, ...hydratedCatalog] : hydratedCatalog
  }, [catalogSongs, customSong])
  const activeSong = songs.find((song) => song.id === activeSongId) ?? songs[0]
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
  const durationMs = activeSong?.playbackProvider === 'appleMusic' && appleDurationMs ? appleDurationMs : activeSong?.durationMs ?? 0
  const progressRatio = durationMs ? Math.min(1, currentMs / durationMs) : 0
  const displayTokens = analysis?.tokens.filter(hasDisplayableMeaning) ?? []
  const lineProgressRatio =
    activeLine && activeLine.endMs > activeLine.startMs
      ? Math.max(0, Math.min(1, (currentMs - activeLine.startMs) / (activeLine.endMs - activeLine.startMs)))
      : 0

  useEffect(() => {
    return () => {
      if (uploadedUrlRef.current) URL.revokeObjectURL(uploadedUrlRef.current)
    }
  }, [])

  useEffect(() => {
    setCurrentMs(0)
    setAppleDurationMs(0)
    setPlaying(false)
    setSelectedLineId(activeSong?.lyricLines[0]?.id ?? '')
    setAnalysis(null)
    setAppleError('')
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

  useEffect(() => {
    if (!playing || activeSong?.playbackProvider !== 'appleMusic') {
      return
    }

    const timer = window.setInterval(() => {
      void getAppleMusicPlaybackSnapshot()
        .then((snapshot) => {
          setCurrentMs(snapshot.currentMs)
          if (snapshot.durationMs) setAppleDurationMs(snapshot.durationMs)
          setPlaying(snapshot.playing)
        })
        .catch(() => undefined)
    }, 700)

    return () => window.clearInterval(timer)
  }, [activeSong?.playbackProvider, playing])

  const patchCatalogSong = (songId: string, patch: Partial<SongLesson>) => {
    setCatalogSongs((state) => {
      const base = state[songId] ?? songLessons.find((song) => song.id === songId)
      if (!base) return state
      return {
        ...state,
        [songId]: {
          ...base,
          ...patch,
        },
      }
    })
  }

  const hydrateSongAssets = async (song: SongLesson) => {
    if (song.sourceType !== 'catalog') return

    const currentSong = catalogSongs[song.id] ?? song
    if (!currentSong.appleMusicId && metadataLoadingId !== song.id) {
      setMetadataLoadingId(song.id)
      void fetchApplePreview(currentSong)
        .then((metadata) => {
          if (!metadata) return
          patchCatalogSong(song.id, {
            appleMusicId: metadata.appleMusicId,
            previewUrl: metadata.previewUrl,
            sourcePageUrl: metadata.sourcePageUrl,
            artworkUrl: metadata.artworkUrl,
            playbackStatus: metadata.appleMusicId ? 'ready' : 'locked',
          })
        })
        .catch(() => undefined)
        .finally(() => setMetadataLoadingId(''))
    }

    if (currentSong.lyricLines.length > 0 || loadingSongId === song.id) return

    setLoadingSongId(song.id)
    setLoadError('')
    try {
      const lyrics = await fetchCommunitySyncedLyrics(currentSong)
      patchCatalogSong(song.id, {
        lyricLines: lyrics.lyricLines,
        knowledgePoints: lyrics.knowledgePoints,
        creditLine: lyrics.creditLine,
        lyricProvider: 'lrclib',
        lyricQuality: 'community_synced',
        quality: 'draft',
        tags: [...new Set([...currentSong.tags, '社区同步歌词', '学习翻译'])],
      })
      setSelectedLineId(lyrics.lyricLines[0]?.id ?? '')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '同步歌词加载失败')
    } finally {
      setLoadingSongId('')
    }
  }

  useEffect(() => {
    if (activeSong?.sourceType === 'catalog') {
      void hydrateSongAssets(activeSong)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSong?.id])

  const handleSelectSong = (song: SongLesson) => {
    setActiveSongId(song.id)
    if (song.sourceType === 'catalog') void hydrateSongAssets(catalogSongs[song.id] ?? song)
  }

  const seekToLine = (line: LyricLine, shouldPlay = false) => {
    setSelectedLineId(line.id)
    setCurrentMs(line.startMs)

    if (activeSong?.playbackProvider === 'localFile' && audioRef.current && activeSong.sourceUrl) {
      audioRef.current.currentTime = line.startMs / 1000
      if (shouldPlay) void handlePlayPause()
      return
    }

    if (activeSong?.playbackProvider === 'appleMusic' && playing) {
      void seekAppleMusic(line.startMs / 1000).catch(() => undefined)
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

    if (activeSong.playbackProvider === 'appleMusic') {
      if (playing) {
        await pauseAppleMusic().catch(() => undefined)
        setPlaying(false)
        return
      }

      try {
        setAppleError('')
        await playAppleMusicSong(activeSong)
        setPlaying(true)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Apple Music 播放失败'
        setAppleError(message)
        toast.error(message)
      }
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

  const handleMediaUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) return

    if (uploadedUrlRef.current) URL.revokeObjectURL(uploadedUrlRef.current)

    const nextUrl = URL.createObjectURL(file)
    uploadedUrlRef.current = nextUrl
    const title = importTitle.trim() || file.name.replace(/\.[^.]+$/, '')
    const artist = importArtist.trim() || '本地音频'
    const nextSong = buildImportedSong({
      title,
      artist,
      sourceUrl: nextUrl,
      lyricLines: customSong?.lyricLines ?? [],
    })
    setImportTitle(title)
    setImportArtist(artist)
    setCustomSong(nextSong)
    setActiveSongId(nextSong.id)
    toast.success('本地整首音频已载入')
  }

  const handleLyricsUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) return

    const lyricLines = parseLyrics(await file.text(), file.name)
    if (lyricLines.length === 0) {
      toast.error('没有识别到可用歌词')
      return
    }

    const title = importTitle.trim() || customSong?.title || file.name.replace(/\.[^.]+$/, '')
    const artist = importArtist.trim() || customSong?.artist || '本地音频'
    const nextSong = buildImportedSong({
      title,
      artist,
      sourceUrl: customSong?.sourceUrl ?? '',
      lyricLines,
    })
    setCustomSong(nextSong)
    setActiveSongId(nextSong.id)
    setSelectedLineId(lyricLines[0].id)
    toast.success(`已导入 ${lyricLines.length} 行双语歌词`)
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

  const loadingCurrentSong = loadingSongId === activeSong.id
  const metadataLoading = metadataLoadingId === activeSong.id
  const canUseNativeAudio = activeSong.playbackProvider === 'localFile' && Boolean(activeSong.sourceUrl)
  const playLabel =
    activeSong.playbackProvider === 'appleMusic'
      ? playing
        ? '暂停'
        : '登录播放整首'
      : canUseNativeAudio
        ? playing
          ? '暂停'
          : '播放'
        : '听当前句'

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
                <span>热门近年</span>
                <strong>歌曲</strong>
              </div>
              <button type="button" aria-label="刷新当前歌曲资料" onClick={() => void hydrateSongAssets(activeSong)}>
                <RefreshCw size={16} />
              </button>
            </div>

            <div className={styles.songList}>
              {songs.map((song) => (
                <button
                  key={song.id}
                  className={`${styles.songItem} ${song.id === activeSong.id ? styles.songItemActive : ''}`}
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
                  <em>{song.playbackProvider === 'appleMusic' ? '整首' : song.lyricLines.length ? `${song.lyricLines.length} 句` : '导入'}</em>
                </button>
              ))}
            </div>

            <div className={styles.importDock}>
              <div>
                <strong>本地整首歌</strong>
                <small>上传音频和双语歌词后可离线学习</small>
              </div>
              <div className={styles.importFields}>
                <input aria-label="导入歌名" value={importTitle} onChange={(event) => setImportTitle(event.target.value)} />
                <input aria-label="导入歌手" value={importArtist} onChange={(event) => setImportArtist(event.target.value)} />
              </div>
              <div className={styles.importActions}>
                <label>
                  <Upload size={16} />
                  音频
                  <input hidden type="file" accept="audio/*,video/*" onChange={handleMediaUpload} />
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
              <button type="button" aria-label="上一首">
                <ChevronLeft size={18} />
              </button>
              <button type="button" aria-label="下一首">
                <ChevronRight size={18} />
              </button>
            </div>
            <div className={styles.sourcePill}>
              <span>来源：{getLyricQualityLabel(activeSong)}</span>
              <strong>{loadingCurrentSong ? '同步中' : '质量：待校对'}</strong>
            </div>
            <button className={styles.immersiveButton} type="button" onClick={() => setImmersiveMode(!immersiveMode)}>
              {immersiveMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              {immersiveMode ? '退出沉浸' : '沉浸学习'}
            </button>
          </header>

          <section className={styles.albumHero}>
            <img className={styles.heroCover} src={displayCover} alt={activeSong.title} />
            <div className={styles.heroMeta}>
              <div className={styles.statusBadges}>
                <span className={activeSong.appleMusicId ? styles.statusReady : styles.statusMuted}>
                  {metadataLoading ? <RefreshCw size={14} /> : activeSong.appleMusicId ? <CheckCircle2 size={14} /> : <Lock size={14} />}
                  {getPlaybackLabel(activeSong, appleError)}
                </span>
                <span className={loadingCurrentSong ? styles.statusSyncing : styles.statusReady}>
                  {loadingCurrentSong ? <RefreshCw size={14} /> : <Captions size={14} />}
                  {loadingCurrentSong ? '歌词同步中' : getLyricQualityLabel(activeSong)}
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
              {appleError ? (
                <p className={styles.warningText}>
                  <AlertCircle size={16} />
                  {appleError}
                </p>
              ) : null}
              <div className={styles.heroActions}>
                <button className={styles.primaryPlay} onClick={() => void handlePlayPause()}>
                  {playing ? <Pause size={20} /> : <Play size={20} />}
                  {playLabel}
                </button>
                <button onClick={() => void handleAddReview()}>
                  <LibraryBig size={18} />
                  加入复习
                </button>
                {activeSong.sourcePageUrl ? (
                  <a href={activeSong.sourcePageUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={18} />
                    打开歌曲
                  </a>
                ) : null}
              </div>
            </div>
          </section>

          <section className={styles.lyricStage}>
            <div className={styles.lyricTabs}>
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
                <strong>{loadingCurrentSong ? '正在同步歌词' : loadError || '等待双语歌词'}</strong>
                <span>热门歌曲会先加载同步歌词；也可以上传 LRC/SRT/VTT。</span>
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
