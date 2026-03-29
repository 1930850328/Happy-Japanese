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

export async function getDb() {
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

export interface FavoriteRecord {
  id: string
  createdAt: string
}

export async function listFavorites() {
  return (await getDb()).getAll('favorites') as Promise<FavoriteRecord[]>
}

export async function saveFavorite(id: string) {
  return (await getDb()).put('favorites', { id, createdAt: new Date().toISOString() })
}

export async function removeFavorite(id: string) {
  return (await getDb()).delete('favorites', id)
}

export async function listNotes() {
  return (await getDb()).getAll('notes') as Promise<SavedNote[]>
}

export async function saveNote(note: SavedNote) {
  return (await getDb()).put('notes', note)
}

export async function deleteNote(id: string) {
  return (await getDb()).delete('notes', id)
}

export async function loadGoal() {
  return (await getDb()).get('goals', 'daily-goals') as Promise<DailyGoal | undefined>
}

export async function saveGoal(goal: DailyGoal) {
  return (await getDb()).put('goals', goal)
}

export async function listStudyEvents() {
  return (await getDb()).getAll('study_events') as Promise<StudyEvent[]>
}

export async function saveStudyEvent(event: StudyEvent) {
  return (await getDb()).put('study_events', event)
}

export async function listReviewItems() {
  return (await getDb()).getAll('review_items') as Promise<ReviewItem[]>
}

export async function saveReviewItem(item: ReviewItem) {
  return (await getDb()).put('review_items', item)
}

export async function saveReviewItems(items: ReviewItem[]) {
  const db = await getDb()
  const tx = db.transaction('review_items', 'readwrite')
  for (const item of items) {
    tx.store.put(item)
  }
  await tx.done
}

export async function listReviewLogs() {
  return (await getDb()).getAll('review_logs') as Promise<ReviewLog[]>
}

export async function saveReviewLog(log: ReviewLog) {
  return (await getDb()).put('review_logs', log)
}

export async function listVocabProgress() {
  return (await getDb()).getAll('vocab_progress') as Promise<VocabProgress[]>
}

export async function saveVocabProgress(progress: VocabProgress) {
  return (await getDb()).put('vocab_progress', progress)
}

export async function listImportedClips() {
  return (await getDb()).getAll('imported_clips') as Promise<ImportedClip[]>
}

export async function saveImportedClip(clip: ImportedClip) {
  return (await getDb()).put('imported_clips', clip)
}

export async function loadSettings() {
  return (await getDb()).get('app_settings', 'settings') as Promise<AppSettings | undefined>
}

export async function saveSettings(settings: AppSettings) {
  return (await getDb()).put('app_settings', settings)
}
