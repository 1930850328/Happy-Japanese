import { openDB } from 'idb'

import type {
  AppSettings,
  DailyGoal,
  ImportedClip,
  ReviewItem,
  ReviewLog,
  SavedNote,
  StudyEvent,
  VocabProgress,
} from '../types'

const DB_NAME = 'yuru-nihongo-db'
const DB_VERSION = 1
const PROFILE_STORAGE_KEY = 'yuru-nihongo-cloud-profile-id'
const STATE_ENDPOINT = '/api/app-state'

type StoreName =
  | 'favorites'
  | 'notes'
  | 'goals'
  | 'study_events'
  | 'review_items'
  | 'review_logs'
  | 'vocab_progress'
  | 'imported_clips'
  | 'app_settings'

export interface FavoriteRecord {
  id: string
  createdAt: string
}

interface RemoteAppState {
  version: 1
  profileId: string
  updatedAt: string
  favorites: FavoriteRecord[]
  notes: SavedNote[]
  goal?: DailyGoal
  studyEvents: StudyEvent[]
  reviewItems: ReviewItem[]
  reviewLogs: ReviewLog[]
  vocabProgress: VocabProgress[]
  importedClips: ImportedClip[]
  settings?: AppSettings
}

let cachedState: RemoteAppState | null = null
let loadTask: Promise<RemoteAppState> | null = null
let writeTask: Promise<void> = Promise.resolve()

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function sanitizeProfileId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 64)
}

function getProfileId() {
  if (!isBrowser()) {
    return 'server'
  }

  const current = sanitizeProfileId(window.localStorage.getItem(PROFILE_STORAGE_KEY) || '')
  if (current) {
    return current
  }

  const next = sanitizeProfileId(crypto.randomUUID())
  window.localStorage.setItem(PROFILE_STORAGE_KEY, next)
  return next
}

function createEmptyState(profileId: string): RemoteAppState {
  return {
    version: 1,
    profileId,
    updatedAt: new Date().toISOString(),
    favorites: [],
    notes: [],
    studyEvents: [],
    reviewItems: [],
    reviewLogs: [],
    vocabProgress: [],
    importedClips: [],
  }
}

function sanitizeImportedClip(clip: ImportedClip): ImportedClip {
  const next = { ...clip }
  delete next.blob
  return next
}

function sanitizeState(state: RemoteAppState): RemoteAppState {
  return {
    ...state,
    favorites: [...state.favorites],
    notes: [...state.notes],
    studyEvents: [...state.studyEvents],
    reviewItems: [...state.reviewItems],
    reviewLogs: [...state.reviewLogs],
    vocabProgress: [...state.vocabProgress],
    importedClips: state.importedClips.map(sanitizeImportedClip),
  }
}

function cloneState(state: RemoteAppState): RemoteAppState {
  return JSON.parse(JSON.stringify(sanitizeState(state))) as RemoteAppState
}

function hasAnyLegacyData(state: Omit<RemoteAppState, 'version' | 'profileId' | 'updatedAt'> & {
  goal?: DailyGoal
  settings?: AppSettings
}) {
  return Boolean(
    state.favorites.length ||
      state.notes.length ||
      state.studyEvents.length ||
      state.reviewItems.length ||
      state.reviewLogs.length ||
      state.vocabProgress.length ||
      state.importedClips.length ||
      state.goal ||
      state.settings,
  )
}

async function getLegacyDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const stores: Array<[StoreName, string]> = [
        ['favorites', 'id'],
        ['notes', 'id'],
        ['goals', 'id'],
        ['study_events', 'id'],
        ['review_items', 'id'],
        ['review_logs', 'id'],
        ['vocab_progress', 'id'],
        ['imported_clips', 'id'],
        ['app_settings', 'id'],
      ]

      for (const [name, keyPath] of stores) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath })
        }
      }
    },
  })
}

async function loadLegacyState(profileId: string) {
  if (!isBrowser()) {
    return null
  }

  const db = await getLegacyDb()
  const [favorites, notes, goal, studyEvents, reviewItems, reviewLogs, vocabProgress, importedClips, settings] =
    await Promise.all([
      db.getAll('favorites') as Promise<FavoriteRecord[]>,
      db.getAll('notes') as Promise<SavedNote[]>,
      db.get('goals', 'daily-goals') as Promise<DailyGoal | undefined>,
      db.getAll('study_events') as Promise<StudyEvent[]>,
      db.getAll('review_items') as Promise<ReviewItem[]>,
      db.getAll('review_logs') as Promise<ReviewLog[]>,
      db.getAll('vocab_progress') as Promise<VocabProgress[]>,
      db.getAll('imported_clips') as Promise<ImportedClip[]>,
      db.get('app_settings', 'settings') as Promise<AppSettings | undefined>,
    ])

  const serializableClips = importedClips
    .map(sanitizeImportedClip)
    .filter((clip) => clip.sourceUrl || !clip.sourceIdOrBlobKey.startsWith('blob-'))

  const legacy = {
    favorites,
    notes,
    goal,
    studyEvents,
    reviewItems,
    reviewLogs,
    vocabProgress,
    importedClips: serializableClips,
    settings,
  }

  if (!hasAnyLegacyData(legacy)) {
    return null
  }

  return {
    version: 1 as const,
    profileId,
    updatedAt: new Date().toISOString(),
    ...legacy,
  }
}

