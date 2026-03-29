import { getTodayKey } from './date'
import type { DailyGoal, ReviewItem, StudyEvent, TodayProgress, VideoLesson } from '../types'

export function getTodayProgress(events: StudyEvent[], date = getTodayKey()): TodayProgress {
  return events
    .filter((event) => event.date === date)
    .reduce<TodayProgress>(
      (acc, event) => {
        if (event.type === 'video') acc.video += event.count
        if (event.type === 'word') acc.word += event.count
        if (event.type === 'grammar') acc.grammar += event.count
        if (event.type === 'review') acc.review += event.count
        return acc
      },
      { video: 0, word: 0, grammar: 0, review: 0 },
    )
}

export function getGoalCompletionRatio(progress: TodayProgress, goal: DailyGoal) {
  const target = goal.videosTarget + goal.wordsTarget + goal.grammarTarget + goal.reviewTarget
  if (target === 0) {
    return 0
  }

  const current =
    Math.min(progress.video, goal.videosTarget) +
    Math.min(progress.word, goal.wordsTarget) +
    Math.min(progress.grammar, goal.grammarTarget) +
    Math.min(progress.review, goal.reviewTarget)

  return current / target
}

export function getCompletedDateSet(events: StudyEvent[], goal: DailyGoal) {
  const dateMap = new Map<string, TodayProgress>()

  for (const event of events) {
    const current = dateMap.get(event.date) ?? {
      video: 0,
      word: 0,
      grammar: 0,
      review: 0,
    }

    if (event.type === 'video') current.video += event.count
    if (event.type === 'word') current.word += event.count
    if (event.type === 'grammar') current.grammar += event.count
    if (event.type === 'review') current.review += event.count
    dateMap.set(event.date, current)
  }

  const completed = new Set<string>()
  for (const [date, progress] of dateMap.entries()) {
    if (getGoalCompletionRatio(progress, goal) >= 1) {
      completed.add(date)
    }
  }
  return completed
}

export function getDueReviewItems(items: ReviewItem[], now = new Date()) {
  const current = now.getTime()
  return items
    .filter((item) => new Date(item.nextReviewAt).getTime() <= current)
    .sort((a, b) => new Date(a.nextReviewAt).getTime() - new Date(b.nextReviewAt).getTime())
}

export function getUpcomingReviewItems(items: ReviewItem[], now = new Date()) {
  const current = now.getTime()
  return items
    .filter((item) => new Date(item.nextReviewAt).getTime() > current)
    .sort((a, b) => new Date(a.nextReviewAt).getTime() - new Date(b.nextReviewAt).getTime())
}

export function getDailyLessonFeed(
  lessons: VideoLesson[],
  favoriteIds: string[],
  studyEvents: StudyEvent[],
  date = getTodayKey(),
) {
  const watchedToday = new Set(
    studyEvents
      .filter((event) => event.type === 'video' && event.date === date)
      .map((event) => event.sourceId),
  )
  const favoriteSet = new Set(favoriteIds)

  return [...lessons].sort((a, b) => {
    const aFavorite = favoriteSet.has(a.id) ? -1 : 0
    const bFavorite = favoriteSet.has(b.id) ? -1 : 0
    if (aFavorite !== bFavorite) {
      return aFavorite - bFavorite
    }

    const aWatched = watchedToday.has(a.id) ? 1 : 0
    const bWatched = watchedToday.has(b.id) ? 1 : 0
    if (aWatched !== bWatched) {
      return aWatched - bWatched
    }

    return a.title.localeCompare(b.title, 'zh-Hans-CN')
  })
}
