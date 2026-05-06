import { Navigate, Route, Routes } from 'react-router-dom'

import { Analytics } from '@vercel/analytics/react'
import { Toaster } from 'sonner'

import { AppShell } from './components/AppShell'
import { HomePage } from './pages/HomePage'
import { ImmersivePage } from './pages/ImmersivePage'
import { NotesPage } from './pages/NotesPage'
import { ProfilePage } from './pages/ProfilePage'
import { ReviewPage } from './pages/ReviewPage'
import { VocabPage } from './pages/VocabPage'

function App() {
  return (
    <>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="/immersive" element={<ImmersivePage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/vocab" element={<VocabPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
      <Toaster position="top-center" richColors closeButton />
      <Analytics />
    </>
  )
}

export default App
