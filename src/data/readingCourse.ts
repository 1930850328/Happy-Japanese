import inventory from '../../learning-materials/02-course-design/inventory.json'

const sources = import.meta.glob<string>(
  '../../learning-materials/02-course-design/lessons/*.md',
  { query: '?raw', import: 'default', eager: true },
)

export const readingCourseVersion = 'reading-v4' as const

// Only the authored lesson body is published. Research files and test originals stay out of the app.
export const readingCourse = Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)).map(([path, source]) => {
  const day = Number(path.match(/(\d+)\.md$/)?.[1])
  const [preamble, ...parts] = source.trim().split(/^## /m)
  const title = preamble.split('\n')[0].replace(/^# 第 \d+ 天：/, '')
  const intro = preamble.split('\n\n').slice(1)
    .filter((paragraph) => !paragraph.startsWith('先修：'))
    .join('\n\n')
  const sections = [
    { title: '开始今天的学习', body: intro },
    ...parts.map((part) => {
      const newline = part.indexOf('\n')
      return { title: part.slice(0, newline).replace(/^\d+\.\s*/, ''), body: part.slice(newline + 1).trim() }
    }),
  ]
  return {
    day, title, sections,
    words: inventory.words.filter((word) => word.first_day === day),
    review: inventory.words.filter((word) => word.recall_days.includes(day)),
  }
})

if (readingCourse.length !== 21 || readingCourse.some((lesson, i) => lesson.day !== i + 1 || lesson.sections.length < 2)) {
  throw new Error('21天课程文件缺失或顺序错误')
}

export const readingStages = [
  { from: 1, to: 3, title: '认得出', subtitle: '从假名到词形', description: '建立字形与读法的联系，把眼前的字符认成词。', mark: 'あ' },
  { from: 4, to: 10, title: '连成意思', subtitle: '读懂一句话', description: '认出谁做了什么，分清时间、状态和句子的关系。', mark: '文' },
  { from: 11, to: 19, title: '读得更完整', subtitle: '理解常见表达', description: '从请求和条件，到对话与通知，逐步读出完整信息。', mark: '読' },
  { from: 20, to: 21, title: '自己读一遍', subtitle: '连续阅读与自查', description: '用留言、通知和短篇练习，把学过的知识连起来。', mark: '本' },
]
