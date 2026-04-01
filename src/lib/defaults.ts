import { getTodayKey } from './date'
import type { AppSettings, DailyGoal } from '../types'

export const defaultGoal: DailyGoal = {
  id: 'daily-goals',
  videosTarget: 2,
  wordsTarget: 5,
  grammarTarget: 1,
  reviewTarget: 4,
  updatedAt: getTodayKey(),
}

export const defaultSettings: AppSettings = {
  id: 'settings',
  remindersEnabled: false,
  showRomaji: true,
  showPlaybackKnowledge: false,
  showJapaneseSubtitle: true,
  showChineseSubtitle: true,
  accentMode: 'macaron',
}