async function fetchRemoteState(profileId: string) {
  const response = await fetch(`${STATE_ENDPOINT}?profileId=${encodeURIComponent(profileId)}`, {
    cache: 'no-store',
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || '加载云端学习数据失败。')
  }

  const body = (await response.json()) as { state?: RemoteAppState }
  if (!body.state) {
    return null
  }

  return sanitizeState(body.state)
}

async function persistRemoteState(state: RemoteAppState) {
  const response = await fetch(STATE_ENDPOINT, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      profileId: state.profileId,
      state: sanitizeState(state),
    }),
  })

  if (response.ok) {
    return
  }

  const body = (await response.json().catch(() => null)) as { error?: string } | null
  throw new Error(body?.error || '保存云端学习数据失败。')
}

async function ensureStateLoaded() {
  if (cachedState) {
    return cachedState
  }

  if (loadTask) {
    return loadTask
  }

  loadTask = (async () => {
    const profileId = getProfileId()
    const remote = await fetchRemoteState(profileId)
    if (remote) {
      cachedState = {
        ...createEmptyState(profileId),
        ...remote,
        profileId,
      }
      return cachedState
    }

    const migrated = await loadLegacyState(profileId)
    const initial = migrated ?? createEmptyState(profileId)
    await persistRemoteState(initial)
    cachedState = initial
    return cachedState
  })()

  try {
    return await loadTask
  } finally {
    loadTask = null
  }
}

async function updateState(mutator: (state: RemoteAppState) => void) {
  const current = await ensureStateLoaded()
  const nextState = cloneState(current)
  mutator(nextState)
  nextState.updatedAt = new Date().toISOString()

  const snapshot = cloneState(nextState)
  writeTask = writeTask.catch(() => undefined).then(() => persistRemoteState(snapshot))
  await writeTask
  cachedState = nextState
  return nextState
}

export async function listFavorites() {
  return [...(await ensureStateLoaded()).favorites]
}

export async function saveFavorite(id: string) {
  await updateState((state) => {
    if (state.favorites.some((item) => item.id === id)) {
      return
    }

    state.favorites.push({
      id,
      createdAt: new Date().toISOString(),
    })
  })
}

export async function removeFavorite(id: string) {
  await updateState((state) => {
    state.favorites = state.favorites.filter((item) => item.id !== id)
  })
}

export async function listNotes() {
  return [...(await ensureStateLoaded()).notes]
}

export async function saveNote(note: SavedNote) {
  await updateState((state) => {
    const index = state.notes.findIndex((item) => item.id === note.id)
    if (index >= 0) {
      state.notes[index] = note
      return
    }

    state.notes.unshift(note)
  })
}

export async function deleteNote(id: string) {
  await updateState((state) => {
    state.notes = state.notes.filter((item) => item.id !== id)
  })
}

export async function loadGoal() {
  return (await ensureStateLoaded()).goal
}

export async function saveGoal(goal: DailyGoal) {
  await updateState((state) => {
    state.goal = goal
  })
}

export async function listStudyEvents() {
  return [...(await ensureStateLoaded()).studyEvents]
}

export async function saveStudyEvent(event: StudyEvent) {
  await updateState((state) => {
    const index = state.studyEvents.findIndex((item) => item.id === event.id)
    if (index >= 0) {
      state.studyEvents[index] = event
      return
    }

    state.studyEvents.unshift(event)
  })
}

export async function listReviewItems() {
  return [...(await ensureStateLoaded()).reviewItems]
}

export async function saveReviewItem(item: ReviewItem) {
  await updateState((state) => {
    const index = state.reviewItems.findIndex((entry) => entry.id === item.id)
    if (index >= 0) {
      state.reviewItems[index] = item
      return
    }

    state.reviewItems.unshift(item)
  })
}

export async function saveReviewItems(items: ReviewItem[]) {
  await updateState((state) => {
    const recordMap = new Map(state.reviewItems.map((entry) => [entry.id, entry]))
    for (const item of items) {
      recordMap.set(item.id, item)
    }
    state.reviewItems = [...recordMap.values()]
  })
}

export async function listReviewLogs() {
  return [...(await ensureStateLoaded()).reviewLogs]
}

export async function saveReviewLog(log: ReviewLog) {
  await updateState((state) => {
    const index = state.reviewLogs.findIndex((item) => item.id === log.id)
    if (index >= 0) {
      state.reviewLogs[index] = log
      return
    }

    state.reviewLogs.unshift(log)
  })
}

export async function listVocabProgress() {
  return [...(await ensureStateLoaded()).vocabProgress]
}

export async function saveVocabProgress(progress: VocabProgress) {
  await updateState((state) => {
    const index = state.vocabProgress.findIndex((item) => item.id === progress.id)
    if (index >= 0) {
      state.vocabProgress[index] = progress
      return
    }

    state.vocabProgress.push(progress)
  })
}

export async function listImportedClips() {
  return [...(await ensureStateLoaded()).importedClips]
}

export async function saveImportedClip(clip: ImportedClip) {
  await updateState((state) => {
    const sanitized = sanitizeImportedClip(clip)
    const index = state.importedClips.findIndex((item) => item.id === clip.id)
    if (index >= 0) {
      state.importedClips[index] = sanitized
      return
    }

    state.importedClips.unshift(sanitized)
  })
}

export async function deleteImportedClip(id: string) {
  await updateState((state) => {
    state.importedClips = state.importedClips.filter((item) => item.id !== id)
  })
}

export async function loadSettings() {
  return (await ensureStateLoaded()).settings
}

export async function saveSettings(settings: AppSettings) {
  await updateState((state) => {
    state.settings = settings
  })
}
