import {
  AlertCircle,
  BookOpenText,
  Captions,
  ExternalLink,
  Gauge,
  Headphones,
  Languages,
  LibraryBig,
  Mic2,
  Music2,
  Pause,
  Play,
  Repeat1,
  RefreshCw,
  Sparkles,
  Upload,
  Volume2,
} from 'lucide-react'
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { songLessons } from '../data/songLessons'
import { parseLyrics } from '../lib/lyrics'
import { fetchApplePreview, fetchCommunitySyncedLyrics } from '../lib/songProviders'
import { speakJapanese } from '../lib/speech'
import { analyzeJapaneseText, UNKNOWN_MEANING } from '../lib/textAnalysis'
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
          <stop stop-color="#cfe1ed"/>
          <stop offset=".46" stop-color="#fff0cf"/>
          <stop offset="1" stop-color="#ead2d8"/>
        </linearGradient>
      </defs>
      <rect width="720" height="720" rx="72" fill="url(#bg)"/>
      <circle cx="360" cy="344" r="178" fill="#26312c" opacity=".84"/>
      <circle cx="360" cy="344" r="54" fill="#fffaf2" opacity=".94"/>
      <path d="M500 174v164c0 31-25 56-56 56s-56-25-56-56 25-56 56-56c12 0 24 4 34 11V174h22z" fill="#fffaf2" opacity=".88"/>
      <text x="72" y="566" fill="#26312c" font-family="sans-serif" font-size="34" font-weight="700">${safeTitle}</text>
      <text x="72" y="606" fill="#68746f" font-family="sans-serif" font-size="22">${safeArtist}</text>
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
    description: '本地歌曲学习会话。',
    creditLine: '仅在当前设备会话中学习。',
    lyricProvider: 'manual',
    lyricQuality: lyricLines.length > 0 ? 'manual_imported' : 'needs_review',
    quality: lyricLines.length > 0 ? 'draft' : 'blocked',
  }
}

function resolveTokenMeaning(token: TokenAnalysis) {
  const particle = beginnerParticles.get(token.surface)
  if (particle) {
    return particle
  }

  return token.meaningZh === UNKNOWN_MEANING ? '待补充' : token.meaningZh
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
  if (song.lyricQuality === 'machine_translated') return '机器翻译'
  if (song.quality === 'trusted') return '可信歌词'
  return '等待歌词'
}

