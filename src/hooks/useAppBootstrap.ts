import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { primeSpeechVoices } from '../lib/speech'
import { useAppStore } from '../store/useAppStore'

export function useAppBootstrap() {
  const initialize = useAppStore((state) => state.initialize)
  const refreshPublishedLessons = useAppStore((state) => state.refreshPublishedLessons)
  const location = useLocation()
  const shouldPollPublishedLessons =
    location.pathname === '/' || location.pathname === '/immersive'

  useEffect(() => {
    void initialize()
    primeSpeechVoices()
  }, [initialize])

  useEffect(() => {
    if (!shouldPollPublishedLessons) {
      return
    }

    void refreshPublishedLessons()

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && shouldPollPublishedLessons) {
        void refreshPublishedLessons()
      }
    }, 60000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [refreshPublishedLessons, shouldPollPublishedLessons])
}
