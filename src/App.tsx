import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { Analytics } from '@vercel/analytics/react'
import { Toaster } from 'sonner'

import { AppShell } from './components/AppShell'

const LearnPage = lazy(async () => ({ default: (await import('./pages/LearnPage')).LearnPage }))
const CourseLessonPage = lazy(async () => ({ default: (await import('./pages/CourseLessonPage')).CourseLessonPage }))
const CourseReviewPage = lazy(async () => ({ default: (await import('./pages/CourseReviewPage')).CourseReviewPage }))
const HomePage = lazy(async () => ({ default: (await import('./pages/HomePage')).HomePage }))
const ImmersivePage = lazy(async () => ({ default: (await import('./pages/ImmersivePage')).ImmersivePage }))
const LiteracyPage = lazy(async () => ({ default: (await import('./pages/LiteracyPage')).LiteracyPage }))
const NotesPage = lazy(async () => ({ default: (await import('./pages/NotesPage')).NotesPage }))
const ProfilePage = lazy(async () => ({ default: (await import('./pages/ProfilePage')).ProfilePage }))
const ReviewPage = lazy(async () => ({ default: (await import('./pages/ReviewPage')).ReviewPage }))
const SongsPage = lazy(async () => ({ default: (await import('./pages/SongsPage')).SongsPage }))
const VocabPage = lazy(async () => ({ default: (await import('./pages/VocabPage')).VocabPage }))

function App() {
  return (
    <>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<PageLoader><LearnPage /></PageLoader>} />
          <Route path="/learn/review" element={<PageLoader><CourseReviewPage /></PageLoader>} />
          <Route path="/learn/:lessonId" element={<PageLoader><CourseLessonPage /></PageLoader>} />
          <Route path="/discover" element={<PageLoader><HomePage /></PageLoader>} />
          <Route path="/immersive" element={<PageLoader><ImmersivePage /></PageLoader>} />
          <Route path="/literacy" element={<PageLoader><LiteracyPage /></PageLoader>} />
          <Route path="/songs" element={<PageLoader><SongsPage /></PageLoader>} />
          <Route path="/notes" element={<PageLoader><NotesPage /></PageLoader>} />
          <Route path="/review" element={<PageLoader><ReviewPage /></PageLoader>} />
          <Route path="/vocab" element={<PageLoader><VocabPage /></PageLoader>} />
          <Route path="/profile" element={<PageLoader><ProfilePage /></PageLoader>} />
        </Route>
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
      <Toaster position="top-center" richColors closeButton />
      <Analytics />
    </>
  )
}

function PageLoader({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="glassCard">正在打开学习内容…</div>}>{children}</Suspense>
}

export default App