function renderTokenRail(tokens: TokenAnalysis[], beginnerMode: boolean) {
  return (
    <div className={styles.tokenRail} aria-label="单词对照">
      {tokens.map((token) => {
        const beginner = beginnerMode && isBeginnerToken(token)
        return (
          <span key={token.id} className={beginner ? styles.tokenRailBeginner : ''}>
            <strong>{token.surface}</strong>
            <small>{resolveTokenMeaning(token)}</small>
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

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const uploadedUrlRef = useRef('')
  const activeLyricRowRef = useRef<HTMLButtonElement | null>(null)

  const [customSong, setCustomSong] = useState<SongLesson | null>(null)
  const [catalogSongs, setCatalogSongs] = useState<Record<string, SongLesson>>({})
  const [activeSongId, setActiveSongId] = useState(songLessons[0]?.id ?? '')
  const [selectedLineId, setSelectedLineId] = useState(songLessons[0]?.lyricLines[0]?.id ?? '')
  const [currentMs, setCurrentMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [lineLoop, setLineLoop] = useState(true)
  const [beginnerMode, setBeginnerMode] = useState(true)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showKana, setShowKana] = useState(true)
  const [showRomaji, setShowRomaji] = useState(false)
  const [showZh, setShowZh] = useState(true)
  const [loadingSongId, setLoadingSongId] = useState('')
  const [loadError, setLoadError] = useState('')
  const [importTitle, setImportTitle] = useState('我的日语歌')
  const [importArtist, setImportArtist] = useState('本地音频')
  const [analysis, setAnalysis] = useState<SentenceAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  const songs = useMemo(() => {
    const hydratedCatalog = songLessons.map((song) => catalogSongs[song.id] ?? song)
    return customSong ? [customSong, ...hydratedCatalog] : hydratedCatalog
  }, [catalogSongs, customSong])
  const activeSong = songs.find((song) => song.id === activeSongId) ?? songs[0]

  const lineByTime = useMemo(() => {
    return (
      activeSong?.lyricLines.find((line) => currentMs >= line.startMs && currentMs < line.endMs) ??
      null
    )
  }, [activeSong, currentMs])

  const selectedLine = useMemo(() => {
    return activeSong?.lyricLines.find((line) => line.id === selectedLineId) ?? null
  }, [activeSong, selectedLineId])

  const activeLine = lineByTime ?? selectedLine ?? activeSong?.lyricLines[0] ?? null
  const activeKnowledge = useMemo(() => {
    if (!activeSong || !activeLine) {
      return []
    }

    return activeSong.knowledgePoints.filter((point) => activeLine.focusTermIds.includes(point.id))
  }, [activeLine, activeSong])

  const learnedLineCount = activeSong?.lyricLines.filter((line) => line.endMs <= currentMs).length ?? 0
  const totalLineCount = activeSong?.lyricLines.length ?? 0
  const durationMs = activeSong?.durationMs ?? 0
  const progressRatio = durationMs ? Math.min(1, currentMs / durationMs) : 0
  const lineProgressRatio =
    activeLine && activeLine.endMs > activeLine.startMs
      ? Math.max(0, Math.min(1, (currentMs - activeLine.startMs) / (activeLine.endMs - activeLine.startMs)))
      : 0

  useEffect(() => {
    return () => {
      if (uploadedUrlRef.current) {
        URL.revokeObjectURL(uploadedUrlRef.current)
      }
    }
  }, [])

  useEffect(() => {
    setCurrentMs(0)
    setPlaying(false)
    setSelectedLineId(activeSong?.lyricLines[0]?.id ?? '')
    setAnalysis(null)
  }, [activeSong?.id])

  useEffect(() => {
    if (activeLyricRowRef.current) {
      activeLyricRowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeLine?.id])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate
    }
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
        if (!ignore) {
          setAnalysis(next)
        }
      })
      .finally(() => {
        if (!ignore) {
          setAnalyzing(false)
        }
      })

    return () => {
      ignore = true
    }
  }, [activeLine?.ja, notes])

  const hydrateSongAssets = async (song: SongLesson) => {
    if (song.sourceType !== 'catalog') {
      return
    }

    const currentSong = catalogSongs[song.id] ?? song
    if (loadingSongId === song.id) {
      return
    }

    setLoadingSongId(song.id)
    setLoadError('')
    try {
      const [preview, lyrics] = await Promise.allSettled([
        currentSong.sourceUrl ? Promise.resolve(null) : fetchApplePreview(currentSong),
        currentSong.lyricLines.length > 0 ? Promise.resolve(null) : fetchCommunitySyncedLyrics(currentSong),
      ])

      const nextSong: SongLesson = {
        ...currentSong,
      }

      if (preview.status === 'fulfilled' && preview.value) {
        nextSong.sourceUrl = preview.value.previewUrl
        nextSong.sourcePageUrl = preview.value.sourcePageUrl ?? nextSong.sourcePageUrl
      }

      if (lyrics.status === 'fulfilled' && lyrics.value) {
        nextSong.lyricLines = lyrics.value.lyricLines
        nextSong.knowledgePoints = lyrics.value.knowledgePoints
        nextSong.creditLine = lyrics.value.creditLine
        nextSong.lyricProvider = 'lrclib'
        nextSong.lyricQuality = 'community_synced'
        nextSong.quality = 'draft'
        nextSong.tags = [...new Set([...nextSong.tags, '社区同步歌词', '学习向中文'])]
      }

      setCatalogSongs((state) => ({
        ...state,
        [song.id]: nextSong,
      }))
      setSelectedLineId(nextSong.lyricLines[0]?.id ?? '')

      if (!nextSong.lyricLines.length) {
        setLoadError('没有自动找到同步歌词，可以上传 LRC/SRT/VTT 继续学习。')
      }
      if (!nextSong.sourceUrl) {
        toast.message('没有找到可播放预览，仍可用逐句发音学习。')
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '歌曲资料加载失败')
    } finally {
      setLoadingSongId('')
    }
  }

  useEffect(() => {
    if (activeSong?.sourceType === 'catalog' && activeSong.lyricLines.length === 0) {
      void hydrateSongAssets(activeSong)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSong?.id])

  const handleSelectSong = (song: SongLesson) => {
    setActiveSongId(song.id)
    if (song.sourceType === 'catalog') {
      void hydrateSongAssets(catalogSongs[song.id] ?? song)
    }
  }

  const seekToLine = (line: LyricLine, shouldPlay = false) => {
    setSelectedLineId(line.id)
    setCurrentMs(line.startMs)

    const audio = audioRef.current
    if (audio && activeSong?.sourceUrl) {
      audio.currentTime = line.startMs / 1000
      if (shouldPlay) {
        void audio.play()
        setPlaying(true)
      }
      return
    }

    if (shouldPlay) {
      speakJapanese(line.ja)
    }
  }

  const handlePlayPause = () => {
    if (!activeLine) {
      return
    }

    const audio = audioRef.current
    if (audio && activeSong?.sourceUrl) {
      if (audio.paused) {
        void audio.play()
        setPlaying(true)
      } else {
        audio.pause()
        setPlaying(false)
      }
      return
    }

    speakJapanese(activeLine.ja)
  }

  const handleTimeUpdate = () => {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    const nextMs = Math.round(audio.currentTime * 1000)
    const playbackLine =
      activeSong?.lyricLines.find((line) => nextMs >= line.startMs && nextMs < line.endMs) ?? null

    if (lineLoop && playbackLine && nextMs >= playbackLine.endMs - 80) {
      audio.currentTime = playbackLine.startMs / 1000
      setCurrentMs(playbackLine.startMs)
      return
    }

    if (playbackLine && playbackLine.id !== selectedLineId) {
      setSelectedLineId(playbackLine.id)
    }
    setCurrentMs(nextMs)
  }

  const handleMediaUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) {
      return
    }

    if (uploadedUrlRef.current) {
      URL.revokeObjectURL(uploadedUrlRef.current)
    }

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
    toast.success('歌曲文件已载入')
  }

  const handleLyricsUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    if (!file) {
      return
    }

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
    if (!activeLine) {
      return
    }

    await addSentenceToReview(activeLine.ja, activeLine.kana, activeLine.zh)
    await recordStudyEvent({
      type: 'review',
      sourceId: `song:${activeSong.id}:${activeLine.id}`,
      title: activeLine.ja,
      dedupeKey: `song-line-review:${activeSong.id}:${activeLine.id}`,
    })
    toast.success('这句歌词已加入复习')
  }

  if (!activeSong) {
    return null
  }

  return (
    <div className={`${styles.page} fadeIn`}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className="chip badgeMint">歌で学ぶ</span>
          <h1 className="pageTitle">把喜欢的歌，拆成一句一句能听懂的日语</h1>
          <p className="sectionIntro">
            用双语歌词时间轴做精听、跟读和复习。先听懂一句，再把那一句唱熟。
          </p>
        </div>

        <div className={`${styles.importPanel} glassCard`}>
          <div className={styles.importFields}>
            <label>
              <span>歌名</span>
              <input value={importTitle} onChange={(event) => setImportTitle(event.target.value)} />
            </label>
            <label>
              <span>歌手</span>
              <input value={importArtist} onChange={(event) => setImportArtist(event.target.value)} />
            </label>
          </div>
          <div className={styles.importActions}>
            <label className="softButton">
              <Upload size={18} />
              音频/视频
              <input hidden type="file" accept="audio/*,video/*" onChange={handleMediaUpload} />
            </label>
            <label className="softButton secondaryButton">
              <Captions size={18} />
              双语歌词
              <input hidden type="file" accept=".lrc,.srt,.vtt,.txt" onChange={(event) => void handleLyricsUpload(event)} />
            </label>
          </div>
        </div>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.library}>
          <div className={styles.libraryHeader}>
            <div>
              <span className="chip badgePeach">歌曲库</span>
              <h2>今天想听哪一首</h2>
            </div>
          </div>
          <div className={styles.songList}>
            {songs.map((song) => (
              <button
                key={song.id}
                className={`${styles.songItem} ${song.id === activeSong.id ? styles.songItemActive : ''}`}
                onClick={() => handleSelectSong(song)}
              >
                <img src={song.cover} alt="" />
                <span>
                  <strong>{song.title}</strong>
                  <small>
                    {song.artist}
                    {song.releaseYear ? ` · ${song.releaseYear}` : ''}
                  </small>
                  <small className={styles.songSubline}>{song.popularityLabel ?? getLyricQualityLabel(song)}</small>
                </span>
                <em>{song.lyricLines.length > 0 ? `${song.lyricLines.length} 句` : '获取'}</em>
              </button>
            ))}
          </div>
        </aside>

        <div className={styles.playerColumn}>
          <article className={`${styles.nowPlaying} glassCard`}>
            <div className={styles.coverWrap}>
              <img src={activeSong.cover} alt={activeSong.title} />
              <div className={styles.coverBadge}>
                <Music2 size={16} />
                {activeSong.quality === 'trusted' ? '可信歌词' : activeSong.quality === 'draft' ? '待确认' : '需导入歌词'}
              </div>
            </div>

            <div className={styles.playArea}>
              <div className={styles.songMeta}>
                <span className="chip badgePink">{activeSong.theme}</span>
                <h2>{activeSong.title}</h2>
                <p>{activeSong.artist}</p>
              </div>

              <div className={styles.currentLyric}>
                <span>{activeLine ? getSectionLabel(activeLine.section) : '歌词'}</span>
                <strong>{activeLine?.ja ?? '导入双语歌词后开始学习'}</strong>
                {analysis ? renderTokenRail(analysis.tokens, beginnerMode) : null}
                {showKana && activeLine ? <small>{activeLine.kana}</small> : null}
                {showRomaji && activeLine ? <small>{activeLine.romaji}</small> : null}
                {showZh && activeLine ? <p>{activeLine.zh}</p> : null}
                <div className={styles.lineProgress}>
                  <div style={{ width: `${lineProgressRatio * 100}%` }} />
                </div>
              </div>

              {activeSong.sourceUrl ? (
                <audio
                  ref={audioRef}
                  src={activeSong.sourceUrl}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                />
              ) : null}

              <div className={styles.playerControls}>
                <button className="softButton primaryButton" onClick={handlePlayPause}>
                  {playing ? <Pause size={18} /> : <Play size={18} />}
                {activeSong.sourceUrl ? (playing ? '暂停' : '播放') : '听当前句'}
                </button>
                <button
                  className={`softButton ${lineLoop ? 'secondaryButton' : ''}`}
                  onClick={() => setLineLoop((value) => !value)}
                >
                  <Repeat1 size={18} />
                  单句循环
                </button>
                <button className="softButton" onClick={() => activeLine && speakJapanese(activeLine.ja)}>
                  <Volume2 size={18} />
                  发音
                </button>
                <button className="softButton" onClick={() => void handleAddReview()}>
                  <LibraryBig size={18} />
                  加入复习
                </button>
              </div>

              <div className={styles.rateGroup} aria-label="播放速度">
                <Gauge size={16} />
                {playbackRates.map((rate) => (
                  <button
                    key={rate}
                    className={playbackRate === rate ? styles.rateActive : ''}
                    onClick={() => setPlaybackRate(rate)}
                  >
                    {rate}x
                  </button>
                ))}
              </div>

              <div className={styles.sourceRow}>
                <span>{getLyricQualityLabel(activeSong)}</span>
                {activeSong.sourceUrl ? <span>Apple 预览音频</span> : <span>逐句发音模式</span>}
                {activeSong.sourcePageUrl ? (
                  <a href={activeSong.sourcePageUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} />
                    打开歌曲
                  </a>
                ) : null}
              </div>

              <div className={styles.progressStrip}>
                <span>{formatTime(currentMs)}</span>
                <div>
                  <span style={{ width: `${progressRatio * 100}%` }} />
                </div>
                <span>{formatTime(durationMs)}</span>
              </div>
            </div>
          </article>

          <section className={`${styles.lyricsPanel} glassCard`}>
            <div className={styles.panelHeader}>
              <div>
                <span className="chip badgeMint">歌词时间轴</span>
                <h2>逐句精听</h2>
              </div>
              <div className={styles.toggleGroup}>
                <button className={showKana ? styles.toggleActive : ''} onClick={() => setShowKana((value) => !value)}>
                  <Languages size={16} />
                  假名
                </button>
                <button className={showRomaji ? styles.toggleActive : ''} onClick={() => setShowRomaji((value) => !value)}>
                  <Mic2 size={16} />
                  罗马音
                </button>
                <button className={showZh ? styles.toggleActive : ''} onClick={() => setShowZh((value) => !value)}>
                  <Captions size={16} />
                  中文
                </button>
                <button className={beginnerMode ? styles.toggleActive : ''} onClick={() => setBeginnerMode((value) => !value)}>
                  <Sparkles size={16} />
                  新手高亮
                </button>
              </div>
            </div>

            <div className={styles.lyricList}>
              {loadingSongId === activeSong.id ? (
                <div className={styles.loadingLyrics}>
                  <RefreshCw size={22} />
                  <strong>正在准备同步歌词和学习解析</strong>
                  <span>会先匹配热门歌曲，再生成中文和单词/语法提示。</span>
                </div>
              ) : null}
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
                    <span className={styles.lyricTime}>{formatTime(line.startMs)}</span>
                    <span className={styles.lyricMain}>
                      <strong>{line.ja}</strong>
                      <small>{line.zh}</small>
                      {active && analysis ? renderTokenRail(analysis.tokens, beginnerMode) : null}
                    </span>
                    <Play size={16} />
                  </button>
                )
              })}
              {activeSong.lyricLines.length === 0 && loadingSongId !== activeSong.id ? (
                <div className={styles.emptyLyrics}>
                  {loadError ? <AlertCircle size={24} /> : <Headphones size={24} />}
                  <strong>{loadError || '等待双语歌词'}</strong>
                  <span>可以点击重新获取，或上传 LRC/SRT/VTT。LRC 每行可写成：[00:12.00]日本語|中文翻译</span>
                  {activeSong.sourceType === 'catalog' ? (
                    <button className="softButton secondaryButton" onClick={() => void hydrateSongAssets(activeSong)}>
                      <RefreshCw size={18} />
                      重新获取同步歌词
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <aside className={styles.studyPanel}>
          <section className={`${styles.studyCard} glassCard`}>
            <div className={styles.panelHeader}>
              <div>
                <span className="chip badgePeach">句子解析</span>
                <h2>{analyzing ? '解析中' : '当前句'}</h2>
              </div>
              <Sparkles size={20} />
            </div>

            {analysis ? (
              <>
                <div className={styles.analysisBlock}>
                  <small>学习向提示</small>
                  <p>{analysis.glossZh}</p>
                </div>
                <div className={styles.tokenGrid}>
                  {analysis.tokens.slice(0, 8).map((token) => (
                    <article
                      key={token.id}
                      className={beginnerMode && isBeginnerToken(token) ? styles.beginnerTokenCard : ''}
                    >
                      <strong>{token.surface}</strong>
                      <span>{token.kana}</span>
                      <small>{resolveTokenMeaning(token)}</small>
                    </article>
                  ))}
                </div>
                {analysis.grammarMatches.length > 0 ? (
                  <div className={styles.grammarHints}>
                    {analysis.grammarMatches.slice(0, 3).map((grammar) => (
                      <article key={grammar.id}>
                        <strong>{grammar.pattern}</strong>
                        <span>{grammar.meaningZh}</span>
                      </article>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="sectionIntro">选中一句歌词后会显示拆解结果。</p>
            )}
          </section>

          <section className={`${styles.studyCard} glassCard`}>
            <div className={styles.panelHeader}>
              <div>
                <span className="chip badgePink">本首进度</span>
                <h2>{learnedLineCount}/{totalLineCount} 句</h2>
              </div>
              <Gauge size={20} />
            </div>
            <div className={styles.songProgress}>
              <div style={{ width: `${totalLineCount ? (learnedLineCount / totalLineCount) * 100 : 0}%` }} />
            </div>
            <div className={styles.quickStats}>
              <article>
                <small>难度</small>
                <strong>{activeSong.difficulty}</strong>
              </article>
              <article>
                <small>知识点</small>
                <strong>{activeSong.knowledgePoints.length}</strong>
              </article>
            </div>
          </section>

          <section className={`${styles.studyCard} glassCard`}>
            <div className={styles.panelHeader}>
              <div>
                <span className="chip badgeMint">表达</span>
                <h2>这句可记</h2>
              </div>
              <BookOpenText size={20} />
            </div>
            <div className={styles.knowledgeList}>
              {(activeKnowledge.length > 0 ? activeKnowledge : activeSong.knowledgePoints.slice(0, 2)).map((point) => (
                <article key={point.id}>
                  <strong>{point.expression}</strong>
                  <span>{point.meaningZh}</span>
                  <p>{point.explanationZh}</p>
                </article>
              ))}
              {activeSong.knowledgePoints.length === 0 ? (
                <p className="sectionIntro">导入歌曲的表达会先通过句子解析辅助学习。</p>
              ) : null}
            </div>
          </section>
        </aside>
      </section>
    </div>
  )
}
