import dayjs from 'dayjs'

import type { CalendarCell, DailyGoal, StudyEvent, TodayProgress } from '../types'

export const DAY_MS = 24 * 60 * 60 * 1000

export function getTodayKey(date = new Date()) {
  return dayjs(date).format('YYYY-MM-DD')
}

export function toDateKey(input: string | Date) {
  return dayjs(input).format('YYYY-MM-DD')
}

export function formatDateLabel(input: string | Date) {
  return dayjs(input).format('MM月DD日')
}

export function formatDateTime(input: string | Date) {
  return dayjs(input).format('YYYY/MM/DD HH:mm')
}

export function addDays(input: string | Date, days: number) {
  return dayjs(input).add(days, 'day').toISOString()
}

export function getMonthCalendar(
  completedMap: Map<string, number>,
  goal: DailyGoal,
  month = new Date(),
): CalendarCell[] {
  const start = dayjs(month).startOf('month').startOf('week')
  const end = dayjs(month).endOf('month').endOf('week')
  const cells: CalendarCell[] = []
  const totalGoal =
    goal.videosTarget + goal.wordsTarget + goal.grammarTarget + goal.reviewTarget

  for (
    let cursor = start;
    cursor.isBefore(end) || cursor.isSame(end, 'day');
    cursor = cursor.add(1, 'day')
  ) {
    const key = cursor.format('YYYY-MM-DD')
    const score = completedMap.get(key) ?? 0
    const ratio = totalGoal > 0 ? Math.min(score / totalGoal, 1) : 0
    cells.push({
      key,
      date: cursor.toDate(),
      inCurrentMonth: cursor.month() === dayjs(month).month(),
      completed: ratio >= 1,
      ratio,
    })
  }

  return cells
}

export function groupProgressByDate(events: StudyEvent[], goal: DailyGoal) {
  const progressMap = new Map<string, TodayProgress>()

  for (const event of events) {
    const current = progressMap.get(event.date) ?? {
      video: 0,
      word: 0,
      grammar: 0,
      review: 0,
    }

    if (event.type === 'video') current.video += event.count
    if (event.type === 'word') current.word += event.count
    if (event.type === 'grammar') current.grammar += event.count
    if (event.type === 'review') current.review += event.count
    progressMap.set(event.date, current)
  }

  const scoreMap = new Map<string, number>()

  for (const [date, progress] of progressMap.entries()) {
    const score =
      Math.min(progress.video, goal.videosTarget) +
      Math.min(progress.word, goal.wordsTarget) +
      Math.min(progress.grammar, goal.grammarTarget) +
      Math.min(progress.review, goal.reviewTarget)

    scoreMap.set(date, score)
  }

  return scoreMap
}

export function countStreak(completedDates: Set<string>, from = new Date()) {
  let cursor = dayjs(from)
  let streak = 0

  while (completedDates.has(cursor.format('YYYY-MM-DD'))) {
    streak += 1
    cursor = cursor.subtract(1, 'day')
  }

  return streak
}
