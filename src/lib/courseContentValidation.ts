import type { CourseLearningDimension, CourseLesson } from '../types'

function questionDimension(question: CourseLesson['questions'][number]): CourseLearningDimension {
  if (question.dimension) return question.dimension
  if (question.kind === 'usage') return 'production'
  if (question.kind === 'comprehension') return 'transfer'
  return 'recognition'
}

export function validateCourseContent(lessons: CourseLesson[]) {
  const errors: string[] = []
  const questionIds = new Set<string>()

  for (const lesson of lessons) {
    for (const question of lesson.questions) {
      if (questionIds.has(question.id)) errors.push(`题目 ID 重复：${question.id}`)
      questionIds.add(question.id)
    }

    if (!lesson.requiredDimensions?.length) continue

    const coveredDimensions = new Set(lesson.questions.map(questionDimension))
    for (const dimension of lesson.requiredDimensions) {
      if (!coveredDimensions.has(dimension)) {
        errors.push(`${lesson.id} 缺少 ${dimension} 维度练习`)
      }
    }

    const listeningQuestions = lesson.questions.filter((item) => questionDimension(item) === 'listening')
    if (listeningQuestions.some((item) => !item.audioText || item.interaction !== 'listening_choice')) {
      errors.push(`${lesson.id} 的听辨题必须提供声音并使用听音选择交互`)
    }

    const constructedQuestions = lesson.questions.filter((item) =>
      item.dimension === 'recall' || item.dimension === 'production' || item.dimension === 'transfer',
    )
    if (constructedQuestions.some((item) => item.interaction !== 'input' || !item.acceptableAnswers?.length)) {
      errors.push(`${lesson.id} 的回忆、输出和迁移题必须由学习者主动输入`)
    }

    if (!lesson.questions.some((item) => item.confusionGroup)) {
      errors.push(`${lesson.id} 缺少基于真实易混项的辨析练习`)
    }
  }

  return errors
}

export function assertCourseContentQuality(lessons: CourseLesson[]) {
  const errors = validateCourseContent(lessons)
  if (errors.length > 0) {
    throw new Error(`课程内容质量校验失败：\n${errors.join('\n')}`)
  }
}
