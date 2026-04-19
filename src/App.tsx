import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { HomePage } from './pages/HomePage'
import { ImmersivePage } from './pages/ImmersivePage'
import { NotesPage } from './pages/NotesPage'
import { ProfilePage } from './pages/ProfilePage'
import { ReviewPage } from './pages/ReviewPage'
import { VocabPage } from './pages/VocabPage'
import { Analytics } from "@vercel/analytics/react"

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Analytics />
        <Route index element={<HomePage />} />
        <Route path="/immersive" element={<ImmersivePage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/vocab" element={<VocabPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  )
}

export default App
