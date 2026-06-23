import { openDB } from 'idb'

import type { LyricLine } from '../types'

const DB_NAME = 'yuru-nihongo-song-assets'
const DB_VERSION = 1
const SONG_STORE_NAME = 'songs'
const LOCAL_SONG_ID_PREFIX = 'local-song:'

export interface StoredSongAsset {
  id: string
  title: string
  artist: string
  cover: string
  audioBlob: Blob
  audioFileName: string
  audioFileType: string
  audioSize: number
  durationMs: number
  lyricFileName?: string
  lyricText?: string
  lyricLines: LyricLine[]
  importedAt: string
  updatedAt: string
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
}

async function getSongAssetDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(SONG_STORE_NAME)) {
        db.createObjectStore(SONG_STORE_NAME, { keyPath: 'id' })
      }
    },
  })
}

export function createLocalSongAssetId() {
  return `${LOCAL_SONG_ID_PREFIX}${crypto.randomUUID()}`
}

export function isLocalSongAssetId(value: string | undefined) {
  return Boolean(value?.startsWith(LOCAL_SONG_ID_PREFIX))
}

export async function listStoredSongAssets() {
  if (!isBrowser()) {
    return []
  }

  const db = await getSongAssetDb()
  const assets = await db.getAll(SONG_STORE_NAME) as StoredSongAsset[]
  return assets.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

export async function saveStoredSongAsset(asset: StoredSongAsset) {
  if (!isBrowser()) {
    return
  }

  const db = await getSongAssetDb()
  await db.put(SONG_STORE_NAME, asset)
}

export async function deleteStoredSongAsset(id: string) {
  if (!isBrowser()) {
    return
  }

  const db = await getSongAssetDb()
  await db.delete(SONG_STORE_NAME, id)
}
