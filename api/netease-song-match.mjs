const SEARCH_URL = 'https://music.163.com/api/search/get'
const DETAIL_URL = 'https://music.163.com/api/song/detail/'
const LYRIC_URL = 'https://music.163.com/api/song/lyric'

const NETEASE_HEADERS = {
  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
  referer: 'https://music.163.com/',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function readBody(req) {
  if (typeof req.body === 'string' && req.body) {
    return JSON.parse(req.body)
  }

  return req.body ?? {}
}

function readString(value, maxLength = 160) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function normalizeText(value) {
  return readString(value, 240)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[（(【\[].*?[）)\]】]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function splitTokens(value) {
  return normalizeText(value).split(/\s+/).filter(Boolean)
}

function scoreTextMatch(candidate, target) {
  const normalizedCandidate = normalizeText(candidate)
  const normalizedTarget = normalizeText(target)
  if (!normalizedCandidate || !normalizedTarget) {
    return 0
  }

  if (normalizedCandidate === normalizedTarget) {
    return 80
  }

  if (normalizedCandidate.includes(normalizedTarget)) {
    return 58
  }

  if (normalizedTarget.includes(normalizedCandidate)) {
    return 48
  }

  const targetTokens = splitTokens(normalizedTarget)
  if (targetTokens.length === 0) {
    return 0
  }

  const matchedCount = targetTokens.filter((token) => normalizedCandidate.includes(token)).length
  return Math.round((matchedCount / targetTokens.length) * 36)
}

function getArtistNames(song) {
  return Array.isArray(song?.artists)
    ? song.artists.map((artist) => readString(artist?.name, 80)).filter(Boolean)
    : []
}

function scoreSong(song, request) {
  const titleCandidates = [
    song?.name,
    ...(Array.isArray(song?.alias) ? song.alias : []),
    ...(Array.isArray(song?.transNames) ? song.transNames : []),
  ]
  const titleScore = Math.max(...titleCandidates.map((value) => scoreTextMatch(value, request.title)), 0)
  const artistText = getArtistNames(song).join(' ')
  const artistScore = request.artist ? scoreTextMatch(artistText, request.artist) : 0
  const durationMs = Number(song?.duration ?? 0)
  const durationGap = Math.abs(durationMs - request.durationMs)
  const durationScore =
    request.durationMs > 0 && durationMs > 0
      ? durationGap <= 2500
        ? 28
        : durationGap <= 8000
          ? 18
          : durationGap <= 18000
            ? 8
            : -12
      : 0

  return titleScore + artistScore + durationScore
}

async function fetchJson(url, options = {}) {
  const headers = {
    ...NETEASE_HEADERS,
    ...(options.headers ?? {}),
  }
  for (const key of Object.keys(headers)) {
    if (headers[key] === undefined) {
      delete headers[key]
    }
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Netease request failed with status ${response.status}.`)
  }

  return JSON.parse(text)
}

async function searchSongs(keyword) {
  const payload = new URLSearchParams({
    s: keyword,
    type: '1',
    limit: '12',
    offset: '0',
  })
  const body = await fetchJson(SEARCH_URL, {
    method: 'POST',
    body: payload,
  })

  return Array.isArray(body?.result?.songs) ? body.result.songs : []
}

async function fetchSongDetails(ids) {
  if (ids.length === 0) {
    return new Map()
  }

  const detailUrl = `${DETAIL_URL}?id=${encodeURIComponent(ids[0])}&ids=${encodeURIComponent(JSON.stringify(ids))}`
  const body = await fetchJson(detailUrl, {
    method: 'GET',
    headers: {
      'content-type': undefined,
    },
  })
  const map = new Map()
  for (const song of Array.isArray(body?.songs) ? body.songs : []) {
    map.set(String(song.id), song)
  }

  return map
}

async function fetchLyrics(id) {
  const url = `${LYRIC_URL}?os=pc&id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`
  const body = await fetchJson(url, {
    method: 'GET',
    headers: {
      'content-type': undefined,
    },
  })

  return {
    lrc: readString(body?.lrc?.lyric, 500_000),
    tlyric: readString(body?.tlyric?.lyric, 500_000),
    romalrc: readString(body?.romalrc?.lyric, 500_000),
  }
}

function buildCoverUrl(song, detail) {
  const raw =
    detail?.album?.picUrl ||
    detail?.album?.blurPicUrl ||
    detail?.al?.picUrl ||
    song?.album?.picUrl ||
    song?.album?.blurPicUrl ||
    ''
  return raw ? `${String(raw).replace(/^http:\/\//, 'https://')}?param=600y600` : ''
}

function toMatchRecord(song, detail, lyrics, score) {
  const detailSong = detail ?? {}
  const album = detailSong.album ?? detailSong.al ?? song.album ?? {}
  const artists = getArtistNames(song).length > 0
    ? getArtistNames(song)
    : Array.isArray(detailSong.artists)
      ? detailSong.artists.map((artist) => readString(artist?.name, 80)).filter(Boolean)
      : Array.isArray(detailSong.ar)
        ? detailSong.ar.map((artist) => readString(artist?.name, 80)).filter(Boolean)
        : []

  return {
    id: String(song.id),
    title: readString(detailSong.name || song.name, 160),
    artist: artists.join(', '),
    album: readString(album.name, 160),
    durationMs: Math.max(0, Math.round(Number(detailSong.duration ?? detailSong.dt ?? song.duration ?? 0))),
    cover: buildCoverUrl(song, detailSong),
    score,
    lrc: lyrics.lrc,
    tlyric: lyrics.tlyric,
    romalrc: lyrics.romalrc,
  }
}

async function findBestMatch(request) {
  const searchTerms = [
    `${request.title} ${request.artist}`.trim(),
    request.title,
  ].filter(Boolean)
  const candidates = []

  for (const term of [...new Set(searchTerms)]) {
    const songs = await searchSongs(term)
    candidates.push(...songs)
    if (candidates.length > 0) {
      break
    }
  }

  const uniqueSongs = [...new Map(candidates.map((song) => [String(song.id), song])).values()]
  const scoredSongs = uniqueSongs
    .map((song) => ({ song, score: scoreSong(song, request) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 6)

  const detailMap = await fetchSongDetails(scoredSongs.map((item) => item.song.id))

  for (const item of scoredSongs) {
    const lyrics = await fetchLyrics(item.song.id)
    if (lyrics.lrc.trim()) {
      return toMatchRecord(item.song, detailMap.get(String(item.song.id)), lyrics, item.score + 16)
    }
  }

  const fallback = scoredSongs[0]
  if (!fallback) {
    return null
  }

  return toMatchRecord(
    fallback.song,
    detailMap.get(String(fallback.song.id)),
    { lrc: '', tlyric: '', romalrc: '' },
    fallback.score,
  )
}

export default async function handler(req, res) {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const body = readBody(req)
    const request = {
      title: readString(body.title, 180),
      artist: readString(body.artist, 180),
      durationMs: Math.max(0, Math.round(Number(body.durationMs ?? 0))),
    }

    if (!request.title) {
      res.status(400).json({ error: 'Missing song title.' })
      return
    }

    const match = await findBestMatch(request)
    if (!match) {
      res.status(404).json({ error: 'No matching song found.' })
      return
    }

    res.status(200).json({
      provider: 'netease',
      match,
    })
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Netease song matching failed.',
    })
  }
}
