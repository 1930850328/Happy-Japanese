import { useState, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { Link } from 'react-router-dom'
import styles from '../../pages/ReadingCourse.module.css'

function RecallTable({ children }: ComponentPropsWithoutRef<'table'>) {
  const [hidden, setHidden] = useState(false)
  return <div className={styles.tableBlock}>
    <button className={styles.textButton} onClick={() => setHidden(!hidden)} aria-pressed={hidden}>
      {hidden ? '显示右栏，核对答案' : '遮住右栏，试着回想'}
    </button>
    <div className={styles.tableScroll}><table className={hidden ? styles.hideAnswers : ''}>{children}</table></div>
  </div>
}

export function LessonMarkdown({ children }: { children: string }) {
  return <div className={styles.prose}><ReactMarkdown
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[rehypeRaw]}
    allowedElements={['p', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'details', 'summary', 'h3', 'h4', 'hr', 'br']}
    components={{
      table: ({ children }) => <RecallTable>{children}</RecallTable>,
      a: ({ href, children }) => {
        if (href?.includes('RECALL.md')) return <a href="#daily-review">{children}</a>
        const lesson = href?.match(/(?:lessons\/)?(\d{2})\.md/)
        if (lesson) return <Link to={`/course/${Number(lesson[1])}`}>{children}</Link>
        if (href?.startsWith('https://')) return <a href={href} target="_blank" rel="noreferrer">{children}</a>
        return <span>{children}</span>
      },
    }}
  >{children}</ReactMarkdown></div>
}
